// Technical indicators over daily bars. Pure. Every function returns an array aligned to the input (null where undefined).
// Formulas: docs/METHODOLOGY.md. Wilder smoothing is used for RSI/ATR/ADX (alpha = 1/n, seeded with the simple average).
const fin = (n) => n != null && Number.isFinite(n);

export const smaS = (v, n) => v.map((_, i) => (i < n - 1 ? null : v.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n));
export function emaS(v, n) {
  const k = 2 / (n + 1), out = v.map(() => null);
  let prev = null;
  for (let i = 0; i < v.length; i++) {
    if (i === n - 1) prev = v.slice(0, n).reduce((a, b) => a + b, 0) / n;
    else if (i >= n) prev = v[i] * k + prev * (1 - k);
    if (i >= n - 1) out[i] = prev;
  }
  return out;
}
function wilder(v, n, start = 0) { // v[start..] seeded by simple mean of first n values
  const out = v.map(() => null);
  if (v.length < start + n) return out;
  let a = 0;
  for (let i = start; i < start + n; i++) a += v[i];
  a /= n; out[start + n - 1] = a;
  for (let i = start + n; i < v.length; i++) { a = (a * (n - 1) + v[i]) / n; out[i] = a; }
  return out;
}
export function rsiS(cl, n = 14) {
  const g = [0], l = [0];
  for (let i = 1; i < cl.length; i++) { const d = cl[i] - cl[i - 1]; g.push(Math.max(d, 0)); l.push(Math.max(-d, 0)); }
  const ag = wilder(g, n, 1), al = wilder(l, n, 1);
  return cl.map((_, i) => (ag[i] == null ? null : al[i] === 0 ? 100 : 100 - 100 / (1 + ag[i] / al[i])));
}
export function macdS(cl, f = 12, s = 26, sig = 9) {
  const ef = emaS(cl, f), es = emaS(cl, s);
  const line = cl.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
  const first = line.findIndex(fin);
  const sg = line.map(() => null);
  if (first >= 0) { const e = emaS(line.slice(first), sig); e.forEach((x, i) => { sg[first + i] = x; }); }
  return { line, signal: sg, hist: line.map((x, i) => (x != null && sg[i] != null ? x - sg[i] : null)) };
}
export function trS(bars) { return bars.map((b, i) => (i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c)))); }
export const atrS = (bars, n = 14) => wilder(trS(bars), n, 1);
export function bollS(cl, n = 20, k = 2) {
  const m = smaS(cl, n);
  return cl.map((_, i) => {
    if (m[i] == null) return { mid: null, up: null, lo: null, bw: null };
    const w = cl.slice(i - n + 1, i + 1), sd = Math.sqrt(w.reduce((a, b) => a + (b - m[i]) ** 2, 0) / n); // population sd
    return { mid: m[i], up: m[i] + k * sd, lo: m[i] - k * sd, bw: (2 * k * sd) / m[i] };
  });
}
export function adxS(bars, n = 14) {
  const pdm = [0], mdm = [0];
  for (let i = 1; i < bars.length; i++) {
    const up = bars[i].h - bars[i - 1].h, dn = bars[i - 1].l - bars[i].l;
    pdm.push(up > dn && up > 0 ? up : 0); mdm.push(dn > up && dn > 0 ? dn : 0);
  }
  const tr = wilder(trS(bars), n, 1), p = wilder(pdm, n, 1), m = wilder(mdm, n, 1);
  const pdi = bars.map((_, i) => (tr[i] ? (100 * p[i]) / tr[i] : null)), mdi = bars.map((_, i) => (tr[i] ? (100 * m[i]) / tr[i] : null));
  const dx = bars.map((_, i) => (pdi[i] != null && pdi[i] + mdi[i] > 0 ? (100 * Math.abs(pdi[i] - mdi[i])) / (pdi[i] + mdi[i]) : null));
  const first = dx.findIndex(fin);
  const adx = dx.map(() => null);
  if (first >= 0) { const w = wilder(dx.slice(first), n); w.forEach((x, i) => { adx[first + i] = x; }); }
  return { pdi, mdi, adx };
}
export function stochS(bars, n = 14, d = 3) {
  const k = bars.map((b, i) => {
    if (i < n - 1) return null;
    const w = bars.slice(i - n + 1, i + 1), hh = Math.max(...w.map((x) => x.h)), ll = Math.min(...w.map((x) => x.l));
    return hh === ll ? 50 : (100 * (b.c - ll)) / (hh - ll);
  });
  const first = k.findIndex(fin), dd = k.map(() => null);
  if (first >= 0) smaS(k.slice(first), d).forEach((x, i) => { dd[first + i] = x; });
  return { k, d: dd };
}
export function donchianS(bars, n = 20) {
  return bars.map((_, i) => (i < n - 1 ? { up: null, lo: null } : { up: Math.max(...bars.slice(i - n + 1, i + 1).map((b) => b.h)), lo: Math.min(...bars.slice(i - n + 1, i + 1).map((b) => b.l)) }));
}
/** Relative volume = volume / mean volume of the previous n sessions (excluding today). */
export function relVol(bars, n = 50) {
  if (bars.length < n + 1) return null;
  const avg = bars.slice(-n - 1, -1).reduce((a, b) => a + b.v, 0) / n;
  return avg > 0 ? bars[bars.length - 1].v / avg : null;
}
export const last = (a) => (a.length ? a[a.length - 1] : null);
