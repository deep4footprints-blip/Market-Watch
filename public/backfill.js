// Rebuild minute-by-minute P&L history from Dhan's 1-minute candles, so the log does not depend on the app having been open.
// Strategy P&L: each leg's option candles (or, if the contract id/candles are unavailable, Black-Scholes on the index candles
// anchored to the leg's entry price). Portfolio: holdings day P&L = sum(qty x (close - previous session close)) at current quantities.
import { toCandles, dayStr, istDay } from "./candles.js";
import { bsPrice } from "./payoff.js";
import { holdingSeg } from "./dhan.js";

const MIN = 60000;
const FNO = { NIFTY: "NSE_FNO", SENSEX: "BSE_FNO" };
const INDEX_ID = { NIFTY: 13, SENSEX: 51 };
const fin = (n) => n != null && Number.isFinite(n);

/** 1-minute candles over [fromMs, toMs] as a sorted array [{t(ms), c}]. */
export async function minuteCloses(client, { id, seg, instrument }, fromMs, toMs) {
  const f = Math.floor(fromMs / 1000), t = Math.floor(toMs / 1000);
  const j = await client.intraday({ securityId: String(id), exchangeSegment: seg, instrument, interval: "1", oi: false, fromDate: `${dayStr(f)} 09:15:00`, toDate: `${dayStr(t)} 15:30:00` });
  return toCandles(j, true).map((k) => ({ t: k.t * 1000, c: k.c }));
}

/** Forward-filled lookup: price at each minute of `grid` from sparse candles. */
export function fillForward(grid, candles, initial) {
  const out = new Array(grid.length);
  let i = 0, last = initial;
  for (let g = 0; g < grid.length; g++) {
    while (i < candles.length && candles[i].t <= grid[g]) { last = candles[i].c; i++; }
    out[g] = last;
  }
  return out;
}

/**
 * Pure core: given the minute grid, index closes and per-leg price series, produce rows [t, total, realised, open].
 * legs: [{side,lots,entry,exit,tIn,tOut,price:number[] aligned to grid}]
 */
export function strategyRows(grid, legs, lot) {
  const rows = [];
  for (let g = 0; g < grid.length; g++) {
    const t = grid[g];
    let realised = 0, open = 0, any = false;
    for (const l of legs) {
      if (!fin(l.tIn) || t < Math.floor(l.tIn / MIN) * MIN) continue;
      any = true;
      const q = l.side * l.lots * lot;
      if (fin(l.exit) && fin(l.tOut) && t >= Math.floor(l.tOut / MIN) * MIN) realised += q * (l.exit - l.entry);
      else open += q * (l.price[g] - l.entry);
    }
    if (any) rows.push([t, realised + open, realised, open]);
  }
  return rows;
}

/** Rebuild one Payoff strategy session. Returns { rows, source } with source "dhan" | "model" | "mixed". */
export async function rebuildStrategy(client, meta, now = Date.now()) {
  const defs = (meta?.defs || []).filter((l) => fin(l.entry) && fin(l.tIn));
  if (!defs.length) return { rows: [], source: null };
  const key = meta.undKey || "NIFTY", lot = meta.lot || 1;
  const start = Math.min(...defs.map((l) => l.tIn)), allOut = defs.every((l) => fin(l.exit) && fin(l.tOut));
  const end = allOut ? Math.max(...defs.map((l) => l.tOut)) + MIN : now;
  const idx = await minuteCloses(client, { id: INDEX_ID[key] || 13, seg: "IDX_I", instrument: "INDEX" }, start, end);
  const grid = idx.map((k) => k.t).filter((t) => t >= Math.floor(start / MIN) * MIN && t <= end);
  if (!grid.length) return { rows: [], source: null };
  const spot = fillForward(grid, idx, null);
  const expiryMs = Date.parse(`${meta.expiry}T15:30:00+05:30`);
  let viaDhan = 0, viaModel = 0;
  const legs = [];
  for (const l of defs) {
    let price = null;
    if (fin(l.secId)) {
      try {
        const c = await minuteCloses(client, { id: l.secId, seg: FNO[key] || "NSE_FNO", instrument: "OPTIDX" }, start, end);
        if (c.length) { price = fillForward(grid, c, l.entry); viaDhan++; }
      } catch { /* fall through to the model */ }
    }
    if (!price) {
      // model price anchored so that it equals the entry price at the entry minute
      const iv = l.iv > 0 ? l.iv : 0.15, T = (t) => Math.max((expiryMs - t) / (365 * 864e5), 0);
      const k0 = Math.max(grid.findIndex((t) => t >= Math.floor(l.tIn / MIN) * MIN), 0);
      const m = (g) => bsPrice(l.type, spot[g], l.strike, T(grid[g]), iv);
      const off = l.entry - m(k0);
      price = grid.map((_, g) => Math.max(m(g) + off, 0));
      viaModel++;
    }
    legs.push({ ...l, price });
  }
  return { rows: strategyRows(grid, legs, lot), source: viaModel && viaDhan ? "mixed" : viaModel ? "model" : "dhan" };
}

/** Holdings day-P&L rows [t, total, holdings, positions=0] for the last trading days in range. */
export async function rebuildPortfolio(client, book, days = 5, now = Date.now()) {
  const hs = (book?.holdings || []).filter((h) => Number(h.totalQty) > 0 && h.securityId);
  if (!hs.length) return [];
  const from = now - (days + 3) * 864e5; // calendar buffer so `days` trading days are covered
  const series = [];
  for (const h of hs) {
    try { series.push({ qty: Number(h.totalQty), c: await minuteCloses(client, { id: h.securityId, seg: holdingSeg(h.exchange), instrument: "EQUITY" }, from, now) }); }
    catch { /* skip a symbol that fails; the rest still give a (slightly partial) total */ }
  }
  const usable = series.filter((s) => s.c.length);
  if (!usable.length) return [];
  const grid = [...new Set(usable.flatMap((s) => s.c.map((k) => k.t)))].sort((a, b) => a - b);
  const dayOf = (t) => istDay(t / 1000);
  const dayList = [...new Set(grid.map(dayOf))].sort((a, b) => a - b);
  const prevClose = new Map(); // per series index: day -> previous session's last close
  usable.forEach((s, i) => {
    const m = new Map();
    for (let d = 1; d < dayList.length; d++) {
      const before = s.c.filter((k) => dayOf(k.t) === dayList[d - 1]);
      if (before.length) m.set(dayList[d], before[before.length - 1].c);
    }
    prevClose.set(i, m);
  });
  const rows = [];
  const filled = usable.map((s) => fillForward(grid, s.c, null));
  for (let g = 0; g < grid.length; g++) {
    const d = dayOf(grid[g]);
    let tot = 0, n = 0;
    usable.forEach((s, i) => {
      const pc = prevClose.get(i).get(d), px = filled[i][g];
      if (fin(pc) && fin(px) && dayOf(s.c[0].t) <= d) { tot += s.qty * (px - pc); n++; }
    });
    if (n) rows.push([grid[g], tot, tot, 0]);
  }
  return rows.filter((r) => dayList.indexOf(dayOf(r[0])) >= Math.max(dayList.length - days, 1));
}

export async function backfillStrategy({ client, plog, sid }) {
  const meta = plog.meta(sid);
  if (!meta) return { added: 0, source: null };
  const { rows, source } = await rebuildStrategy(client, meta);
  const added = plog.fill(`st:${sid}`, rows);
  plog.setMeta(sid, { recon: source });
  return { added, source };
}
export async function backfillPortfolio({ client, plog, book, days = 5 }) {
  const rows = await rebuildPortfolio(client, book, days);
  return { added: plog.fill("port", rows), source: "dhan" };
}
