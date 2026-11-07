// Equity strategy backtester (daily bars). Pure.
// Execution: signals use data up to and including the close of day i; orders fill at the OPEN of day i+1 plus slippage (no look-ahead).
// Costs: per-side bps of traded value (editable assumption). Equal-weight slots. Long-only. Price-only (no dividends).
// LIMITS (always reported in result.warnings): universe is today's list (survivorship bias), no point-in-time constituents,
// corporate-action adjustment of the source is unverified, no liquidity/impact model beyond a flat slippage.
import { TD, DEFAULT_RS_WEIGHTS } from "./analytics.js";

const DAY = 86400;
const dkey = (t) => Math.floor((t + 19800) / DAY);
const fin = (n) => n != null && Number.isFinite(n);

/** Align bar arrays onto the benchmark calendar. Missing days forward-fill the close (flagged by v=0); before listing -> null. */
export function align(benchBars, universe /* Map key -> bars */) {
  const cal = benchBars.map((b) => b.t), idx = new Map(cal.map((t, i) => [dkey(t), i]));
  const series = new Map();
  for (const [key, bars] of universe) {
    const n = cal.length, c = new Array(n).fill(null), o = new Array(n).fill(null), v = new Array(n).fill(0);
    for (const b of bars) { const i = idx.get(dkey(b.t)); if (i != null) { c[i] = b.c; o[i] = b.o; v[i] = b.v; } }
    let first = c.findIndex(fin); if (first < 0) continue;
    for (let i = first + 1; i < n; i++) if (c[i] == null) { c[i] = c[i - 1]; o[i] = c[i - 1]; } // gap day: carry price
    const ps = [0]; for (let i = 0; i < n; i++) ps.push(ps[i] + (c[i] ?? 0));
    series.set(key, { c, o, v, first, ps });
  }
  const bc = benchBars.map((b) => b.c), bps = [0]; bc.forEach((x, i) => bps.push(bps[i] + x));
  return { cal, bench: { c: bc, o: benchBars.map((b) => b.o), ps: bps }, series };
}
const smaI = (s, i, n) => (i + 1 >= n ? (s.ps[i + 1] - s.ps[i + 1 - n]) / n : null);

export const DEFAULTS = {
  topN: 20, every: 21, weights: DEFAULT_RS_WEIGHTS, capital: 1_000_000, costBps: 20, slipBps: 10, buffer: 0,
  above200: true, stage2: false, minRs: 0, maxOffHigh: null, regimeFilter: false, stopLoss: null, rf: 0.065, minBars: 252,
};

/** RS score at index i vs benchmark, or null when history is insufficient. */
function rsAt(s, b, i, weights) {
  let sc = 0, tw = 0;
  for (const [d, w] of Object.entries(weights)) {
    const j = i - +d; if (j < 0 || s.c[j] == null || s.c[i] == null || !(s.c[j] > 0) || !(b.c[j] > 0)) return null;
    sc += w * ((s.c[i] / s.c[j]) / (b.c[i] / b.c[j]) - 1); tw += w;
  }
  return sc / tw;
}
function pctRanks(scores) {
  const idx = scores.map((s, k) => [s, k]).filter(([s]) => fin(s)).sort((a, b) => a[0] - b[0]), out = new Map(), n = idx.length;
  idx.forEach(([, k], r) => out.set(k, n > 1 ? Math.round(1 + (98 * r) / (n - 1)) : 50));
  return out;
}

export function run(data, userCfg = {}) {
  const cfg = { ...DEFAULTS, ...userCfg }, { cal, bench, series } = data, n = cal.length;
  const keys = [...series.keys()], warnings = [];
  const start = Math.max(cfg.minBars, 200);
  if (n < start + 60) return { error: `Need at least ${start + 60} daily bars of benchmark history; have ${n}. Load deeper history first.` };
  const cost = cfg.costBps / 1e4, slip = cfg.slipBps / 1e4;
  let cash = cfg.capital; const pos = new Map(); // key -> {sh, entryI, entryPx}
  const eq = new Array(n).fill(null), invested = new Array(n).fill(0), trades = [];
  let traded = 0, pending = null;
  const px = (k, i) => series.get(k).c[i];

  for (let i = start; i < n - 1; i++) {
    // 1) fill orders decided at close of i-1 at today's open
    if (pending) {
      const { sells, buys } = pending; pending = null;
      for (const k of sells) {
        const p = pos.get(k), s = series.get(k), fill = (s.o[i] ?? s.c[i]) * (1 - slip), val = p.sh * fill, c = val * cost;
        cash += val - c; traded += val;
        trades.push({ key: k, entryI: p.entryI, exitI: i, entry: p.entryPx, exit: fill, shares: p.sh, pnl: val - c - p.cost - p.sh * p.entryPx, cost: c + p.cost, reason: sells.reasons?.get(k) || "rebalance" });
        pos.delete(k);
      }
      if (buys.length) {
        const equity = cash + [...pos].reduce((a, [k, p]) => a + p.sh * px(k, i), 0), slot = equity / cfg.topN;
        for (const k of buys) {
          const s = series.get(k), fill = (s.o[i] ?? s.c[i]) * (1 + slip), amt = Math.min(slot, cash / (1 + cost)); if (amt < fill) continue;
          const sh = Math.floor(amt / fill), val = sh * fill, c = val * cost; if (sh < 1) continue;
          cash -= val + c; traded += val; pos.set(k, { sh, entryI: i, entryPx: fill, cost: c });
        }
      }
    }
    // 2) mark to market at close of i
    let mv = 0; for (const [k, p] of pos) mv += p.sh * px(k, i);
    eq[i] = cash + mv; invested[i] = eq[i] > 0 ? mv / eq[i] : 0;

    // 3) decisions at close of i (executed next open)
    const stops = [];
    if (cfg.stopLoss) for (const [k, p] of pos) if (px(k, i) <= p.entryPx * (1 - cfg.stopLoss)) stops.push(k);
    const rebalance = (i - start) % cfg.every === 0;
    if (!rebalance && !stops.length) continue;
    const sells = [...stops]; sells.reasons = new Map(stops.map((k) => [k, "stop"]));
    let buys = [];
    if (rebalance) {
      const riskOn = !cfg.regimeFilter || (bench.c[i] > smaI(bench, i, 200));
      const scored = keys.map((k) => { const s = series.get(k); return s.first <= i - cfg.minBars + 1 || s.c[i - cfg.minBars + 1] != null ? rsAt(s, bench, i, cfg.weights) : null; });
      const rk = pctRanks(scored);
      const elig = [];
      keys.forEach((k, j) => {
        const s = series.get(k), sc = scored[j]; if (!fin(sc) || !(s.v[i] > 0 || s.c[i] != null)) return;
        const c = s.c[i], m200 = smaI(s, i, 200), m150 = smaI(s, i, 150), m150p = smaI(s, i - 21, 150);
        if (cfg.above200 && !(c > m200)) return;
        if (cfg.stage2 && !(c > m150 && m150 > m150p * 1.01)) return;
        if (cfg.minRs && (rk.get(j) ?? 0) < cfg.minRs) return;
        if (fin(cfg.maxOffHigh)) { let hi = -Infinity; for (let q = Math.max(0, i - 251); q <= i; q++) if (s.c[q] > hi) hi = s.c[q]; if (1 - c / hi > cfg.maxOffHigh) return; }
        elig.push({ k, sc });
      });
      elig.sort((a, b) => b.sc - a.sc);
      const target = riskOn ? elig.slice(0, cfg.topN).map((x) => x.k) : [];
      const keep = new Set(riskOn ? elig.slice(0, cfg.topN + cfg.buffer).map((x) => x.k) : []);
      for (const k of pos.keys()) if (!keep.has(k) && !sells.includes(k)) sells.push(k);
      const held = new Set([...pos.keys()].filter((k) => !sells.includes(k)));
      for (const k of target) if (!held.has(k) && held.size + buys.length < cfg.topN) buys.push(k);
    }
    pending = { sells, buys };
  }
  // close at last bar (mark only; open positions are reported, not force-sold)
  const last = n - 1; let mv = 0; for (const [k, p] of pos) mv += p.sh * px(k, last);
  eq[last] = cash + mv; invested[last] = eq[last] > 0 ? mv / eq[last] : 0;

  warnings.push("Universe is today's list: delisted/removed stocks are absent (survivorship bias inflates results).", "No point-in-time index membership or fundamentals.", "Price-only returns (no dividends); corporate-action adjustment of the data source is unverified.", `Costs ${cfg.costBps} bps/side + slippage ${cfg.slipBps} bps are assumptions.`, "Not investment advice; past performance does not predict future results.");
  const years = (n - 1 - start) / 252;
  if (years < 3) warnings.push(`Only ${years.toFixed(1)} years tested: too short to judge robustness.`);
  const series_ = eq.slice(start), idxs = cal.slice(start);
  const bseries = bench.c.slice(start).map((x) => (x / bench.c[start]) * cfg.capital);
  const m = metrics(series_, idxs, cfg.rf), bm = metrics(bseries, idxs, cfg.rf);
  const cut = Math.floor(series_.length * 0.7);
  const closedPnl = trades.map((t) => t.pnl), wins = closedPnl.filter((x) => x > 0), loss = closedPnl.filter((x) => x < 0);
  return {
    cfg, warnings, start, equity: series_, bench: bseries, t: idxs, invested: invested.slice(start),
    metrics: { ...m, trades: trades.length, winRate: trades.length ? wins.length / trades.length : null, profitFactor: loss.length ? wins.reduce((a, b) => a + b, 0) / -loss.reduce((a, b) => a + b, 0) : null,
      avgHold: trades.length ? trades.reduce((a, t) => a + (t.exitI - t.entryI), 0) / trades.length : null, turnover: traded / cfg.capital / Math.max(years, 1e-9), exposure: invested.slice(start, n).reduce((a, b) => a + b, 0) / (n - start), costs: trades.reduce((a, t) => a + t.cost, 0), best: closedPnl.length ? Math.max(...closedPnl) : null, worst: closedPnl.length ? Math.min(...closedPnl) : null },
    benchMetrics: bm, inSample: metrics(series_.slice(0, cut), idxs.slice(0, cut), cfg.rf), outOfSample: metrics(series_.slice(cut - 1), idxs.slice(cut - 1), cfg.rf),
    trades: trades.map((t) => ({ ...t, entryT: cal[t.entryI], exitT: cal[t.exitI] })), open: [...pos].map(([k, p]) => ({ key: k, shares: p.sh, entry: p.entryPx, last: px(k, last) })), monthly: monthly(series_, idxs),
  };
}

export function metrics(eq, t, rf = 0) {
  if (eq.length < 3) return { cagr: null };
  const r = eq.slice(1).map((v, i) => v / eq[i] - 1), yrs = (t[t.length - 1] - t[0]) / (365.25 * DAY) || eq.length / 252;
  const mean = r.reduce((a, b) => a + b, 0) / r.length, sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1));
  const dn = Math.sqrt(r.reduce((a, b) => a + Math.min(b - rf / 252, 0) ** 2, 0) / r.length);
  let peak = -Infinity, dd = 0, ddLen = 0, curLen = 0; eq.forEach((v) => { if (v >= peak) { peak = v; curLen = 0; } else curLen++; ddLen = Math.max(ddLen, curLen); dd = Math.max(dd, 1 - v / peak); });
  const total = eq[eq.length - 1] / eq[0] - 1, cg = eq[0] > 0 && yrs > 0 ? (eq[eq.length - 1] / eq[0]) ** (1 / yrs) - 1 : null, vol = sd * Math.sqrt(252);
  return { total, cagr: cg, vol, sharpe: sd > 0 ? ((mean - rf / 252) / sd) * Math.sqrt(252) : null, sortino: dn > 0 ? ((mean - rf / 252) / dn) * Math.sqrt(252) : null, maxDD: dd, maxDDLen: ddLen, calmar: dd > 0 && cg != null ? cg / dd : null };
}
function monthly(eq, t) {
  const out = new Map(); let prev = eq[0];
  eq.forEach((v, i) => { const d = new Date((t[i] + 19800) * 1000), k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; const o = out.get(k) || { start: prev }; o.end = v; out.set(k, o); prev = v; });
  return [...out].map(([k, o]) => ({ month: k, ret: o.end / o.start - 1 }));
}

/** Run a small parameter grid; reports the spread so a single best result is never presented as "the" result. */
export function sensitivity(data, base, grid) {
  const rows = [];
  for (const topN of grid.topN || [base.topN]) for (const every of grid.every || [base.every]) {
    const r = run(data, { ...base, topN, every }); if (r.error) return { error: r.error };
    rows.push({ topN, every, cagr: r.metrics.cagr, maxDD: r.metrics.maxDD, sharpe: r.metrics.sharpe });
  }
  const c = rows.map((x) => x.cagr).filter(fin);
  return { rows, cagrMin: Math.min(...c), cagrMax: Math.max(...c), cagrSpread: Math.max(...c) - Math.min(...c) };
}
