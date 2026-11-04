import test from "node:test";
import assert from "node:assert/strict";
import { createLog, summarize, toCsv, dayOf } from "../public/pnllog.js";

const mem = () => { const m = {}; return { get: (k, d) => (k in m ? JSON.parse(m[k]) : d), set: (k, v) => { m[k] = JSON.stringify(v); } }; };
const T = Date.UTC(2026, 10, 4, 4, 0, 0); // 09:30 IST

test("one sample per minute (latest wins), separate series stay separate", () => {
  const log = createLog(mem());
  log.record("port", T + 1000, [100, 60, 40]);
  log.record("port", T + 30000, [120, 70, 50]);
  log.record("port", T + 61000, [90, 50, 40]);
  log.record("st:a", T, [10, 0, 10], { name: "A" });
  const day = dayOf(T);
  assert.deepEqual(log.get("port", day).map((r) => r[1]), [120, 90]);
  assert.deepEqual(log.get("st:a", day).map((r) => r[1]), [10]);
  assert.equal(log.get("st:b", day).length, 0);
  assert.equal(log.sessions()[0].name, "A");
});
test("rejects non-finite values; clearDay and rename work", () => {
  const log = createLog(mem());
  assert.equal(log.record("port", T, [NaN, 1, 2]), false);
  log.record("st:a", T, [1, 0, 1], { name: "A" });
  log.rename("st:a", "B"); assert.equal(log.sessions()[0].name, "B"); assert.equal(log.sessions()[0].id, "a");
  log.clearDay("st:a", dayOf(T)); assert.equal(log.sessions().length, 0);
});
test("summarize: peak, trough, max drawdown; csv", () => {
  const pts = [[T, 0], [T + 6e4, 100], [T + 12e4, 40], [T + 18e4, -20], [T + 24e4, 60]];
  const s = summarize(pts);
  assert.equal(s.hi[1], 100); assert.equal(s.lo[1], -20); assert.equal(s.drawdown, -120); assert.equal(s.change, 60);
  assert.match(toCsv(pts, ["total"]), /^time_ist,total\n2026-11-04 09:30,0/);
});
