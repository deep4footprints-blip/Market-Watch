import test from "node:test";
import assert from "node:assert/strict";
import { smaS, emaS, rsiS, macdS, atrS, bollS, adxS, stochS, donchianS, relVol } from "../public/indicators.js";

const bars = (cl, spread = 1, v = 100) => cl.map((c, i) => ({ t: i, o: c, h: c + spread, l: c - spread, c, v }));
test("SMA/EMA hand-calculated", () => {
  assert.deepEqual(smaS([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
  const e = emaS([1, 2, 3, 4, 5], 3); // seed = 2, k = .5 -> 3, 4
  assert.deepEqual(e, [null, null, 2, 3, 4]);
});
test("RSI(14) matches the classic Wilder/StockCharts worked example (~70.5)", () => {
  const cl = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
  const r = rsiS(cl);
  assert.ok(Math.abs(r[14] - 70.46) < 0.5, String(r[14]));
  assert.equal(r[13], null);
  assert.equal(rsiS([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]).pop(), 100);
});
test("MACD of a constant is zero; of a rising series positive", () => {
  const c = macdS(Array(60).fill(10)); assert.equal(c.line[59], 0); assert.equal(c.hist[59], 0);
  assert.ok(macdS(Array.from({ length: 80 }, (_, i) => 10 + i)).line[79] > 0);
});
test("ATR of constant-range bars equals the range", () => {
  const a = atrS(bars(Array(30).fill(100), 1)); assert.ok(Math.abs(a[29] - 2) < 1e-9); assert.equal(a[13], null);
});
test("Bollinger: constant -> zero bandwidth; hand sd", () => {
  assert.equal(bollS(Array(25).fill(5))[24].bw, 0);
  const b = bollS([2, 4, 4, 4, 5, 5, 7, 9], 8, 2)[7]; // mean 5, population sd 2
  assert.equal(b.mid, 5); assert.equal(b.up, 9); assert.equal(b.lo, 1);
});
test("ADX is high in a clean trend and defined", () => {
  const up = bars(Array.from({ length: 80 }, (_, i) => 100 + i * 2), 0.5);
  const a = adxS(up); assert.ok(a.adx[79] > 40); assert.ok(a.pdi[79] > a.mdi[79]);
});
test("Stochastic and Donchian", () => {
  const b = bars([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 0);
  assert.equal(stochS(b).k[14], 100);
  assert.equal(donchianS(b, 5)[14].up, 15); assert.equal(donchianS(b, 5)[14].lo, 11);
});
test("relVol excludes today", () => {
  const b = bars(Array(60).fill(10)); b[59].v = 300;
  assert.equal(relVol(b), 3); assert.equal(relVol(b.slice(0, 10)), null);
});
