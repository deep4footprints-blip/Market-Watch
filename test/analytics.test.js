import test from "node:test";
import assert from "node:assert/strict";
import { smaAt, ret, hiLo, rsScore, percentileRank, trendTemplate, stageOf, breadth, regimeScore, regimeLabel, pcr, maxPain, atmStraddle, oiInterpretation, realisedVol, summarise, rateUniverse, rsLine, rsLineNewHigh } from "../public/analytics.js";

const line = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const bars = (cl, t0 = 1700000000) => cl.map((c, i) => ({ t: t0 + i * 86400, o: c, h: c, l: c, c, v: 100 }));

test("smaAt hand-calculated, with offset", () => {
  assert.equal(smaAt([1, 2, 3, 4, 5], 3), 4);
  assert.equal(smaAt([1, 2, 3, 4, 5], 3, 1), 3);
  assert.equal(smaAt([1, 2], 3), null);
});
test("ret and hiLo", () => {
  assert.ok(Math.abs(ret([100, 110], 1) - 0.1) < 1e-12);
  assert.equal(ret([100], 1), null);
  const cl = line(100, (i) => 100 + i);
  assert.deepEqual({ hi: hiLo(cl).hi, lo: hiLo(cl).lo }, { hi: 199, lo: 100 });
  assert.equal(hiLo([1, 2, 3]).hi, null); // too little history
});
test("rsScore: relative (1+rs)/(1+rb)-1, weights, null on missing period", () => {
  const stock = line(300, (i) => 100 * 1.001 ** i), bench = line(300, () => 100);
  const w = { 63: 1 };
  assert.ok(Math.abs(rsScore(stock, bench, w) - (1.001 ** 63 - 1)) < 1e-12);
  assert.equal(rsScore(stock.slice(0, 100), bench.slice(0, 100)), null); // 252d needed
  // equal performance -> zero
  assert.ok(Math.abs(rsScore(bench, bench)) < 1e-12);
});
test("percentileRank: 1..99, ties share rank, nulls preserved", () => {
  assert.deepEqual(percentileRank([5, 1, 3]), [99, 1, 50]);
  assert.deepEqual(percentileRank([1, null, 1, 9]), [Math.round(1 + 98 * 0.5 / 2), null, Math.round(1 + 98 * 0.5 / 2), 99]);
  assert.deepEqual(percentileRank([7]), [50]);
});
test("trendTemplate: steady uptrend passes all price rules; failing rule is visible", () => {
  const up = line(300, (i) => 100 + i * 0.5);
  const tt = trendTemplate(up, 90);
  assert.equal(tt.rules.length, 9);
  assert.equal(tt.all, true);
  const weak = trendTemplate(up, 40);
  assert.equal(weak.all, false);
  assert.equal(weak.rules.find((r) => /RS rating/.test(r.label)).pass, false);
  assert.equal(weak.passed, 8);
  const noRs = trendTemplate(up, null);
  assert.equal(noRs.unknown, 1); // excluded from denominator, not silently failed
  assert.equal(noRs.total, 8);
  const down = trendTemplate(line(300, (i) => 300 - i * 0.5), 90);
  assert.equal(down.rules.find((r) => r.label === "Price > 200 DMA").pass, false);
});
test("stageOf: uptrend=2, downtrend=4, base after decline=1, top after advance=3", () => {
  assert.equal(stageOf(line(300, (i) => 100 + i)).stage, 2);
  assert.equal(stageOf(line(300, (i) => 400 - i)).stage, 4);
  const base = [...line(200, (i) => 400 - i * 1.5), ...line(260, () => 100)]; // MA lags: only stage 1 once the 150DMA has flattened
  assert.equal(stageOf(base).stage, 1);
  assert.equal(stageOf(base.slice(0, 300)).stage, 4); // still falling MA right after the decline -> not yet a base
  const top = [...line(200, (i) => 100 + i * 1.5), ...line(170, () => 400)];
  assert.equal(stageOf(top).stage, 3);
  assert.equal(stageOf(line(100, () => 1)), null);
});
test("breadth counts and coverage", () => {
  const a = summarise(bars(line(300, (i) => 100 + i)), bars(line(300, () => 100)));
  const b = summarise(bars(line(300, (i) => 400 - i)), bars(line(300, () => 100)));
  const br = breadth([a, b]);
  assert.equal(br.above200.pct, 50);
  assert.equal(br.newHighs, 1);
  assert.equal(br.newLows, 1);
  assert.equal(br.stages[1], 1); // one stage 2
  assert.equal(br.stages[3], 1); // one stage 4
});
test("rateUniverse assigns RS rating and trend template", () => {
  const bench = bars(line(300, () => 100));
  const rows = [1.002, 1.001, 1.0].map((g) => summarise(bars(line(300, (i) => 100 * g ** i)), bench));
  rateUniverse(rows);
  assert.deepEqual(rows.map((r) => r.rs), [99, 50, 1]);
  assert.ok(rows[0].tt.total >= 8);
});
test("rsLine and new-high", () => {
  const s = bars(line(300, (i) => 100 + i)), b = bars(line(300, () => 100));
  const l = rsLine(s, b);
  assert.equal(l.length, 300);
  assert.equal(rsLineNewHigh(l), true);
});
test("regimeScore: coverage reflects missing inputs, bullish > bearish", () => {
  const up = line(300, (i) => 100 + i), down = line(300, (i) => 400 - i);
  const hi = regimeScore({ indexCl: up });
  const lo = regimeScore({ indexCl: down });
  assert.ok(hi.score > 80 && lo.score < 25);
  assert.ok(hi.coverage < 1 && Math.abs(hi.coverage - 0.55) < 1e-9); // trend .3 + momentum .15 + drawdown .1
  assert.equal(regimeScore({}), null);
  assert.equal(regimeLabel(65), "Constructive");
});
test("realisedVol of constant series is 0", () => {
  assert.equal(realisedVol(line(30, () => 100)), 0);
});

const chain = (rows) => ({ spot: 100, atm: 100, rows, byStrike: new Map(rows.map((r) => [r.strike, r])) });
const row = (strike, coi, poi, cl, pl) => ({ strike, ce: { oi: coi, vol: coi, ltp: cl }, pe: { oi: poi, vol: poi, ltp: pl } });
test("pcr and maxPain on a hand-calculated chain", () => {
  const c = chain([row(90, 100, 300, 12, 1), row(100, 200, 200, 5, 4), row(110, 300, 100, 1, 11)]);
  const p = pcr(c);
  assert.equal(p.callOi, 600); assert.equal(p.putOi, 600); assert.equal(p.oi, 1);
  // K=90: calls ITM none (strike>90 -> 0); puts: 100*(100-90)*200 + 110: 100*(110-90) -> pe(100)=200*10 + pe(110)=100*20 = 4000
  // K=100: ce(90)=100*10=1000 ; pe(110)=100*10=1000 -> 2000 ; K=110: ce(90)=100*20+ce(100)=200*10=4000
  const mp = maxPain(c);
  assert.equal(mp.strike, 100);
  assert.deepEqual(mp.curve.map((x) => x.pay), [4000, 2000, 4000]);
  assert.equal(maxPain(chain([row(100, 0, 0, 1, 1)])), null);
});
test("atmStraddle and oiInterpretation", () => {
  const c = chain([row(100, 1, 1, 5, 4)]);
  const s = atmStraddle(c);
  assert.equal(s.prem, 9); assert.equal(s.movePct, 0.09); assert.equal(s.lo, 91);
  assert.equal(atmStraddle({ ...c, spot: null }), null);
  assert.equal(oiInterpretation(1, 5), "Long buildup");
  assert.equal(oiInterpretation(-1, 5), "Short buildup");
  assert.equal(oiInterpretation(1, -5), "Short covering");
  assert.equal(oiInterpretation(-1, -5), "Long unwinding");
  assert.equal(oiInterpretation(null, 5), null);
});
