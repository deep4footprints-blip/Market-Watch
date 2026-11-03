import test from "node:test";
import assert from "node:assert/strict";
import { normalizeChain, buildSnapshot, createDhanClient, DhanError, loadPortfolio, loadWatch, normalizeQuote } from "../public/dhan.js";

const mkFetch = (routes, log = []) => async (url, init) => {
  const path = url.replace("https://api.dhan.co/v2", "");
  log.push({ path, init });
  const r = routes[path];
  if (!r) return new Response(JSON.stringify({ errorCode: "X", errorMessage: "no route " + path }), { status: 404 });
  const body = typeof r === "function" ? r(init) : r;
  return new Response(JSON.stringify(body), { status: body.__status || 200 });
};
const client = (routes, log) =>
  createDhanClient({ fetchFn: mkFetch(routes, log), getCreds: async () => ({ token: "t".repeat(30), clientId: "1" }), minGapMs: 0 });

test("normalizeQuote derives prev close and pct from net_change", () => {
  const q = normalizeQuote({ last_price: 110, net_change: 10, ohlc: { open: 100, high: 111, low: 99, close: 0 }, volume: 5 });
  assert.equal(q.prev, 100);
  assert.equal(q.pct, 10);
  assert.equal(q.high, 111);
});

test("normalizeQuote: no live price -> nulls, not 0%", () => {
  const q = normalizeQuote({ last_price: 0, net_change: 0, ohlc: { close: 50 } });
  assert.equal(q.ltp, null);
  assert.equal(q.pct, null);
});

test("normalizeQuote falls back to ohlc.close when net_change absent", () => {
  const q = normalizeQuote({ last_price: 99, ohlc: { close: 100 } });
  assert.equal(q.chg, -1);
  assert.equal(q.pct, -1);
});

test("quotes batches per segment and keys by SEG:id", async () => {
  const log = [];
  const c = client({ "/marketfeed/quote": (init) => {
    const b = JSON.parse(init.body);
    return { data: Object.fromEntries(Object.entries(b).map(([seg, ids]) => [seg, Object.fromEntries(ids.map((id) => [id, { last_price: 10, net_change: 1 }]))])), status: "success" };
  } }, log);
  const m = await c.quotes({ IDX_I: [13, 25], NSE_EQ: [1333] });
  assert.equal(log.length, 1); // single combined request
  assert.ok(m.has("IDX_I:13") && m.has("IDX_I:25") && m.has("NSE_EQ:1333"));
  assert.equal(log[0].init.headers["access-token"].length, 30);
  assert.equal(log[0].init.headers["client-id"], "1");
});

test("buildSnapshot ranks movers and counts breadth", () => {
  const inst = { indices: [{ key: "n", name: "N", group: "broad", id: 13 }], fno: [
    { id: 1, s: "A", n: "A" }, { id: 2, s: "B", n: "B" }, { id: 3, s: "C", n: "C" }, { id: 4, s: "D", n: "D" } ] };
  const q = new Map([
    ["IDX_I:13", { ltp: 100, pct: 1 }],
    ["NSE_EQ:1", { ltp: 1, prev: 1, chg: 0.05, pct: 5 }],
    ["NSE_EQ:2", { ltp: 1, prev: 1, chg: -0.03, pct: -3 }],
    ["NSE_EQ:3", { ltp: 1, prev: 1, chg: 0, pct: 0 }],
  ]);
  const s = buildSnapshot(inst, q);
  assert.equal(s.movers.gainers[0].sym, "A");
  assert.equal(s.movers.losers[0].sym, "B");
  assert.deepEqual([s.breadth.adv, s.breadth.dec, s.breadth.unch, s.breadth.total], [1, 1, 1, 3]);
  assert.equal(s.indices[0].ltp, 100);
});

test("loadPortfolio computes P&L, day P&L, and tolerates empty positions", async () => {
  const c = client({
    "/holdings": [{ exchange: "NSE", tradingSymbol: "TCS", securityId: "11536", totalQty: 10, avgCostPrice: 100 }],
    "/positions": { __status: 400, errorCode: "DH-1111", errorMessage: "No positions" },
    "/marketfeed/quote": { data: { NSE_EQ: { 11536: { last_price: 120, net_change: 2 } } } },
  });
  const p = await loadPortfolio(c);
  assert.equal(p.summary.invested, 1000);
  assert.equal(p.summary.value, 1200);
  assert.equal(p.summary.pnl, 200);
  assert.equal(p.summary.pnlPct, 20);
  assert.equal(p.summary.dayPnl, 20);
  assert.equal(p.positions.length, 0);
});

test("auth failures map to 401 DhanError", async () => {
  const c = client({ "/holdings": { __status: 401, errorCode: "DH-901", errorMessage: "Invalid auth" } });
  await assert.rejects(c.holdings(), (e) => e instanceof DhanError && e.status === 401 && e.code === "DH-901");
});

test("loadWatch dedupes and caps ids", async () => {
  const c = client({ "/marketfeed/quote": { data: { NSE_EQ: { 5: { last_price: 10, net_change: 1 } } } } });
  const w = await loadWatch(c, [{ id: 5 }, { id: "5" }, { id: "x" }]);
  assert.equal(w.items.length, 1);
  assert.equal(w.items[0].pct, (1 / 9) * 100);
});

test("normalizeChain: strikes sorted, ATM, step, ATM IV as decimal", () => {
  const c = normalizeChain({ data: { last_price: 24012, oc: {
    "24100.000000": { ce: { last_price: 80, implied_volatility: 11, greeks: { delta: 0.4 } }, pe: { last_price: 150, implied_volatility: 12 } },
    "24000.000000": { ce: { last_price: 130, implied_volatility: 10, oi: 5 }, pe: { last_price: 100, implied_volatility: 10.5 } },
    "24050.000000": { ce: { last_price: 100, implied_volatility: 10 }, pe: null },
  } } });
  assert.deepEqual(c.strikes, [24000, 24050, 24100]);
  assert.equal(c.atm, 24000);
  assert.equal(c.step, 50);
  assert.ok(Math.abs(c.atmIv - 0.1025) < 1e-9);
  assert.equal(c.byStrike.get(24100).ce.delta, 0.4);
});

test("optionChain posts the documented body and expiry list sorts", async () => {
  const log = [];
  const c = client({
    "/optionchain": (init) => ({ data: { last_price: 100, oc: { "100.0": { ce: { last_price: 1 }, pe: { last_price: 1 } } } }, echo: JSON.parse(init.body) }),
    "/optionchain/expirylist": { data: ["2026-11-27", "2026-11-06"] },
  }, log);
  const ex = await c.expiryList(13, "IDX_I");
  assert.deepEqual(ex, ["2026-11-06", "2026-11-27"]);
  await c.optionChain(13, "IDX_I", "2026-11-06");
  assert.deepEqual(JSON.parse(log[1].init.body), { UnderlyingScrip: 13, UnderlyingSeg: "IDX_I", Expiry: "2026-11-06" });
});
