// Options lab over a normalised Dhan chain (dhan.js normalizeChain): spread scanners, OI levels, IV smile/skew, GEX estimate.
// Prices: buys at ask, sells at bid when a two-sided quote exists, else LTP (flagged). A theoretical price is NOT necessarily executable.
import { bsGreeks, RATE } from "./payoff.js";

const fin = (n) => n != null && Number.isFinite(n);
const ivDec = (v) => (fin(v) && v > 0 ? (v > 3 ? v / 100 : v) : null); // Dhan sends percent

export function legPrice(side, o) {
  if (!o) return null;
  const q = side > 0 ? o.ask : o.bid;
  if (fin(q) && q > 0) return { px: q, src: "quote" };
  return fin(o.ltp) && o.ltp > 0 ? { px: o.ltp, src: "ltp" } : null;
}

/** Expiry payoff of legs [{type,strike,side,qty,px}] per unit of underlying at settlement price S (premium included). */
export const payoffAt = (legs, S) => legs.reduce((a, l) => a + l.side * l.qty * ((l.type === "CE" ? Math.max(S - l.strike, 0) : Math.max(l.strike - S, 0)) - l.px), 0);

/** Exact for piecewise-linear payoffs: evaluate at strikes and beyond both ends. */
export function analyseLegs(legs, spot) {
  const ks = [...new Set(legs.map((l) => l.strike))].sort((a, b) => a - b);
  const lo = 0, hi = Math.max(ks[ks.length - 1] * 3, spot * 3), pts = [lo, ...ks, hi];
  const v = pts.map((S) => payoffAt(legs, S));
  const slopeHi = (v[v.length - 1] - v[v.length - 2]) / (hi - ks[ks.length - 1] || 1);
  const slopeLo = (v[1] - v[0]) / (ks[0] - lo || 1);
  const unlimitedProfit = slopeHi > 1e-9 || slopeLo < -1e-9, unlimitedLoss = slopeHi < -1e-9 || slopeLo > 1e-9;
  const be = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    if (v[i] === 0 && i > 0) { be.push(pts[i]); continue; }
    if (v[i] * v[i + 1] < 0) be.push(pts[i] + ((0 - v[i]) * (pts[i + 1] - pts[i])) / (v[i + 1] - v[i]));
  }
  return { maxProfit: unlimitedProfit ? Infinity : Math.max(...v), maxLoss: unlimitedLoss ? -Infinity : Math.min(...v), breakevens: [...new Set(be.map((x) => +x.toFixed(2)))], v, pts };
}

const STRATS = {
  bullCall: (K1, K2) => [["CE", K1, 1], ["CE", K2, -1]],
  bearCall: (K1, K2) => [["CE", K1, -1], ["CE", K2, 1]],
  bullPut: (K1, K2) => [["PE", K1, 1], ["PE", K2, -1]],
  bearPut: (K1, K2) => [["PE", K1, -1], ["PE", K2, 1]],
};
export const SCANNERS = {
  vertical: "Vertical spreads (bull/bear call/put)",
  butterfly: "Butterfly (call/put, 1:2:1 and ratio)",
  ratio: "Ratio spreads (1:2 … 1:5)",
  condor: "Iron condor / iron butterfly",
};

/**
 * Scan combinations within ±`span` strikes of ATM. opts: { kind, span, width (strike steps), ratio, maxResults, minOi, maxSpreadPct }.
 * Returns rows sorted by risk/reward style rank with leg-level detail. lot multiplies per-unit values to rupees.
 */
export function scan(chain, lot, opts = {}) {
  const { kind = "vertical", span = 8, width = 2, ratio = 2, minOi = 0, maxSpreadPct = 100, maxResults = 40 } = opts;
  const ks = chain.rows.map((r) => r.strike), ai = ks.indexOf(chain.atm); if (ai < 0) return [];
  const lo = Math.max(0, ai - span), hi = Math.min(ks.length - 1, ai + span);
  const row = (K) => chain.byStrike.get(K);
  const out = [];
  const build = (defs, label) => {
    const legs = [];
    for (const [type, K, side, qty = 1] of defs) {
      const o = type === "CE" ? row(K)?.ce : row(K)?.pe, p = legPrice(side, o);
      if (!p || (o.oi || 0) < minOi) return;
      const sp = fin(o.bid) && fin(o.ask) && o.ask > 0 && o.bid > 0 ? ((o.ask - o.bid) / ((o.ask + o.bid) / 2)) * 100 : null;
      if (sp != null && sp > maxSpreadPct) return;
      legs.push({ type, strike: K, side, qty, px: p.px, src: p.src, oi: o.oi || 0, spreadPct: sp });
    }
    const a = analyseLegs(legs, chain.spot);
    const net = legs.reduce((s, l) => s + l.side * l.qty * l.px, 0); // + = debit paid
    const maxP = a.maxProfit * lot, maxL = a.maxLoss * lot;
    out.push({ label, legs, debit: net * lot, maxProfit: maxP, maxLoss: maxL, rr: fin(maxP) && fin(maxL) && maxL < 0 ? maxP / -maxL : null, breakevens: a.breakevens,
      quotes: legs.every((l) => l.src === "quote") ? "bid/ask" : "includes LTP fallback", worstSpreadPct: Math.max(0, ...legs.map((l) => l.spreadPct ?? 0)) });
  };
  for (let i = lo; i <= hi; i++) {
    const K = ks[i];
    if (kind === "vertical") for (const [name, f] of Object.entries(STRATS)) { const j = i + width; if (j <= hi) build(f(K, ks[j]).map(([t, k, s]) => [t, k, s]), `${name} ${K}/${ks[j]}`); }
    else if (kind === "butterfly") {
      for (const type of ["CE", "PE"]) for (const [a, b, c] of [[1, 2, 1], [1, 3, 2], [1, 4, 3], [1, 5, 4]]) {
        const j = i + width, k = i + 2 * width; if (k > hi || (b !== a + c)) continue; // net-premium-neutral wings: middle = a + c units short
        build([[type, K, 1, a], [type, ks[j], -1, b], [type, ks[k], 1, c]], `${type} fly ${a}:${b}:${c} ${K}/${ks[j]}/${ks[k]}`);
      }
    } else if (kind === "ratio") {
      const j = i + width; if (j > hi) continue;
      for (let r = 2; r <= Math.max(2, Math.min(5, ratio)); r++) { build([["CE", K, 1, 1], ["CE", ks[j], -1, r]], `call ratio 1:${r} ${K}/${ks[j]}`); build([["PE", ks[j], 1, 1], ["PE", K, -1, r]], `put ratio 1:${r} ${ks[j]}/${K}`); }
    }
  }
  if (kind === "condor") {
    for (let d = 1; d <= span; d++) for (const w of [width, width * 2]) {
      const pe = ai - d, ce = ai + d; if (pe - w < 0 || ce + w >= ks.length) continue;
      build([["PE", ks[pe - w], 1], ["PE", ks[pe], -1], ["CE", ks[ce], -1], ["CE", ks[ce + w], 1]], `condor ${ks[pe - w]}/${ks[pe]}/${ks[ce]}/${ks[ce + w]}`);
    }
    for (const w of [width, width * 2]) { if (ai - w < 0 || ai + w >= ks.length) continue; build([["PE", ks[ai - w], 1], ["PE", chain.atm, -1], ["CE", chain.atm, -1], ["CE", ks[ai + w], 1]], `iron butterfly ${chain.atm} ±${w * (chain.step || 1)}`); }
  }
  const seen = new Set();
  return out.filter((r) => (seen.has(r.label) ? false : seen.add(r.label))).sort((a, b) => (b.rr ?? -1) - (a.rr ?? -1)).slice(0, maxResults);
}

/** OI levels: strikes with the largest call / put OI (descriptive support/resistance, not predictions). */
export function oiLevels(chain, k = 3) {
  const top = (side) => chain.rows.map((r) => ({ strike: r.strike, oi: r[side]?.oi || 0, chg: (r[side]?.oi || 0) - (r[side]?.prevOi || 0) })).filter((x) => x.oi > 0).sort((a, b) => b.oi - a.oi).slice(0, k);
  return { calls: top("ce"), puts: top("pe") };
}

/** Smile from OTM options (puts below spot, calls above): [{strike, mny, iv}] and a simple 5%-wing skew (put IV − call IV, vol points). */
export function smile(chain) {
  const pts = [];
  for (const r of chain.rows) {
    const o = r.strike < chain.spot ? r.pe : r.ce, iv = ivDec(o?.iv);
    if (iv) pts.push({ strike: r.strike, mny: r.strike / chain.spot - 1, iv, side: r.strike < chain.spot ? "PE" : "CE" });
  }
  const at = (m) => { // linear interpolation on moneyness
    const s = [...pts].sort((a, b) => a.mny - b.mny); for (let i = 0; i + 1 < s.length; i++) if (s[i].mny <= m && s[i + 1].mny >= m) return s[i].iv + ((s[i + 1].iv - s[i].iv) * (m - s[i].mny)) / (s[i + 1].mny - s[i].mny || 1); return null;
  };
  const p5 = at(-0.05), c5 = at(0.05);
  return { pts, skew5: fin(p5) && fin(c5) ? (p5 - c5) * 100 : null, put5: p5, call5: c5 };
}

/**
 * Gamma exposure ESTIMATE (₹ per 1% move in spot) per strike. Gamma from the provider's greeks when present, else Black-Scholes from the option's IV.
 * Exchange OI does not reveal dealer positioning, so the sign convention is a SCENARIO:
 *   "conv":     calls +, puts − (classic assumption: dealers long calls, short puts)
 *   "allLong":  calls +, puts +  (dealers net long gamma everywhere: upper bound on stabilisation)
 *   "inverse":  calls −, puts +  (opposite assumption)
 * gex = gamma × OI × lot × spot² × 0.01 × sign.  Units: ₹ of delta-hedge notional per 1% spot move.
 */
export const GEX_SCENARIOS = { conv: [1, -1], allLong: [1, 1], inverse: [-1, 1] };
export function gex(chain, lot, T, scenario = "conv", spot = chain.spot) {
  const [sc, sp] = GEX_SCENARIOS[scenario] || GEX_SCENARIOS.conv;
  const rows = chain.rows.map((r) => {
    const g = (o, type) => { if (!o || !(o.oi > 0)) return 0; const iv = ivDec(o.iv); const gm = spot === chain.spot && fin(o.gamma) ? o.gamma : iv && T > 0 ? bsGreeks(type, spot, r.strike, T, iv, RATE).gamma : 0; return gm * o.oi * lot * spot * spot * 0.01; };
    const c = g(r.ce, "CE") * sc, p = g(r.pe, "PE") * sp;
    return { strike: r.strike, call: c, put: p, net: c + p };
  });
  return { rows, net: rows.reduce((a, r) => a + r.net, 0), callTotal: rows.reduce((a, r) => a + r.call, 0), putTotal: rows.reduce((a, r) => a + r.put, 0) };
}
/** Gamma-flip estimate: spot level (±10%) where net GEX changes sign, re-pricing every option's gamma at each trial spot. Null if none. */
export function gammaFlip(chain, lot, T, scenario = "conv") {
  if (!fin(chain.spot) || !(T > 0)) return null;
  let prev = null;
  for (let k = -20; k <= 20; k++) {
    const s = chain.spot * (1 + k * 0.005), v = gex(chain, lot, T, scenario, s).net;
    if (prev && prev.v * v < 0) return prev.s + ((0 - prev.v) * (s - prev.s)) / (v - prev.v);
    prev = { s, v };
  }
  return null;
}
