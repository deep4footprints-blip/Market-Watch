// Research analytics. Pure functions over daily bars; no DOM, no network.
// Bars: { t (unix s), o, h, l, c, v } oldest -> newest. Every formula here is documented in docs/METHODOLOGY.md.
// All outputs are DERIVED METRICS from Dhan daily history (price-only, not total return; corporate-action adjustment is
// whatever Dhan returns and is NOT verified here).

export const TD = { m1: 21, m3: 63, m6: 126, m9: 189, m12: 252 }; // trading-day approximations of 1/3/6/9/12 months
export const DEFAULT_RS_WEIGHTS = { 63: 0.4, 126: 0.2, 189: 0.2, 252: 0.2 }; // configurable; not the only valid method
export const DEFAULT_TEMPLATE = {
  above50: true, above150: true, above200: true, ma50over150: true, ma150over200: true,
  ma200rising: true, riseLookback: 21, minAboveLow: 0.30, maxBelowHigh: 0.25, minRs: 70,
};

const fin = (n) => n != null && Number.isFinite(n);

/** SMA of closes ending `back` bars before the last bar (back=0 -> latest). null if not enough bars. */
export function smaAt(cl, n, back = 0) {
  const end = cl.length - back;
  if (end < n || n < 1) return null;
  let s = 0;
  for (let i = end - n; i < end; i++) s += cl[i];
  return s / n;
}

/** Simple return over `days` trading days. null if not enough history. */
export function ret(cl, days) {
  if (cl.length <= days) return null;
  const a = cl[cl.length - 1 - days], b = cl[cl.length - 1];
  return a > 0 ? b / a - 1 : null;
}

/** 52-week (252-bar) high/low of CLOSES (close-based, not intraday). */
export function hiLo(cl, n = 252) {
  const w = cl.slice(-n);
  if (w.length < Math.min(n, 60)) return { hi: null, lo: null, bars: w.length };
  return { hi: Math.max(...w), lo: Math.min(...w), bars: w.length };
}

/**
 * Weighted relative-performance score vs a benchmark.
 * For each period p with weight w: rel_p = (1 + r_stock_p) / (1 + r_bench_p) - 1 ; score = sum(w * rel_p).
 * Requires every weighted period to be available (otherwise null) so scores stay comparable across the universe.
 */
export function rsScore(stockCl, benchCl, weights = DEFAULT_RS_WEIGHTS) {
  let score = 0, tw = 0;
  for (const [d, w] of Object.entries(weights)) {
    const rs = ret(stockCl, +d), rb = ret(benchCl, +d);
    if (!fin(rs) || !fin(rb) || w <= 0) return null;
    score += w * ((1 + rs) / (1 + rb) - 1);
    tw += w;
  }
  return tw > 0 ? score / tw : null;
}

/** Cross-sectional percentile rating 1..99 (99 = strongest). Ties share the average rank. Nulls stay null. */
export function percentileRank(scores) {
  const idx = scores.map((s, i) => [s, i]).filter(([s]) => fin(s)).sort((a, b) => a[0] - b[0]);
  const out = scores.map(() => null), n = idx.length;
  if (!n) return out;
  if (n === 1) { out[idx[0][1]] = 50; return out; }
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++;
    const rank = (i + j) / 2; // 0..n-1
    const r = Math.round(1 + (98 * rank) / (n - 1));
    for (let k = i; k <= j; k++) out[idx[k][1]] = r;
    i = j + 1;
  }
  return out;
}

/** RS line = stock close / benchmark close aligned on date. Returns [{t, v}]. */
export function rsLine(stock, bench) {
  const bm = new Map(bench.map((b) => [b.t, b.c]));
  return stock.filter((s) => bm.get(s.t) > 0).map((s) => ({ t: s.t, v: s.c / bm.get(s.t) }));
}
export function rsLineNewHigh(line, n = 252) {
  if (line.length < 60) return null;
  const w = line.slice(-n);
  return w[w.length - 1].v >= Math.max(...w.map((x) => x.v));
}

/**
 * Trend template. Returns the per-condition pass/fail so the failing rule is never hidden.
 * rs = percentile rating (1..99) or null (-> that rule is 'n/a', excluded from the denominator).
 */
export function trendTemplate(cl, rs, cfg = DEFAULT_TEMPLATE) {
  const px = cl[cl.length - 1];
  const s50 = smaAt(cl, 50), s150 = smaAt(cl, 150), s200 = smaAt(cl, 200);
  const s200prev = smaAt(cl, 200, cfg.riseLookback);
  const { hi, lo } = hiLo(cl);
  const t = (on, label, fn) => (on ? { label, pass: fn() } : null);
  const ok = (a, b) => (fin(a) && fin(b) ? a > b : null);
  const rules = [
    t(cfg.above50, "Price > 50 DMA", () => ok(px, s50)),
    t(cfg.above150, "Price > 150 DMA", () => ok(px, s150)),
    t(cfg.above200, "Price > 200 DMA", () => ok(px, s200)),
    t(cfg.ma50over150, "50 DMA > 150 DMA", () => ok(s50, s150)),
    t(cfg.ma150over200, "150 DMA > 200 DMA", () => ok(s150, s200)),
    t(cfg.ma200rising, `200 DMA rising (${cfg.riseLookback}d)`, () => ok(s200, s200prev)),
    t(cfg.minAboveLow > 0, `≥ ${Math.round(cfg.minAboveLow * 100)}% above 52w low`, () => (fin(lo) && lo > 0 ? px / lo - 1 >= cfg.minAboveLow : null)),
    t(cfg.maxBelowHigh > 0, `within ${Math.round(cfg.maxBelowHigh * 100)}% of 52w high`, () => (fin(hi) && hi > 0 ? 1 - px / hi <= cfg.maxBelowHigh : null)),
    t(cfg.minRs > 0, `RS rating ≥ ${cfg.minRs}`, () => (fin(rs) ? rs >= cfg.minRs : null)),
  ].filter(Boolean);
  const known = rules.filter((r) => r.pass !== null);
  const passed = known.filter((r) => r.pass).length;
  return { rules, passed, total: known.length, unknown: rules.length - known.length, all: known.length === rules.length && passed === rules.length };
}

/**
 * Stage classification, DAILY APPROXIMATION of Weinstein's weekly 30-week MA: MA = 150-day SMA.
 *   slope  = MA[t] / MA[t-21] - 1 ;  prior = MA[t-21] / MA[t-84] - 1 ; flat band = +/- band (default 1%).
 *   price > MA and slope > band       -> 2 (advancing)
 *   price < MA and slope < -band      -> 4 (declining)
 *   price > MA and slope <= band      -> 3 if prior > band (topping after an advance) else 1
 *   price < MA and slope >= -band     -> 1 if prior < -band (basing after a decline) else 3 if prior > band else 4/1 by slope sign
 * It is a transparent heuristic, not a definitive Weinstein call; `conf` is 'low' when the price is within 2% of the MA.
 */
export function stageOf(cl, band = 0.01) {
  const px = cl[cl.length - 1];
  const ma = smaAt(cl, 150), ma21 = smaAt(cl, 150, 21), ma84 = smaAt(cl, 150, 84);
  if (![px, ma, ma21, ma84].every(fin)) return null;
  const slope = ma / ma21 - 1, prior = ma21 / ma84 - 1, above = px > ma;
  let stage;
  if (above && slope > band) stage = 2;
  else if (!above && slope < -band) stage = 4;
  else if (above) stage = prior > band ? 3 : 1;
  else stage = prior < -band ? 1 : prior > band ? 3 : slope < 0 ? 4 : 1;
  const conf = Math.abs(px / ma - 1) < 0.02 ? "low" : "ok";
  return { stage, slope, prior, ma, conf };
}

/** One row of derived metrics for a symbol. bars: daily bars (already trimmed to completed sessions). */
export function summarise(bars, benchBars, weights = DEFAULT_RS_WEIGHTS) {
  const cl = bars.map((b) => b.c);
  const bcl = benchBars.map((b) => b.c);
  const { hi, lo } = hiLo(cl);
  const px = cl[cl.length - 1];
  const line = rsLine(bars, benchBars);
  const vol = bars.slice(-20).reduce((a, b) => a + b.v, 0) / Math.min(20, bars.length || 1);
  return {
    cl, n: cl.length, asOf: bars.length ? bars[bars.length - 1].t : null, px,
    r1m: ret(cl, TD.m1), r3m: ret(cl, TD.m3), r6m: ret(cl, TD.m6), r12m: ret(cl, TD.m12),
    rsRaw: rsScore(cl, bcl, weights), rs: null,
    sma20: smaAt(cl, 20), sma50: smaAt(cl, 50), sma100: smaAt(cl, 100), sma150: smaAt(cl, 150), sma200: smaAt(cl, 200),
    hi, lo, offHigh: hi > 0 ? 1 - px / hi : null, aboveLow: lo > 0 ? px / lo - 1 : null,
    isHigh: hi != null && px >= hi, isLow: lo != null && px <= lo,
    rsNewHigh: rsLineNewHigh(line), stage: stageOf(cl), stage5: stageOf(cl.slice(0, -5)), adtv: vol * px,
  };
}

/** Attach cross-sectional RS rating + trend template to summaries (mutates and returns). */
export function rateUniverse(rows, cfg = DEFAULT_TEMPLATE) {
  const pr = percentileRank(rows.map((r) => r.rsRaw));
  rows.forEach((r, i) => { r.rs = pr[i]; });
  rows.forEach((r) => { r.tt = r.cl?.length ? trendTemplate(r.cl, r.rs, cfg) : null; });
  return rows;
}

/** Breadth over a set of summaries. Percentages are over symbols that HAVE the needed history (coverage reported). */
export function breadth(rows) {
  const pctAbove = (k) => {
    const have = rows.filter((r) => fin(r[k]) && fin(r.px));
    return { pct: have.length ? (have.filter((r) => r.px > r[k]).length / have.length) * 100 : null, n: have.length };
  };
  const have52 = rows.filter((r) => fin(r.hi));
  const near = (x) => (have52.length ? (have52.filter((r) => r.offHigh <= x).length / have52.length) * 100 : null);
  const st = [1, 2, 3, 4].map((s) => rows.filter((r) => r.stage?.stage === s).length);
  return {
    total: rows.length,
    above20: pctAbove("sma20"), above50: pctAbove("sma50"), above100: pctAbove("sma100"), above150: pctAbove("sma150"), above200: pctAbove("sma200"),
    newHighs: have52.filter((r) => r.isHigh).length, newLows: have52.filter((r) => r.isLow).length, cov52: have52.length,
    near5: near(0.05), near10: near(0.10), near20: near(0.20),
    stages: st, stageN: st.reduce((a, b) => a + b, 0),
    posR3m: (() => { const h = rows.filter((r) => fin(r.r3m)); return h.length ? (h.filter((r) => r.r3m > 0).length / h.length) * 100 : null; })(),
  };
}

export const REGIME_DEFAULT = { trend: 0.3, breadth: 0.3, momentum: 0.15, volatility: 0.15, drawdown: 0.1 };
export const regimeLabel = (s) => (s >= 80 ? "Strong risk-on" : s >= 60 ? "Constructive" : s >= 40 ? "Mixed / transition" : s >= 20 ? "Defensive" : "Risk-off");
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/**
 * Transparent regime score, 0..100. Each component is 0..1 with the formula shown in `detail`; missing inputs are
 * EXCLUDED and reported through `coverage` (share of total weight that had data) rather than treated as neutral.
 * A model classification, not a forecast.
 */
export function regimeScore({ indexCl, vixCl, br }, weights = REGIME_DEFAULT) {
  const c = {};
  if (indexCl?.length >= 200) {
    const px = indexCl[indexCl.length - 1], s50 = smaAt(indexCl, 50), s200 = smaAt(indexCl, 200);
    const pts = [px > s50, px > s200, s50 > s200, smaAt(indexCl, 200) > smaAt(indexCl, 200, 21)];
    c.trend = { v: pts.filter(Boolean).length / pts.length, detail: "Index: close>50DMA, close>200DMA, 50>200, 200DMA rising (25% each)" };
    const r3 = ret(indexCl, TD.m3);
    if (fin(r3)) c.momentum = { v: clamp01((r3 + 0.1) / 0.2), detail: "Index 3M return mapped linearly: -10% -> 0, +10% -> 1" };
    const { hi } = hiLo(indexCl);
    if (hi > 0) c.drawdown = { v: clamp01(1 - (1 - px / hi) / 0.2), detail: "Distance below 52w close-high: 0% -> 1, 20%+ -> 0" };
  }
  if (br && br.above50.pct != null && br.above200.pct != null)
    c.breadth = { v: clamp01((br.above50.pct + br.above200.pct) / 200), detail: "Average of % of universe above 50 DMA and above 200 DMA" };
  if (vixCl?.length >= 120) {
    const w = vixCl.slice(-252), cur = w[w.length - 1];
    const below = w.filter((x) => x <= cur).length / w.length;
    c.volatility = { v: clamp01(1 - below), detail: "India VIX percentile within its own last year, inverted (low VIX -> high score)" };
  }
  let sum = 0, tw = 0, all = 0;
  for (const [k, w] of Object.entries(weights)) { all += w; if (c[k]) { sum += w * c[k].v; tw += w; } }
  if (!tw) return null;
  const score = (sum / tw) * 100;
  return { score, label: regimeLabel(score), coverage: tw / all, components: c, weights };
}

/** Annualised realised volatility from closes (log returns, 252d). */
export function realisedVol(cl, n = 20) {
  if (cl.length < n + 1) return null;
  const r = [];
  for (let i = cl.length - n; i < cl.length; i++) r.push(Math.log(cl[i] / cl[i - 1]));
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const v = r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1);
  return Math.sqrt(v * 252);
}

// ---------- derivatives analytics on a normalised Dhan chain (see dhan.js normalizeChain) ----------
/** OI-based and volume-based PCR over all listed strikes (puts / calls). */
export function pcr(chain) {
  let coi = 0, poi = 0, cv = 0, pv = 0;
  for (const r of chain.rows) { coi += r.ce?.oi || 0; poi += r.pe?.oi || 0; cv += r.ce?.vol || 0; pv += r.pe?.vol || 0; }
  return { oi: coi > 0 ? poi / coi : null, vol: cv > 0 ? pv / cv : null, callOi: coi, putOi: poi };
}

/**
 * Max pain: strike minimising total intrinsic payout to option BUYERS at expiry, using OI per strike (unit OI; multiply by
 * lot size for rupees). Descriptive only: it does not predict settlement.
 */
export function maxPain(chain) {
  const ks = chain.rows.map((r) => r.strike);
  if (!ks.length) return null;
  const curve = ks.map((K) => {
    let pay = 0;
    for (const r of chain.rows) {
      pay += (r.ce?.oi || 0) * Math.max(K - r.strike, 0);
      pay += (r.pe?.oi || 0) * Math.max(r.strike - K, 0);
    }
    return { strike: K, pay };
  });
  if (curve.every((c) => c.pay === 0)) return null;
  const best = curve.reduce((b, c) => (c.pay < b.pay ? c : b), curve[0]);
  return { strike: best.strike, curve };
}

/** ATM straddle premium and the simple premium-implied move (straddle / spot). Mid of CE+PE LTP; assumptions: ATM = nearest strike to spot. */
export function atmStraddle(chain) {
  const r = chain.byStrike?.get(chain.atm);
  const ce = r?.ce?.ltp, pe = r?.pe?.ltp;
  if (!fin(ce) || !fin(pe) || !fin(chain.spot) || chain.spot <= 0) return null;
  const prem = ce + pe;
  return { strike: chain.atm, prem, movePct: prem / chain.spot, lo: chain.spot - prem, hi: chain.spot + prem };
}

/**
 * Price + OI interpretation per strike side is exchange-agnostic: price up & OI up = long buildup; price down & OI up =
 * short buildup; price up & OI down = short covering; price down & OI down = long unwinding.
 */
export function oiInterpretation(pricePct, oiChg) {
  if (!fin(pricePct) || !fin(oiChg) || (pricePct === 0 && oiChg === 0)) return null;
  if (oiChg > 0) return pricePct >= 0 ? "Long buildup" : "Short buildup";
  return pricePct >= 0 ? "Short covering" : "Long unwinding";
}
