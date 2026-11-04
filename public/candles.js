// Candle data: fetch from Dhan, normalise timestamps, aggregate to any timeframe, apply live ticks.
// Pure except fetchCandles (takes a client). Candle = { t (unix s), o, h, l, c, v }.

const IST = 19800;               // seconds
const SESSION_OPEN = 9 * 3600 + 15 * 60; // 09:15 IST, seconds of day
const DAY = 86400;
const DHAN_EPOCH_SHIFT = 315532800; // 1980-01-01 UTC, in case a response uses Dhan's legacy epoch

export const NATIVE = [60, 25, 15, 5, 1]; // minute intervals the intraday endpoint serves
export const PRESETS = [1, 3, 5, 10, 15, 25, 30, 60];
export const baseInterval = (m) => NATIVE.find((b) => m % b === 0) || 1;
const WINDOW_DAYS = { 1: 5, 5: 20, 15: 45, 25: 60, 60: 90 }; // history per base interval (endpoint cap: 90 days)

/** "5" | "D" | "W" | "M" | custom minutes -> { kind, minutes } */
export function parseTf(tf) {
  if (tf === "D" || tf === "W" || tf === "M") return { kind: tf };
  const m = Math.round(Number(tf));
  return { kind: "I", minutes: Number.isFinite(m) && m >= 1 && m <= 375 ? m : 5 };
}
export const tfLabel = (tf) => {
  const p = parseTf(tf);
  return p.kind === "D" ? "1D" : p.kind === "W" ? "1W" : p.kind === "M" ? "1M" : p.minutes % 60 === 0 && p.minutes >= 60 ? `${p.minutes / 60}h` : `${p.minutes}m`;
};

const pad = (n) => String(n).padStart(2, "0");
export const istDay = (t) => Math.floor((t + IST) / DAY);                  // days since epoch, IST calendar
export const istSod = (t) => (((t + IST) % DAY) + DAY) % DAY;              // seconds into the IST day
export const dayStr = (t) => new Date((t + IST) * 1000).toISOString().slice(0, 10);
export const hhmm = (t) => { const s = istSod(t); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}`; };
export const nowSec = () => Math.floor(Date.now() / 1000);

/** Dhan timestamps are unix seconds, but older docs describe a 1980 epoch: choose by magnitude of the newest stamp. */
export function normalizeTs(ts) {
  if (!ts.length) return [];
  const newest = ts[ts.length - 1];
  return newest >= 1.6e9 ? ts.slice() : ts.map((t) => t + DHAN_EPOCH_SHIFT);
}

/** Zip Dhan's parallel arrays into candles; fix a whole-series clock skew for intraday by anchoring first bar to 09:15 IST. */
export function toCandles(j, intraday) {
  const d = j?.data && !Array.isArray(j.data) ? j.data : j || {};
  const ts = normalizeTs(d.timestamp || d.start_Time || []);
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    const o = +d.open?.[i], h = +d.high?.[i], l = +d.low?.[i], c = +d.close?.[i];
    if (![o, h, l, c].every(Number.isFinite) || c <= 0) continue;
    out.push({ t: ts[i], o, h, l, c, v: +d.volume?.[i] || 0 });
  }
  out.sort((a, b) => a.t - b.t);
  if (intraday && out.length) {
    const firsts = new Map();
    for (const k of out) { const dd = istDay(k.t); if (!firsts.has(dd) || istSod(k.t) < firsts.get(dd)) firsts.set(dd, istSod(k.t)); }
    const counts = new Map();
    for (const v of firsts.values()) counts.set(v, (counts.get(v) || 0) + 1);
    const mode = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const skew = mode - SESSION_OPEN;
    if (Math.abs(skew) >= 1800 && Math.abs(skew) <= 12 * 3600 && skew % 60 === 0) for (const k of out) k.t -= skew;
  }
  return out;
}

/** Bucket start for a candle at time t under timeframe tf. */
export function bucketStart(tf, t) {
  const p = parseTf(tf);
  if (p.kind === "I") {
    const sod = istSod(t), day0 = t - sod;
    const idx = Math.floor((sod - SESSION_OPEN) / (p.minutes * 60));
    return day0 + SESSION_OPEN + Math.max(idx, -1) * p.minutes * 60;
  }
  const d = istDay(t);
  if (p.kind === "D") return d * DAY - IST;
  if (p.kind === "W") { const wd = (d + 3) % 7; return (d - wd) * DAY - IST; } // Monday start (1970-01-01 was Thursday)
  const dt = new Date((t + IST) * 1000);
  return Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1) / 1000 - IST;
}

/** Merge lower-timeframe candles into tf buckets. */
export function aggregate(cands, tf) {
  const out = [];
  let cur = null;
  for (const k of cands) {
    const b = bucketStart(tf, k.t);
    if (cur && cur.t === b) { cur.h = Math.max(cur.h, k.h); cur.l = Math.min(cur.l, k.l); cur.c = k.c; cur.v += k.v; }
    else { cur = { t: b, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v }; out.push(cur); }
  }
  return out;
}

/** Apply a live price to the series: update the current bucket or open a new one. Returns true if changed. */
export function applyTick(cands, tf, ltp, t = nowSec()) {
  if (!cands.length || !(ltp > 0)) return false;
  const b = bucketStart(tf, t), last = cands[cands.length - 1];
  if (b < last.t) return false;
  if (b === last.t) {
    if (last.c === ltp && ltp <= last.h && ltp >= last.l) return false;
    last.c = ltp; last.h = Math.max(last.h, ltp); last.l = Math.min(last.l, ltp);
    return true;
  }
  cands.push({ t: b, o: ltp, h: ltp, l: ltp, c: ltp, v: 0 });
  return true;
}

export const sma = (cands, n) => cands.map((_, i) => (i < n - 1 ? null : cands.slice(i - n + 1, i + 1).reduce((a, k) => a + k.c, 0) / n));

/** inst = { seg, id, instrument }. Returns candles for tf. */
export async function fetchCandles(client, inst, tf, now = Date.now()) {
  const p = parseTf(tf);
  const today = dayStr(Math.floor(now / 1000));
  const back = (n) => dayStr(Math.floor(now / 1000) - n * DAY);
  const base = { securityId: String(inst.id), exchangeSegment: inst.seg, instrument: inst.instrument };
  if (p.kind === "I") {
    const b = baseInterval(p.minutes);
    const j = await client.intraday({ ...base, interval: String(b), oi: false, fromDate: `${back(WINDOW_DAYS[b])} 09:15:00`, toDate: `${today} 15:30:00` });
    const c = toCandles(j, true);
    return b === p.minutes ? c : aggregate(c, p.minutes);
  }
  const years = p.kind === "D" ? 2 : p.kind === "W" ? 6 : 12;
  const j = await client.historical({ ...base, expiryCode: 0, oi: false, fromDate: back(Math.round(years * 365)), toDate: today });
  const c = toCandles(j, false);
  return p.kind === "D" ? c : aggregate(c, p.kind);
}

/** Latest session's 5-minute candles for sparklines (small 5-day window; falls back to the last trading day). */
export async function fetchSpark(client, inst, now = Date.now()) {
  const today = dayStr(Math.floor(now / 1000)), from = dayStr(Math.floor(now / 1000) - 5 * DAY);
  const j = await client.intraday({ securityId: String(inst.id), exchangeSegment: inst.seg, instrument: inst.instrument, interval: "5", oi: false, fromDate: `${from} 09:15:00`, toDate: `${today} 15:30:00` });
  const c = toCandles(j, true);
  if (!c.length) return [];
  const last = istDay(c[c.length - 1].t);
  return c.filter((k) => istDay(k.t) === last);
}
