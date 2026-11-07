// Financial calculators. Pure. Units: INR, fractions (0.1 = 10%), dates in ms. Formulas in docs/METHODOLOGY.md.
const fin = (n) => n != null && Number.isFinite(n);

export const cagr = (start, end, years) => (start > 0 && end > 0 && years > 0 ? (end / start) ** (1 / years) - 1 : null);
export const realReturn = (nominal, inflation) => (1 + nominal) / (1 + inflation) - 1;
export const compound = (p, rate, years, perYear = 1) => p * (1 + rate / perYear) ** (perYear * years);
/** Loss needed to recover: after a drawdown d (0.3 = −30%), the gain required to get back to the peak. */
export const recoveryGain = (d) => (d >= 0 && d < 1 ? 1 / (1 - d) - 1 : null);

/** XIRR via bisection (robust to bad starting guesses). flows: [{t(ms), amt}] (outflows negative). Null if no sign change. */
export function xirr(flows) {
  const f = flows.filter((x) => fin(x.amt) && x.amt !== 0).sort((a, b) => a.t - b.t);
  if (f.length < 2 || !f.some((x) => x.amt < 0) || !f.some((x) => x.amt > 0)) return null;
  const t0 = f[0].t, npv = (r) => f.reduce((a, x) => a + x.amt / (1 + r) ** ((x.t - t0) / (365 * 864e5)), 0);
  let lo = -0.9999, hi = 1000, flo = npv(lo), fhi = npv(hi);
  if (!(flo * fhi < 0)) return null;
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2, fm = npv(m); if (flo * fm <= 0) { hi = m; fhi = fm; } else { lo = m; flo = fm; } }
  return (lo + hi) / 2;
}

/** SIP future value. Monthly rate = (1+annual)^(1/12)-1 (effective). timing "start" = contribution at start of month. */
export function sip({ monthly, annual, months, stepUp = 0, stepEvery = 12, timing = "start" }) {
  const m = (1 + annual) ** (1 / 12) - 1;
  let fv = 0, invested = 0, cur = monthly;
  for (let k = 0; k < months; k++) {
    if (k > 0 && k % stepEvery === 0) cur *= 1 + stepUp;
    fv = (fv + (timing === "start" ? cur : 0)) * (1 + m) + (timing === "end" ? cur : 0);
    invested += cur;
  }
  return { fv, invested, gain: fv - invested };
}
/** Lump sum vs SIP of the same total outlay, same return (deterministic comparison, not a forecast). */
export function lumpVsSip({ total, annual, months }) {
  const monthly = total / months, s = sip({ monthly, annual, months });
  const lump = total * (1 + annual) ** (months / 12);
  return { sipFv: s.fv, lumpFv: lump, diff: lump - s.fv };
}
/** Real-world SIP XIRR from its own flows (start-of-month outflows, one inflow at the end) – verifies sip() consistency. */
export function sipXirr({ monthly, months, fv, start = Date.UTC(2020, 0, 1) }) {
  const flows = [];
  for (let k = 0; k < months; k++) flows.push({ t: start + k * 30.4375 * 864e5, amt: -monthly });
  flows.push({ t: start + months * 30.4375 * 864e5, amt: fv });
  return xirr(flows);
}

/** Position sizing. Returns qty, risk and notional. stop-distance or ATR-based; lot rounding down for derivatives. */
export function positionSize({ capital, riskPct, entry, stop = null, atr = null, atrMult = 2, lot = 1, maxPct = null, side = 1 }) {
  const dist = fin(stop) ? Math.abs(entry - stop) : fin(atr) ? atr * atrMult : null;
  if (!(capital > 0 && riskPct > 0 && entry > 0 && dist > 0)) return null;
  const riskAmt = capital * riskPct;
  let qty = riskAmt / dist;
  if (maxPct) qty = Math.min(qty, (capital * maxPct) / entry);
  qty = Math.floor(qty / lot) * lot;
  const stopPx = fin(stop) ? stop : entry - side * dist;
  return { qty, lots: Math.floor(qty / lot), notional: qty * entry, riskAmt: qty * dist, riskPctOfCapital: (qty * dist) / capital, stop: stopPx, dist };
}
export function rewardRisk({ entry, stop, target }) {
  const r = Math.abs(entry - stop), w = Math.abs(target - entry);
  return r > 0 ? { rr: w / r, breakevenWinRate: r / (r + w) } : null;
}
export const expectedMove = (spot, ivPct, days) => { const s = ivPct > 3 ? ivPct / 100 : ivPct; return spot * s * Math.sqrt(days / 365); };
export const futuresBasis = (fut, spot, days) => ({ basis: fut - spot, pct: fut / spot - 1, annualised: days > 0 ? (fut / spot - 1) * (365 / days) : null });
export const optionBreakeven = ({ type, strike, premium, side = 1 }) => (type === "CE" ? strike + side * premium : strike - side * premium);
export const fdVsMarket = ({ amount, fdRate, marketReturn, years, taxRate }) => {
  const fd = amount * (1 + fdRate * (1 - taxRate)) ** years; // interest taxed yearly at slab
  const mk = amount + (amount * (1 + marketReturn) ** years - amount) * (1 - taxRate);
  return { fd, market: mk };
};

/**
 * Transaction-cost model. Rates are an EDITABLE, VERSIONED ASSUMPTION; they are NOT verified against the current exchange/
 * SEBI/Dhan circulars. Check them before relying on cost-adjusted numbers. All percentages are fractions of turnover.
 */
export const CHARGES = {
  version: "default-2025 (unverified assumption)",
  eq_delivery: { brokerage: { flat: 0, pct: 0, cap: 0 }, stt: { buy: 0.001, sell: 0.001 }, exch: 0.0000307, stamp: { buy: 0.00015, sell: 0 }, sebi: 10 / 1e7, gst: 0.18 },
  eq_intraday: { brokerage: { flat: 20, pct: 0.0003, cap: 20 }, stt: { buy: 0, sell: 0.00025 }, exch: 0.0000307, stamp: { buy: 0.00003, sell: 0 }, sebi: 10 / 1e7, gst: 0.18 },
  fut: { brokerage: { flat: 20, pct: 0.0003, cap: 20 }, stt: { buy: 0, sell: 0.0002 }, exch: 0.0000183, stamp: { buy: 0.00002, sell: 0 }, sebi: 10 / 1e7, gst: 0.18 },
  opt: { brokerage: { flat: 20, pct: 0, cap: 20 }, stt: { buy: 0, sell: 0.001 }, exch: 0.0003503, stamp: { buy: 0.00003, sell: 0 }, sebi: 10 / 1e7, gst: 0.18 },
};
/** Cost of ONE order leg. turnover = price × qty (premium × qty for options). Returns itemised costs. */
export function orderCost(seg, side, turnover, sched = CHARGES) {
  const c = sched[seg]; if (!c || !(turnover >= 0)) return null;
  const b = c.brokerage, brokerage = b.pct ? Math.min(b.cap || Infinity, Math.max(b.flat ? Math.min(b.flat, turnover * b.pct || b.flat) : 0, turnover * b.pct)) : b.flat;
  const stt = turnover * (side === "buy" ? c.stt.buy : c.stt.sell), exch = turnover * c.exch, stamp = turnover * (side === "buy" ? c.stamp.buy : c.stamp.sell), sebi = turnover * c.sebi;
  const gst = (brokerage + exch + sebi) * c.gst;
  const total = brokerage + stt + exch + stamp + sebi + gst;
  return { brokerage, stt, exch, stamp, sebi, gst, total, pct: turnover > 0 ? total / turnover : 0 };
}
