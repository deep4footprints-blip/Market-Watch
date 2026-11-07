import test from "node:test";
import assert from "node:assert/strict";
import { align, run, metrics, sensitivity } from "../public/backtest.js";

const N = 420, T0 = 1.6e9 - (1.6e9 % 86400);
const mk = (f, v = 1000) => Array.from({ length: N }, (_, i) => { const c = f(i); return { t: T0 + i * 86400 + 3600, o: c, h: c * 1.01, l: c * 0.99, c, v }; });
const bench = mk((i) => 100 * 1.0002 ** i);
const uni = new Map([["WIN", mk((i) => 100 * 1.0015 ** i)], ["MID", mk((i) => 100 * 1.0006 ** i)], ["LOSE", mk((i) => 100 * 0.9995 ** i)], ["FLAT", mk(() => 100)]]);
const data = () => align(bench, uni);

test("align: calendar from benchmark, nulls before listing, gap fill", () => {
  const late = mk((i) => 50 + i).slice(100); // listed late
  const d = align(bench, new Map([["L", late]]));
  assert.equal(d.series.get("L").c[50], null); assert.ok(d.series.get("L").c[150] > 0);
  assert.equal(d.cal.length, N);
});
test("top-1 momentum picks the strongest stock and beats the benchmark; costs reduce return", () => {
  const r = run(data(), { topN: 1, every: 21, costBps: 0, slipBps: 0, minBars: 252 });
  assert.ok(!r.error); assert.ok(r.trades.length >= 0);
  assert.equal(r.open[0].key, "WIN");
  assert.ok(r.metrics.cagr > r.benchMetrics.cagr);
  const c = run(data(), { topN: 1, every: 21, costBps: 100, slipBps: 50 });
  assert.ok(c.metrics.total < r.metrics.total);
  assert.ok(r.warnings.some((w) => /survivorship/i.test(w)));
});
test("no look-ahead: results up to day i are unchanged when future data is altered", () => {
  const full = run(data(), { topN: 2, every: 10, costBps: 20 });
  const cut = 380;
  const altered = new Map([...uni].map(([k, bars]) => [k, bars.map((b, i) => (i > cut ? { ...b, c: b.c * 0.1, o: b.o * 0.1, h: b.h * 0.1, l: b.l * 0.1 } : b))]));
  const alt = run(align(bench, altered), { topN: 2, every: 10, costBps: 20 });
  for (let i = 0; i < cut - full.start - 1; i++) assert.equal(alt.equity[i], full.equity[i], `day ${i}`);
});
test("regime filter goes to cash when benchmark is below its 200DMA", () => {
  const down = mk((i) => 100 * 0.9985 ** i);
  const d = align(down, uni);
  const r = run(d, { topN: 2, regimeFilter: true });
  assert.ok(r.metrics.exposure < 0.05);
});
test("stop loss exits", () => {
  const crash = new Map([["X", mk((i) => (i < 300 ? 100 * 1.003 ** i : 100 * 1.003 ** 300 * 0.97 ** (i - 300)))]]);
  const r = run(align(bench, crash), { topN: 1, every: 21, stopLoss: 0.1, minRs: 0 });
  assert.ok(r.trades.some((t) => t.reason === "stop"));
});
test("metrics hand-check and insufficient history error", () => {
  const eq = [100, 110, 99, 120]; const m = metrics(eq, [0, 86400, 2 * 86400, 3 * 86400], 0);
  assert.ok(Math.abs(m.maxDD - 0.1) < 1e-12); assert.ok(Math.abs(m.total - 0.2) < 1e-12);
  assert.ok(run(align(bench.slice(0, 200), uni), {}).error);
});
test("sensitivity reports a spread, not a single winner", () => {
  const s = sensitivity(data(), { topN: 2, every: 21 }, { topN: [1, 2, 3], every: [21, 42] });
  assert.equal(s.rows.length, 6); assert.ok(s.cagrSpread >= 0);
});
