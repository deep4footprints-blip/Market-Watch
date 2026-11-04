import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTs, bucketStart, aggregate, applyTick, toCandles, parseTf, baseInterval, istSod } from "../public/candles.js";
import { analyze, realizedPnl, expiryPnl } from "../public/payoff.js";

const T0 = Date.UTC(2026, 10, 3, 3, 45) / 1000; // 09:15 IST on 2026-11-03
test("normalizeTs handles unix and 1980 epoch", () => {
  assert.deepEqual(normalizeTs([T0]), [T0]);
  assert.equal(normalizeTs([T0 - 315532800])[0], T0);
});
test("parseTf / baseInterval", () => {
  assert.equal(parseTf("10").minutes, 10);
  assert.equal(parseTf("D").kind, "D");
  assert.equal(baseInterval(10), 5);
  assert.equal(baseInterval(30), 15);
  assert.equal(baseInterval(7), 1);
});
test("bucketStart anchors to 09:15 and aggregate merges OHLCV", () => {
  assert.equal(bucketStart("15", T0 + 14 * 60), T0);
  assert.equal(bucketStart("15", T0 + 15 * 60), T0 + 900);
  const c = [0, 1, 2].map((i) => ({ t: T0 + i * 300, o: 10 + i, h: 12 + i, l: 9 - i, c: 11 + i, v: 5 }));
  const a = aggregate(c, "15");
  assert.equal(a.length, 1);
  assert.deepEqual(a[0], { t: T0, o: 10, h: 14, l: 7, c: 13, v: 15 });
});
test("applyTick updates or opens a bucket", () => {
  const c = [{ t: T0, o: 10, h: 11, l: 9, c: 10, v: 1 }];
  assert.equal(applyTick(c, "5", 12, T0 + 60), true);
  assert.equal(c[0].h, 12);
  assert.equal(applyTick(c, "5", 8, T0 + 400), true);
  assert.equal(c.length, 2);
  assert.equal(applyTick(c, "5", 8, T0 + 400), false);
});
test("toCandles corrects whole-series clock skew", () => {
  const skew = 19800; // series shifted by +5:30
  const d = { timestamp: [T0 + skew, T0 + skew + 300], open: [1, 2], high: [2, 3], low: [1, 2], close: [2, 3], volume: [1, 1] };
  const c = toCandles(d, true);
  assert.equal(istSod(c[0].t), 9 * 3600 + 15 * 60);
});
test("exit price: realised = (exit-entry)*qty; analyze offset shifts curve", () => {
  const legs = [{ type: "CE", strike: 100, side: 1, lots: 1, entry: 5, iv: 0.2, exit: 8 }, { type: "PE", strike: 100, side: -1, lots: 1, entry: 4, iv: 0.2 }];
  assert.equal(realizedPnl(legs, 10), 30);
  const open = [legs[1]];
  const a0 = analyze(open, 10, { spot: 100, T: 0.1, atmIv: 0.2 });
  const a1 = analyze(open, 10, { spot: 100, T: 0.1, atmIv: 0.2, offset: 30 });
  assert.ok(Math.abs(a1.maxProfit - a0.maxProfit - 30) < 1e-9);
  assert.ok(Math.abs(a1.maxLoss - a0.maxLoss - 30) < 1e-9);
  assert.ok(a1.expected > a0.expected + 29.9);
  assert.equal(expiryPnl(open, 10, 100), 40);
});
