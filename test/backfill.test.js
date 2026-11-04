import test from "node:test";
import assert from "node:assert/strict";
import { strategyRows, fillForward, rebuildStrategy, rebuildPortfolio } from "../public/backfill.js";
import { createLog, dayOf } from "../public/pnllog.js";

const MIN = 60000;
const T0 = Date.UTC(2026, 10, 4, 3, 45); // 09:15 IST Wed 2026-11-04
const mem = () => { const m = {}; return { get: (k, d) => (k in m ? JSON.parse(m[k]) : d), set: (k, v) => { m[k] = JSON.stringify(v); } }; };
const bars = (t0, closes, step = MIN) => ({ open: closes, high: closes, low: closes, close: closes, volume: closes.map(() => 1), timestamp: closes.map((_, i) => Math.floor((t0 + i * step) / 1000)) });

test("fillForward carries the last price across missing minutes", () => {
  const grid = [0, 1, 2, 3].map((i) => T0 + i * MIN);
  assert.deepEqual(fillForward(grid, [{ t: grid[1], c: 10 }, { t: grid[3], c: 12 }], 5), [5, 10, 10, 12]);
});

test("strategyRows: open leg = qty*(price-entry); after exit it is frozen at (exit-entry)*qty; before entry nothing", () => {
  const grid = [0, 1, 2, 3].map((i) => T0 + i * MIN);
  const legs = [{ side: -1, lots: 1, entry: 100, exit: 90, tIn: grid[1], tOut: grid[3], price: [100, 100, 95, 80] }];
  const rows = strategyRows(grid, legs, 10);
  assert.equal(rows.length, 3);                       // minute 0 is before entry
  assert.deepEqual(rows[0].slice(1), [0, 0, 0]);      // at entry
  assert.deepEqual(rows[1].slice(1), [50, 0, 50]);    // short 10 units, price 95
  assert.deepEqual(rows[2].slice(1), [100, 100, 0]);  // exited at 90: realised 10*10, price afterwards irrelevant
});

test("rebuildStrategy uses option candles when a contract id exists, else a model anchored to entry", async () => {
  const calls = [];
  const client = { intraday: async (b) => { calls.push(b.securityId); return b.securityId === "13" ? bars(T0, [24000, 24010, 24020, 24030]) : bars(T0, [100, 98, 96, 94]); } };
  const base = { und: "Nifty", undKey: "NIFTY", expiry: "2026-11-10", lot: 65 };
  const a = await rebuildStrategy(client, { ...base, defs: [{ type: "CE", strike: 24000, side: -1, lots: 1, entry: 100, exit: null, tIn: T0, tOut: null, secId: 4242, iv: 0.13 }] }, T0 + 3 * MIN);
  assert.equal(a.source, "dhan");
  assert.ok(calls.includes("4242"));
  assert.equal(a.rows.length, 4);
  assert.equal(Math.round(a.rows[3][1]), Math.round(65 * 6));          // short, price 100 -> 94
  const b = await rebuildStrategy(client, { ...base, defs: [{ type: "CE", strike: 24000, side: -1, lots: 1, entry: 100, exit: null, tIn: T0, tOut: null, secId: null, iv: 0.13 }] }, T0 + 3 * MIN);
  assert.equal(b.source, "model");
  assert.equal(b.rows[0][1], 0);                                          // anchored: zero P&L at entry
  assert.ok(b.rows[3][1] < 0, "short call loses as the index rises 30 pts");
});

test("rebuildPortfolio: day P&L = qty*(close - previous session close), first day dropped", async () => {
  const D = 864e5;
  const client = { intraday: async () => ({ ...bars(T0 - D, [100, 101]), ...{} , open: [100, 101, 110, 112], high: [100, 101, 110, 112], low: [100, 101, 110, 112], close: [100, 101, 110, 112], volume: [1, 1, 1, 1], timestamp: [T0 - D, T0 - D + MIN, T0, T0 + MIN].map((t) => Math.floor(t / 1000)) }) };
  const rows = await rebuildPortfolio(client, { holdings: [{ securityId: "1", exchange: "NSE", totalQty: 10 }] }, 5, T0 + 2 * MIN);
  assert.equal(rows.length, 2);
  assert.equal(rows[0][1], 10 * (110 - 101));
  assert.equal(rows[1][1], 10 * (112 - 101));
});

test("plog.fill never overwrites live minutes and marks the source", () => {
  const log = createLog(mem());
  log.record("st:a", T0, [7, 0, 7], { name: "A" });
  const added = log.fill("st:a", [[T0 + 5000, 99, 0, 99], [T0 + MIN, 8, 0, 8]]);
  assert.equal(added, 1);
  assert.deepEqual(log.get("st:a", dayOf(T0)).map((r) => r[1]), [7, 8]);
  assert.equal(log.source("st:a", dayOf(T0)), "mixed");
  log.fill("port", [[T0, 1, 1, 0]]);
  assert.equal(log.source("port", dayOf(T0)), "recon");
  log.record("port", T0 + MIN, [2, 2, 0]);
  assert.equal(log.source("port", dayOf(T0)), "mixed");
});
