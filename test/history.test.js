import test from "node:test";
import assert from "node:assert/strict";
import { createHistory, memoryStore, expectedLastSession, completedBars } from "../public/history.js";

const DAY = 86400;
// 2026-11-04 (Wed) 10:00 UTC = 15:30 IST ; 2026-11-04 11:00 UTC = 16:30 IST
const WED_1530 = Date.UTC(2026, 10, 4, 10, 0) / 1000, WED_1630 = Date.UTC(2026, 10, 4, 11, 0) / 1000;
const day = (t) => Math.floor((t + 19800) / DAY);

test("expectedLastSession: after 16:00 IST is today, before is previous weekday, weekend rolls back to Friday", () => {
  assert.equal(expectedLastSession(WED_1630), day(WED_1630));
  assert.equal(expectedLastSession(WED_1530), day(WED_1530) - 1);
  const sun = Date.UTC(2026, 10, 8, 6, 0) / 1000;
  assert.equal(expectedLastSession(sun), day(sun) - 2);
  const mon = Date.UTC(2026, 10, 9, 5, 0) / 1000; // Monday 10:30 IST
  assert.equal(expectedLastSession(mon), day(mon) - 3);
});
test("completedBars drops an in-progress bar for today only", () => {
  const b = [{ t: WED_1530 - DAY }, { t: WED_1530 - 3600 }];
  assert.equal(completedBars(b, WED_1530).length, 1);
  assert.equal(completedBars(b, WED_1630).length, 2);
});

const mkClient = (fail = {}) => {
  const calls = [];
  return {
    calls,
    historical: async (body) => {
      calls.push(body.securityId);
      if (fail[body.securityId]) throw Object.assign(new Error("boom"), fail[body.securityId]);
      const t0 = WED_1630 - 2 * DAY;
      return { timestamp: [t0, t0 + DAY, t0 + 2 * DAY], open: [1, 2, 3], high: [2, 3, 4], low: [1, 2, 3], close: [2, 3, 4], volume: [10, 10, 10] };
    },
  };
};
const items = [1, 2, 3].map((id) => ({ seg: "NSE_EQ", id, instrument: "EQUITY", label: "S" + id }));

test("ensure fetches, caches, and skips fresh records", async () => {
  const client = mkClient(), store = memoryStore();
  const h = createHistory({ client, store, now: () => WED_1630 * 1000 });
  const r1 = await h.ensure(items);
  assert.equal(r1.fetched, 3);
  const r2 = await h.ensure(items);
  assert.equal(r2.cached, 3); assert.equal(r2.fetched, 0);
  assert.equal(client.calls.length, 3);
  const b = await h.bars("NSE_EQ", 1);
  assert.equal(b.length, 3); assert.equal(b[2].c, 4);
  const st = await h.status(items);
  assert.deepEqual([st.have, st.fresh], [3, 3]);
});
test("per-instrument failure is collected, auth error aborts", async () => {
  const store = memoryStore();
  const h = createHistory({ client: mkClient({ 2: { code: "X" } }), store, now: () => WED_1630 * 1000 });
  const r = await h.ensure(items);
  assert.equal(r.fetched, 2); assert.equal(r.failed.length, 1); assert.equal(r.aborted, null);
  const h2 = createHistory({ client: mkClient({ 1: { code: "DH-901", status: 401 } }), store: memoryStore(), now: () => WED_1630 * 1000 });
  const r2 = await h2.ensure(items);
  assert.equal(r2.aborted, "auth"); assert.equal(r2.fetched, 0);
});
test("stale cache is refetched", async () => {
  const client = mkClient(), store = memoryStore();
  let t = WED_1630 * 1000;
  const h = createHistory({ client, store, now: () => t });
  await h.ensure(items.slice(0, 1));
  t += 24 * 3600e3 + 3600e3; // next day evening
  const r = await h.ensure(items.slice(0, 1));
  assert.equal(r.fetched, 1);
});

test("fetchDaily falls back to the shorter range when the long range is refused, but not on auth errors", async () => {
  const seen = [];
  const client = { historical: async (b) => { seen.push(b.fromDate); if (seen.length === 1) throw Object.assign(new Error("range"), { code: "DH-905" }); return { timestamp: [WED_1630], open: [1], high: [1], low: [1], close: [1], volume: [1] }; } };
  const h = createHistory({ client, store: memoryStore(), now: () => WED_1630 * 1000 });
  const b = await h.fetchDaily({ seg: "NSE_EQ", id: 1, instrument: "EQUITY" });
  assert.equal(b.length, 1); assert.equal(seen.length, 2); assert.ok(seen[0] < seen[1]);
  const authFail = { historical: async () => { throw Object.assign(new Error("auth"), { code: "DH-901", status: 401 }); } };
  await assert.rejects(createHistory({ client: authFail, store: memoryStore() }).fetchDaily({ seg: "NSE_EQ", id: 1, instrument: "EQUITY" }));
});
