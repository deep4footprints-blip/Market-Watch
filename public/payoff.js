// Options pricing + strategy analytics. Pure functions (no DOM) so they run in the browser and under node:test.
// Model: Black-Scholes on the index spot with a flat risk-free rate and no dividends. A model, not a quote:
// numbers are for judging structure (shape, breakevens, greeks), not for matching a broker's margin or fills.

export const RATE = 0.065;
const SQ2PI = Math.sqrt(2 * Math.PI);
export const npdf = (x) => Math.exp(-0.5 * x * x) / SQ2PI;

// Cumulative normal, double precision (Hart 1968 / West 2009 rational approximation, error ~1e-15).
export function ncdf(x) {
  const ax = Math.abs(x);
  let c;
  if (ax > 37) c = 0;
  else {
    const e = Math.exp((-ax * ax) / 2);
    if (ax < 7.07106781186547) {
      let b = 3.52624965998911e-2 * ax + 0.700383064443688;
      b = b * ax + 6.37396220353165;
      b = b * ax + 33.912866078383;
      b = b * ax + 112.079291497871;
      b = b * ax + 221.213596169931;
      b = b * ax + 220.206867912376;
      c = e * b;
      let d = 8.83883476483184e-2 * ax + 1.75566716318264;
      d = d * ax + 16.064177579207;
      d = d * ax + 86.7807322029461;
      d = d * ax + 296.564248779674;
      d = d * ax + 637.333633378831;
      d = d * ax + 793.826512519948;
      d = d * ax + 440.413735824752;
      c = c / d;
    } else {
      let b = ax + 0.65;
      b = ax + 4 / b;
      b = ax + 3 / b;
      b = ax + 2 / b;
      b = ax + 1 / b;
      c = e / b / 2.506628274631;
    }
  }
  return x > 0 ? 1 - c : c;
}

const intrinsic = (type, S, K) => Math.max(type === "CE" ? S - K : K - S, 0);

function d12(S, K, T, s, r) {
  const v = s * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * s * s) * T) / v;
  return [d1, d1 - v];
}

export function bsPrice(type, S, K, T, s, r = RATE) {
  if (T <= 0 || s <= 0) return intrinsic(type, S, K);
  const [d1, d2] = d12(S, K, T, s, r);
  const df = Math.exp(-r * T);
  return type === "CE" ? S * ncdf(d1) - K * df * ncdf(d2) : K * df * ncdf(-d2) - S * ncdf(-d1);
}

/** Per-unit greeks. theta per calendar day, vega per 1 volatility point (1%). */
export function bsGreeks(type, S, K, T, s, r = RATE) {
  if (T <= 0 || s <= 0) {
    return { price: intrinsic(type, S, K), delta: type === "CE" ? (S > K ? 1 : 0) : S < K ? -1 : 0, gamma: 0, theta: 0, vega: 0 };
  }
  const [d1, d2] = d12(S, K, T, s, r);
  const df = Math.exp(-r * T);
  const sq = Math.sqrt(T);
  const price = type === "CE" ? S * ncdf(d1) - K * df * ncdf(d2) : K * df * ncdf(-d2) - S * ncdf(-d1);
  const delta = type === "CE" ? ncdf(d1) : ncdf(d1) - 1;
  const gamma = npdf(d1) / (S * s * sq);
  const decay = (-S * npdf(d1) * s) / (2 * sq);
  const theta = (type === "CE" ? decay - r * K * df * ncdf(d2) : decay + r * K * df * ncdf(-d2)) / 365;
  const vega = (S * npdf(d1) * sq) / 100;
  return { price, delta, gamma, theta, vega };
}

/** Implied vol (decimal) from a premium, or null if the price is outside what the model can produce. */
export function impliedVol(type, price, S, K, T, r = RATE) {
  if (!(price > 0) || !(T > 0) || !(S > 0) || !(K > 0)) return null;
  let lo = 0.005, hi = 4;
  if (price < bsPrice(type, S, K, T, lo, r) - 1e-9 || price > bsPrice(type, S, K, T, hi, r)) return null;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (bsPrice(type, S, K, T, mid, r) > price) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

// ---- legs: { type:"CE"|"PE", strike, side:+1|-1, lots, entry, iv } ----
export const legQty = (l, lot) => l.side * l.lots * lot;

export function expiryPnl(legs, lot, S) {
  let p = 0;
  for (const l of legs) p += legQty(l, lot) * (intrinsic(l.type, S, l.strike) - l.entry);
  return p;
}

export function scenarioPnl(legs, lot, S, T, ivShift = 0, r = RATE) {
  let p = 0;
  for (const l of legs) p += legQty(l, lot) * (bsPrice(l.type, S, l.strike, T, Math.max(l.iv + ivShift, 0.01), r) - l.entry);
  return p;
}

/** Position-weighted greeks of one leg: delta in index units, gamma per point, theta Rs/day, vega Rs per vol point. */
export function legGreeks(l, lot, S, T, ivShift = 0, r = RATE) {
  const g = bsGreeks(l.type, S, l.strike, T, Math.max(l.iv + ivShift, 0.01), r);
  const q = legQty(l, lot);
  return { price: g.price, delta: g.delta * q, gamma: g.gamma * q, theta: g.theta * q, vega: g.vega * q };
}

export function portfolioGreeks(legs, lot, S, T, ivShift = 0, r = RATE) {
  const t = { delta: 0, gamma: 0, theta: 0, vega: 0 };
  for (const l of legs) {
    const g = legGreeks(l, lot, S, T, ivShift, r);
    t.delta += g.delta; t.gamma += g.gamma; t.theta += g.theta; t.vega += g.vega;
  }
  return t;
}

/**
 * Exact (not grid-based) expiry analytics: the expiry payoff is piecewise linear with kinks at strikes,
 * so extremes and breakevens are solved on the kinks. POP / expected value use a lognormal at atmIv.
 */
export function analyze(legs, lot, { spot, T, atmIv, r = RATE, offset = 0 }) {
  if (!legs.length) return null;
  // offset = realised P&L of exited legs: a constant added to the whole payoff curve
  const P = (x) => expiryPnl(legs, lot, x) + offset;
  const strikes = [...new Set(legs.map((l) => l.strike))].sort((a, b) => a - b);
  const xs = [0, ...strikes];
  const ys = xs.map((x) => P(x));
  const rightSlope = legs.reduce((a, l) => a + (l.type === "CE" ? legQty(l, lot) : 0), 0);
  const netPremium = legs.reduce((a, l) => a - legQty(l, lot) * l.entry, 0); // + = credit received

  const unlimitedProfit = rightSlope > 0;
  const unlimitedLoss = rightSlope < 0;
  const maxProfit = unlimitedProfit ? Infinity : Math.max(...ys);
  const maxLoss = unlimitedLoss ? -Infinity : Math.min(...ys);

  const be = [];
  const add = (x) => { if (x > 1e-6 && !be.some((b) => Math.abs(b - x) < 1e-6)) be.push(x); };
  for (let i = 0; i < xs.length - 1; i++) {
    const [x0, x1, y0, y1] = [xs[i], xs[i + 1], ys[i], ys[i + 1]];
    if (Math.abs(y0) < 1e-9) add(x0);
    else if (y0 * y1 < 0) add(x0 + ((0 - y0) * (x1 - x0)) / (y1 - y0));
  }
  const xn = xs[xs.length - 1], yn = ys[ys.length - 1];
  if (Math.abs(yn) < 1e-9) add(xn);
  if (rightSlope !== 0) { const x = xn - yn / rightSlope; if (x > xn + 1e-9) add(x); }
  be.sort((a, b) => a - b);

  let pop = null, expected = null, sd = null;
  const sig = atmIv > 0 ? atmIv : null;
  if (T > 0 && sig && spot > 0) {
    const st = sig * Math.sqrt(T);
    const mu = Math.log(spot) + (r - 0.5 * sig * sig) * T;
    const cdfAt = (x) => (x <= 0 ? 0 : x === Infinity ? 1 : ncdf((Math.log(x) - mu) / st));
    const bounds = [0, ...be, Infinity];
    pop = 0;
    for (let i = 0; i < bounds.length - 1; i++) {
      const [a, b] = [bounds[i], bounds[i + 1]];
      const m = b === Infinity ? Math.max(a, xn) * 1.1 + 1 : (a + b) / 2;
      if (P(m) > 1e-9) pop += cdfAt(b) - cdfAt(a);
    }
    expected = 0;
    const dz = 0.01;
    for (let z = -6; z <= 6; z += dz) expected += P(Math.exp(mu + st * z)) * npdf(z) * dz;
    sd = spot * sig * Math.sqrt(T);
  }
  return { netPremium, maxProfit, maxLoss, unlimitedProfit, unlimitedLoss, breakevens: be, pop, expected, sd, rightSlope };
}

/** Realised P&L of exited legs: (exit - entry) * signed quantity. Open legs are valued separately (LTP - entry). */
export function realizedPnl(legs, lot) {
  let p = 0;
  for (const l of legs) if (Number.isFinite(l.exit)) p += legQty(l, lot) * (l.exit - l.entry);
  return p;
}

// ---------------------------------------------------------------------------------------------
// Next-step optimizer. Enumerates single adjustments (exit a leg, add a leg, roll a leg to another strike) from the
// live chain and ranks them by a transparent risk-adjusted score on the model distribution of the expiry index level:
//     U = E[P&L] + 0.5 * ES5          (ES5 = mean P&L over the worst 5% of outcomes, so a fatter loss tail lowers U)
// It ranks shapes under the model; it is not a forecast, ignores margin, and treats each order as costing COST per unit.
// ---------------------------------------------------------------------------------------------
export const COST = 0.5; // Rs per unit per order: slippage proxy for crossing the spread

function distribution(spot, T, sig, r) {
  const st = sig * Math.sqrt(T), mu = Math.log(spot) + (r - 0.5 * sig * sig) * T;
  const zs = [], ws = [];
  let tot = 0;
  for (let z = -4; z <= 4.0001; z += 0.04) { const w = npdf(z); zs.push(Math.exp(mu + st * z)); ws.push(w); tot += w; }
  return { xs: zs, ws: ws.map((w) => w / tot) };
}

/** Risk metrics of a leg set (+ constant realised P&L) over the model distribution. */
export function riskMetrics(legs, lot, realized, dist) {
  const n = dist.xs.length, ps = new Array(n);
  let E = 0, pop = 0;
  for (let i = 0; i < n; i++) {
    const p = expiryPnl(legs, lot, dist.xs[i]) + realized;
    ps[i] = p; E += p * dist.ws[i]; if (p > 1e-9) pop += dist.ws[i];
  }
  const idx = ps.map((_, i) => i).sort((a, b) => ps[a] - ps[b]);
  let acc = 0, es = 0;
  for (const i of idx) { const w = Math.min(dist.ws[i], 0.05 - acc); if (w <= 0) break; es += ps[i] * w; acc += w; }
  es /= 0.05;
  return { E, ES: es, pop, U: E + 0.5 * es };
}

/**
 * legs: open legs {type,strike,side,lots,entry,iv}. quotes: [{type,strike,price,iv,oi?}] for the chain.
 * Returns { base, legs:[{i,verdict,dU,roll?}], best, alts, hold } or null when there is nothing to evaluate.
 */
export function suggest(legs, lot, { spot, T, atmIv, realized = 0, quotes = [], r = RATE, maxStrikeDist = 0.06 }) {
  if (!legs.length || !(T > 0) || !(atmIv > 0) || !(spot > 0)) return null;
  const dist = distribution(spot, T, atmIv, r);
  const priceOf = new Map(quotes.map((q) => [`${q.type}:${q.strike}`, q]));
  const base = riskMetrics(legs, lot, realized, dist);
  const refLots = Math.max(1, ...legs.map((l) => l.lots));
  const fmtLeg = (sd, ty, K, lots, px) => ({ action: sd > 0 ? "BUY" : "SELL", type: ty, strike: K, lots, price: px });
  const close = (l) => {
    const q = priceOf.get(`${l.type}:${l.strike}`);
    return q ? { q, pnl: legQty(l, lot) * (q.price - l.entry) - COST * Math.abs(legQty(l, lot)) } : null;
  };
  const cands = [];
  const push = (kind, steps, nextLegs, nextRealized, extra = {}) => {
    const m = riskMetrics(nextLegs, lot, nextRealized, dist);
    cands.push({ kind, steps, legsAfter: nextLegs, realizedAfter: nextRealized, dU: m.U - base.U, after: m, ...extra });
  };
  // exits
  const legVerdicts = legs.map((l, i) => {
    const c = close(l);
    if (!c) return { i, verdict: "HOLD", dU: 0 };
    const rest = legs.filter((_, j) => j !== i);
    const step = [fmtLeg(-l.side, l.type, l.strike, l.lots, c.q.price)];
    if (rest.length || true) push("EXIT", step, rest, realized + c.pnl, { legIndex: i });
    return { i, dU: cands[cands.length - 1].dU };
  });
  // adds (skip strikes already held open on that type: use lots +/- on the leg instead)
  const held = new Set(legs.map((l) => `${l.type}:${l.strike}`));
  // new orders only in liquid, ATM/OTM strikes (deep ITM options are capital-heavy and add nothing a spread would not)
  const liquid = quotes.filter((q) => q.price >= 2 && (q.oi == null || q.oi > 0) && Math.abs(q.strike - spot) / spot <= maxStrikeDist
    && (q.type === "CE" ? q.strike >= spot * 0.995 : q.strike <= spot * 1.005));
  for (const q of liquid) {
    if (held.has(`${q.type}:${q.strike}`)) continue;
    for (const sd of [1, -1]) {
      const nl = { type: q.type, strike: q.strike, side: sd, lots: refLots, entry: q.price, iv: q.iv || atmIv };
      push("ADD", [fmtLeg(sd, q.type, q.strike, refLots, q.price)], [...legs, nl], realized - COST * refLots * lot);
    }
  }
  // rolls: close a leg, open the same side/type/lots at another strike
  legs.forEach((l, i) => {
    const c = close(l);
    if (!c) return;
    for (const q of liquid) {
      if (q.type !== l.type || q.strike === l.strike || held.has(`${q.type}:${q.strike}`)) continue;
      const nl = { ...l, strike: q.strike, entry: q.price, iv: q.iv || atmIv, exit: undefined };
      const rest = legs.map((x, j) => (j === i ? nl : x));
      push("ROLL", [fmtLeg(-l.side, l.type, l.strike, l.lots, c.q.price), fmtLeg(l.side, q.type, q.strike, l.lots, q.price)], rest,
        realized + c.pnl - COST * Math.abs(legQty(l, lot)), { legIndex: i });
    }
  });
  cands.sort((a, b) => b.dU - a.dU);
  const threshold = Math.max(300, 0.01 * Math.abs(base.ES));
  const best = cands[0] && cands[0].dU > threshold ? cands[0] : null;
  const alts = [];
  const seen = new Set(best ? [best.kind] : []);
  for (const c of cands) {
    if (c === best || c.dU <= threshold || seen.has(c.kind)) continue;
    seen.add(c.kind); alts.push(c);
  }
  // leg-by-leg: a leg is flagged EXIT/ROLL only if that move is among the five best adjustments overall, otherwise HOLD
  const top5 = cands.slice(0, 5).filter((c) => c.dU > threshold);
  const verdicts = legs.map((l, i) => {
    const hit = top5.find((c) => (c.kind === "EXIT" || c.kind === "ROLL") && c.legIndex === i);
    return { i, verdict: hit ? hit.kind : "HOLD", exitDU: legVerdicts[i].dU, roll: hit?.kind === "ROLL" ? { steps: hit.steps, dU: hit.dU } : null };
  });
  const exact = (c) => (c ? { ...c, exact: analyze(c.legsAfter, lot, { spot, T, atmIv, r, offset: c.realizedAfter }) } : c);
  return {
    base: { ...base, exact: analyze(legs, lot, { spot, T, atmIv, r, offset: realized }), g: portfolioGreeks(legs, lot, spot, T, 0, r) },
    legs: verdicts,
    best: exact(best),
    alts: alts.slice(0, 3).map(exact),
    hold: !best,
    tested: cands.length,
  };
}
