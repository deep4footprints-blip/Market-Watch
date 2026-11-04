// Dhan client + data shaping. Runs in the browser (and under node:test). Read-only: only quote/holdings/positions/profile/RenewToken are ever called.
export const DHAN_BASE = "https://api.dhan.co/v2";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class DhanError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const num = (v) => {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/**
 * Dhan client. Quote calls are serialised with a minimum gap
 * because Dhan allows 1 market-quote request per second.
 */
export function createDhanClient({ fetchFn, getCreds, minGapMs = 1100 }) {
  const lanes = {}; // per-endpoint-family rate limiting: quotes 1 req/s, option chain 1 req/3s

  async function raw(path, { method = "GET", body } = {}) {
    const { token, clientId } = await getCreds();
    if (!token) throw new DhanError("NO_TOKEN", "No Dhan access token configured", 401);
    const res = await fetchFn(DHAN_BASE + path, {
      method,
      headers: { "access-token": token, "client-id": clientId || "", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      const code = json?.errorCode || (json?.data && Object.keys(json.data)[0]) || `HTTP_${res.status}`;
      const msg = json?.errorMessage || (json?.data && Object.values(json.data)[0]) || `Dhan returned HTTP ${res.status}`;
      const authFail = /^(DH-901|807|808|809|810)$/.test(String(code)) || res.status === 401;
      throw new DhanError(String(code), String(msg), authFail ? 401 : 502);
    }
    return json;
  }

  function call(path, opts = {}, { throttle = false, lane = "q", gap = minGapMs } = {}) {
    if (!throttle) return raw(path, opts);
    const ln = (lanes[lane] ||= { chain: Promise.resolve(), last: 0 });
    const run = async () => {
      const wait = ln.last + gap - Date.now();
      if (wait > 0) await sleep(wait);
      ln.last = Date.now();
      return raw(path, opts);
    };
    const p = ln.chain.then(run);
    ln.chain = p.catch(() => {});
    return p;
  }

  /** segments: { NSE_EQ: [1333, ...], IDX_I: [13, ...] } -> Map("SEG:id" -> normalised quote) */
  async function quotes(segments) {
    const out = new Map();
    const clean = {};
    for (const [seg, ids] of Object.entries(segments)) {
      const u = [...new Set(ids.map(Number).filter(Number.isInteger))];
      if (u.length) clean[seg] = u;
    }
    const total = Object.values(clean).reduce((n, a) => n + a.length, 0);
    // One request for everything when it fits Dhan's 1000-instrument cap (one call = one second of rate limit).
    const bodies = [];
    if (total <= 1000) { if (total) bodies.push(clean); }
    else for (const [seg, ids] of Object.entries(clean)) for (let i = 0; i < ids.length; i += 1000) bodies.push({ [seg]: ids.slice(i, i + 1000) });
    for (const body of bodies) {
      const json = await call("/marketfeed/quote", { method: "POST", body }, { throttle: true });
      for (const [seg, bySeg] of Object.entries(json?.data || {}))
        for (const [id, q] of Object.entries(bySeg || {})) out.set(`${seg}:${id}`, normalizeQuote(q));
    }
    return out;
  }

  return {
    quotes,
    holdings: () => call("/holdings"),
    positions: () => call("/positions"),
    profile: () => call("/profile"),
    renewToken: () => call("/RenewToken"),
    expiryList: async (id, seg) => {
      const j = await call("/optionchain/expirylist", { method: "POST", body: { UnderlyingScrip: id, UnderlyingSeg: seg } }, { throttle: true, lane: "oc", gap: minGapMs ? 3100 : 0 });
      return (Array.isArray(j?.data) ? j.data : []).map(String).sort();
    },
    intraday: (body) => call("/charts/intraday", { method: "POST", body }, { throttle: true, lane: "ch", gap: minGapMs ? 350 : 0 }),
    historical: (body) => call("/charts/historical", { method: "POST", body }, { throttle: true, lane: "ch", gap: minGapMs ? 350 : 0 }),
    optionChain: async (id, seg, expiry) => {
      const j = await call("/optionchain", { method: "POST", body: { UnderlyingScrip: id, UnderlyingSeg: seg, Expiry: expiry } }, { throttle: true, lane: "oc", gap: minGapMs ? 3100 : 0 });
      return normalizeChain(j);
    },
    raw: call,
  };
}

/**
 * prev close: prefer ltp - net_change (unambiguous), fall back to ohlc.close.
 * ASSUMPTION to verify on a live call: net_change is the absolute change vs previous close.
 */
export function normalizeQuote(q) {
  const ltp = num(q?.last_price);
  const o = q?.ohlc || {};
  const net = num(q?.net_change);
  let prev = ltp != null && net != null ? ltp - net : num(o.close);
  if (prev != null && prev <= 0) prev = null;
  const live = ltp != null && ltp > 0;
  const chg = live && prev != null ? ltp - prev : null;
  return {
    ltp: live ? ltp : null,
    prev,
    chg,
    pct: chg != null ? (chg / prev) * 100 : null,
    open: num(o.open),
    high: num(o.high),
    low: num(o.low),
    volume: num(q?.volume),
  };
}

export function buildSnapshot(inst, quotes, now = new Date()) {
  const indices = (inst.indices || []).map((ix) => ({
    id: ix.id,
    key: ix.key,
    name: ix.name,
    group: ix.group,
    ...(quotes.get(`IDX_I:${ix.id}`) || {}),
  }));

  const stocks = (inst.fno || [])
    .map((s) => ({ id: s.id, sym: s.s, name: s.n, ...(quotes.get(`NSE_EQ:${s.id}`) || {}) }))
    .filter((s) => s.ltp != null && s.pct != null)
    .map((s) => ({ ...s, turnover: s.volume != null ? s.volume * s.ltp : null }));

  const gainers = stocks.filter((s) => s.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, 10);
  const losers = stocks.filter((s) => s.pct < 0).sort((a, b) => a.pct - b.pct).slice(0, 10);
  const breadth = {
    adv: stocks.filter((s) => s.pct > 0).length,
    dec: stocks.filter((s) => s.pct < 0).length,
    unch: stocks.filter((s) => s.pct === 0).length,
    universe: "F&O stocks",
    total: stocks.length,
  };
  const active = stocks.filter((s) => s.turnover != null).sort((a, b) => b.turnover - a.turnover).slice(0, 10);
  return { asOf: now.toISOString(), indices, movers: { gainers, losers, active }, breadth };
}

const holdingSeg = (ex) => (String(ex).toUpperCase() === "BSE" ? "BSE_EQ" : "NSE_EQ");
const isEmptyErr = (e) => e instanceof DhanError && (e.code === "DH-1111" || /no (holdings|positions)/i.test(e.message));

/** Network part: holdings + positions (no quotes). Empty portfolio is not an error. */
export async function fetchBook(client) {
  const [h, p] = await Promise.all([
    client.holdings().catch((e) => (isEmptyErr(e) ? [] : Promise.reject(e))),
    client.positions().catch((e) => (isEmptyErr(e) ? [] : Promise.reject(e))),
  ]);
  const holdings = Array.isArray(h) ? h : [];
  const positions = (Array.isArray(p) ? p : []).filter((x) => (num(x.netQty) || 0) !== 0 || (num(x.realizedProfit) || 0) !== 0);
  return { holdings, positions, at: Date.now() };
}

/** Instruments the book needs priced: { NSE_EQ:[ids], ... } */
export function bookInstruments(book) {
  const segs = {};
  const add = (seg, id) => { (segs[seg] ||= []).push(id); };
  for (const x of book?.holdings || []) add(holdingSeg(x.exchange), x.securityId);
  for (const x of book?.positions || []) if (x.exchangeSegment) add(x.exchangeSegment, x.securityId);
  return segs;
}

/** Pure part: book + quote Map -> view model. */
export function buildPortfolio(book, quotes, now = new Date()) {
  const { holdings = [], positions = [] } = book || {};
  const rows = holdings.map((x) => {
    const seg = holdingSeg(x.exchange);
    const q = quotes.get(`${seg}:${x.securityId}`) || {};
    const qty = num(x.totalQty) || 0;
    const avg = num(x.avgCostPrice) || 0;
    const ltp = q.ltp ?? num(x.lastTradedPrice) ?? null;
    const invested = qty * avg;
    const value = ltp != null ? qty * ltp : null;
    return {
      sym: x.tradingSymbol, id: String(x.securityId), seg, qty, avg, ltp,
      pct: q.pct ?? null, open: q.open ?? null, high: q.high ?? null, low: q.low ?? null,
      invested, value,
      pnl: value != null ? value - invested : null,
      pnlPct: value != null && invested > 0 ? ((value - invested) / invested) * 100 : null,
      dayPnl: q.chg != null ? q.chg * qty : null,
    };
  });
  const sum = (arr, f) => arr.reduce((a, r) => a + (f(r) || 0), 0);
  const invested = sum(rows, (r) => r.invested);
  const value = sum(rows, (r) => r.value ?? r.invested);
  const pos = positions.map((x) => {
    const q = quotes.get(`${x.exchangeSegment}:${x.securityId}`) || {};
    const real = num(x.realizedProfit) || 0;
    const unreal = num(x.unrealizedProfit) || 0;
    return {
      sym: x.tradingSymbol, id: String(x.securityId), seg: x.exchangeSegment, product: x.productType,
      netQty: num(x.netQty) || 0, avg: num(x.costPrice) || num(x.buyAvg) || 0,
      ltp: q.ltp ?? null, pct: q.pct ?? null, realized: real, unrealized: unreal, total: real + unreal,
    };
  });
  return {
    asOf: now.toISOString(),
    summary: {
      invested, value, pnl: value - invested,
      pnlPct: invested > 0 ? ((value - invested) / invested) * 100 : null,
      dayPnl: sum(rows, (r) => r.dayPnl), positionsPnl: sum(pos, (r) => r.total), holdingsCount: rows.length,
    },
    holdings: rows.sort((a, b) => Math.abs(b.dayPnl || 0) - Math.abs(a.dayPnl || 0)),
    positions: pos,
  };
}

export async function loadPortfolio(client, now = new Date()) {
  const book = await fetchBook(client);
  const segs = bookInstruments(book);
  const quotes = Object.keys(segs).length ? await client.quotes(segs) : new Map();
  return buildPortfolio(book, quotes, now);
}

export function buildWatch(items, quotes, now = new Date()) {
  const ids = [...new Set((items || []).map((i) => Number(i.id)).filter(Number.isInteger))].slice(0, 100);
  return { asOf: now.toISOString(), items: ids.map((id) => ({ id, ...(quotes.get(`NSE_EQ:${id}`) || {}) })) };
}

export async function loadWatch(client, items, now = new Date()) {
  const ids = [...new Set((items || []).map((i) => Number(i.id)).filter(Number.isInteger))].slice(0, 100);
  const quotes = ids.length ? await client.quotes({ NSE_EQ: ids }) : new Map();
  return buildWatch(items, quotes, now);
}

const optSide = (o) =>
  o
    ? {
        ltp: num(o.last_price),
        iv: num(o.implied_volatility),
        delta: num(o.greeks?.delta),
        gamma: num(o.greeks?.gamma),
        theta: num(o.greeks?.theta),
        vega: num(o.greeks?.vega),
        oi: num(o.oi),
        prevOi: num(o.previous_oi),
        vol: num(o.volume),
        bid: num(o.top_bid_price),
        ask: num(o.top_ask_price),
      }
    : null;

/** Dhan /optionchain -> { spot, strikes[], rows[{strike,ce,pe}], atm, atmIv, step }. IV is returned as-is (Dhan sends percent). */
export function normalizeChain(json) {
  const d = json?.data || {};
  const spot = num(d.last_price);
  const rows = Object.entries(d.oc || {})
    .map(([k, v]) => ({ strike: parseFloat(k), ce: optSide(v?.ce), pe: optSide(v?.pe) }))
    .filter((r) => Number.isFinite(r.strike) && (r.ce || r.pe))
    .sort((a, b) => a.strike - b.strike);
  const strikes = rows.map((r) => r.strike);
  let atm = null, step = null;
  if (spot != null && strikes.length) atm = strikes.reduce((b, k) => (Math.abs(k - spot) < Math.abs(b - spot) ? k : b), strikes[0]);
  if (strikes.length > 1) {
    const diffs = strikes.slice(1).map((k, i) => k - strikes[i]).sort((a, b) => a - b);
    step = diffs[Math.floor(diffs.length / 2)];
  }
  const ar = rows.find((r) => r.strike === atm);
  const ivs = [ar?.ce?.iv, ar?.pe?.iv].filter((v) => v > 0);
  const raw = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;
  const atmIv = raw == null ? null : raw > 3 ? raw / 100 : raw;
  return { spot, strikes, rows, byStrike: new Map(rows.map((r) => [r.strike, r])), atm, atmIv, step };
}
