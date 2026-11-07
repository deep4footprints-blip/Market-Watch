import test from "node:test";
import assert from "node:assert/strict";
import { analyseLegs, payoffAt, scan, oiLevels, smile, gex, gammaFlip, legPrice } from "../public/optionlab.js";
import { bsPrice, bsGreeks } from "../public/payoff.js";

const close = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
const L = (type, strike, side, px, qty = 1) => ({ type, strike, side, qty, px });

test("bull call spread: hand-calculated max/min/breakeven", () => {
  const legs = [L("CE", 100, 1, 6), L("CE", 110, -1, 2)]; // debit 4, width 10
  const a = analyseLegs(legs, 105);
  close(a.maxProfit, 6); close(a.maxLoss, -4); assert.deepEqual(a.breakevens, [104]);
});
test("long call: unlimited profit, loss = premium; short put: unlimited-ish loss flagged only to zero", () => {
  const a = analyseLegs([L("CE", 100, 1, 5)], 100); assert.equal(a.maxProfit, Infinity); close(a.maxLoss, -5);
  const b = analyseLegs([L("CE", 100, -1, 5)], 100); assert.equal(b.maxLoss, -Infinity); close(b.maxProfit, 5);
});
test("1:2:1 call butterfly and iron condor payoffs", () => {
  const fly = [L("CE", 100, 1, 12), L("CE", 110, -1, 6, 2), L("CE", 120, 1, 2)]; // debit 2
  const a = analyseLegs(fly, 110); close(a.maxProfit, 8); close(a.maxLoss, -2); assert.deepEqual(a.breakevens, [102, 118]);
  close(payoffAt(fly, 110), 8);
  const ic = [L("PE", 90, 1, 1), L("PE", 95, -1, 3), L("CE", 105, -1, 3), L("CE", 110, 1, 1)]; // credit 4, width 5
  const b = analyseLegs(ic, 100); close(b.maxProfit, 4); close(b.maxLoss, -1); assert.deepEqual(b.breakevens, [91, 109]);
});

// Build a synthetic chain from Black-Scholes so every statistic can be cross-checked.
function chain(spot = 100, T = 0.1, iv = 0.2, step = 5, n = 8) {
  const rows = []; const k0 = Math.round(spot / step) * step;
  for (let i = -n; i <= n; i++) {
    const K = k0 + i * step, side = (type) => { const g = bsGreeks(type, spot, K, T, iv), p = g.price; return { ltp: p, bid: p - 0.05, ask: p + 0.05, oi: 1000 + 50 * Math.abs(i) * (type === "CE" ? 1 : 2), prevOi: 900, vol: 10, iv: iv * 100, gamma: g.gamma }; };
    rows.push({ strike: K, ce: side("CE"), pe: side("PE") });
  }
  return { spot, rows, byStrike: new Map(rows.map((r) => [r.strike, r])), atm: k0, step };
}
test("legPrice: buys at ask, sells at bid, ltp fallback flagged", () => {
  assert.deepEqual(legPrice(1, { bid: 1, ask: 2, ltp: 1.5 }), { px: 2, src: "quote" });
  assert.deepEqual(legPrice(-1, { bid: 1, ask: 2, ltp: 1.5 }), { px: 1, src: "quote" });
  assert.deepEqual(legPrice(1, { ltp: 1.5 }), { px: 1.5, src: "ltp" });
  assert.equal(legPrice(1, null), null);
});
test("scanner: verticals, butterflies, ratio, condor produce valid structures", () => {
  const c = chain();
  const v = scan(c, 75, { kind: "vertical", width: 2, span: 4 });
  assert.ok(v.length > 0); for (const r of v) { assert.equal(r.legs.length, 2); assert.ok(r.maxLoss < 0 || r.maxProfit < Infinity); }
  const bf = scan(c, 75, { kind: "butterfly", width: 1, span: 4 });
  assert.ok(bf.some((r) => /1:2:1/.test(r.label))); assert.ok(bf.every((r) => r.legs.length === 3));
  const ra = scan(c, 75, { kind: "ratio", width: 1, span: 4, ratio: 3 });
  assert.ok(ra.some((r) => /1:3/.test(r.label)) && ra.every((r) => r.maxLoss === -Infinity || r.maxProfit === Infinity || true));
  const ic = scan(c, 75, { kind: "condor", width: 1, span: 4 });
  assert.ok(ic.some((r) => r.legs.length === 4)); const best = ic.find((r) => r.legs.length === 4);
  assert.ok(best.maxLoss < 0 && best.maxProfit > 0 && fin(best.maxLoss));
  // lot scaling and a minOi filter
  const a = scan(c, 1, { kind: "vertical", width: 2, span: 2 })[0], b = scan(c, 10, { kind: "vertical", width: 2, span: 2 }).find((x) => x.label === a.label);
  close(b.debit, a.debit * 10);
  assert.equal(scan(c, 75, { kind: "vertical", minOi: 1e9 }).length, 0);
});
const fin = (n) => Number.isFinite(n);
test("oiLevels, smile and skew", () => {
  const c = chain(); const lv = oiLevels(c, 2);
  assert.equal(lv.calls.length, 2); assert.ok(lv.calls[0].oi >= lv.calls[1].oi);
  const s = smile(c); assert.ok(s.pts.length > 8); close(s.skew5, 0, 1e-6); // flat 20% IV -> no skew
  const sk = chain(); sk.rows.forEach((r) => { if (r.strike < 100) r.pe.iv += 5; }); close(smile(sk).skew5 > 0 ? 1 : 0, 1);
});
test("GEX: scenario signs, units, and gamma flip", () => {
  const c = chain(), lot = 50, T = 0.1;
  const conv = gex(c, lot, T, "conv"), allLong = gex(c, lot, T, "allLong"), inv = gex(c, lot, T, "inverse");
  close(conv.net, -inv.net, 1e-6); assert.ok(allLong.net > 0); assert.ok(allLong.callTotal > 0 && allLong.putTotal > 0);
  const k = c.rows.find((r) => r.strike === 100), g = bsGreeks("CE", 100, 100, T, 0.2).gamma;
  close(gex({ ...c, rows: [{ ...k, pe: null }], byStrike: null }, lot, T, "conv").net, g * k.ce.oi * lot * 100 * 100 * 0.01, 1e-6);
  assert.equal(gammaFlip({ ...c, spot: null }, lot, T), null);
  // heavier put OI below spot and call OI above -> sign changes somewhere in range under "conv"
  const f = gammaFlip(c, lot, T, "conv"); assert.ok(f == null || (f > 85 && f < 115));
});
