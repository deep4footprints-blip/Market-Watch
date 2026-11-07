// Portfolio / series risk. Pure. Inputs are close arrays aligned by date (same length).
const fin = (n) => n != null && Number.isFinite(n);
export const returns = (cl) => cl.slice(1).map((c, i) => (cl[i] > 0 ? c / cl[i] - 1 : 0));
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
export const annVol = (r) => (r.length > 2 ? sd(r) * Math.sqrt(252) : null);
export function cov(a, b) { const n = Math.min(a.length, b.length), x = a.slice(-n), y = b.slice(-n), mx = mean(x), my = mean(y); return x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0) / (n - 1); }
export const corr = (a, b) => { const d = sd(a.slice(-Math.min(a.length, b.length))) * sd(b.slice(-Math.min(a.length, b.length))); return d > 0 ? cov(a, b) / d : null; };
export const beta = (asset, bench) => { const v = cov(bench, bench); return v > 0 ? cov(asset, bench) / v : null; };
export function maxDrawdown(eq) {
  let peak = -Infinity, dd = 0, peakI = 0, troughI = 0, curPeakI = 0;
  eq.forEach((v, i) => { if (v > peak) { peak = v; curPeakI = i; } const d = 1 - v / peak; if (d > dd) { dd = d; peakI = curPeakI; troughI = i; } });
  return { dd, peakI, troughI };
}
/** Historical-simulation VaR / expected shortfall at confidence c (loss as a positive fraction). Needs ≥ 100 observations. */
export function varEs(r, c = 0.95) {
  if (r.length < 100) return null;
  const s = [...r].sort((a, b) => a - b), k = Math.max(1, Math.floor((1 - c) * s.length));
  return { var: -s[k - 1], es: -mean(s.slice(0, k)), n: r.length, c };
}
export function corrMatrix(series) { // series: [{key, r:[...]}]
  return series.map((a) => series.map((b) => (a === b ? 1 : corr(a.r, b.r))));
}
/** Herfindahl index (0..1) and effective number of holdings from weights. */
export function concentration(weights) {
  const w = weights.filter((x) => x > 0), s = w.reduce((a, b) => a + b, 0);
  if (!s) return null;
  const hhi = w.reduce((a, x) => a + (x / s) ** 2, 0);
  return { hhi, effective: 1 / hhi, top1: Math.max(...w) / s, top5: [...w].sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0) / s };
}
/**
 * Portfolio analysis from holdings [{key, value, cl:[closes aligned]}] and a benchmark close series (same alignment).
 * Weights are CURRENT value weights applied to the historical window (a "what if held now" view, not realised history).
 */
export function analysePortfolio(holdings, benchCl, { window = 252 } = {}) {
  const hs = holdings.filter((h) => h.cl?.length > 60 && h.value > 0);
  if (!hs.length) return null;
  const n = Math.min(window + 1, ...hs.map((h) => h.cl.length), benchCl.length);
  const tot = hs.reduce((a, h) => a + h.value, 0);
  const rs = hs.map((h) => ({ key: h.key, w: h.value / tot, r: returns(h.cl.slice(-n)) }));
  const pr = rs[0].r.map((_, i) => rs.reduce((a, x) => a + x.w * x.r[i], 0));
  const br = returns(benchCl.slice(-n));
  const eq = pr.reduce((a, r) => (a.push(a[a.length - 1] * (1 + r)), a), [1]);
  return {
    n: pr.length, vol: annVol(pr), beta: beta(pr, br), dd: maxDrawdown(eq), var95: varEs(pr, 0.95), conc: concentration(hs.map((h) => h.value)),
    corr: { keys: rs.map((x) => x.key), m: corrMatrix(rs) }, betas: rs.map((x) => ({ key: x.key, beta: beta(x.r, br), w: x.w, vol: annVol(x.r) })),
  };
}
