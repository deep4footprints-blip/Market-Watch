import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, CATALOG, fmtAge } from "../public/providers.js";

const NOW = 1_800_000_000_000;
const by = (rows, id) => rows.find((r) => r.id === id);
const base = { now: NOW, hasToken: true, tokenExp: NOW + 3600e3, marketOpen: true, quoteAt: NOW - 2000, instGenerated: NOW - 3600e3, instFno: 200, hist: { total: 220, have: 220, fresh: 220, newestBar: NOW / 1000 - 3600 } };

test("healthy path", () => {
  const r = evaluate(base);
  assert.equal(by(r, "dhan.auth").status, "healthy");
  assert.equal(by(r, "dhan.quotes").status, "healthy");
  assert.equal(by(r, "dhan.history").status, "healthy");
  assert.equal(by(r, "derived.breadth").status, "healthy");
  assert.equal(r.length, CATALOG.length);
});
test("no token -> not_configured, never healthy", () => {
  const r = evaluate({ ...base, hasToken: false });
  for (const id of ["dhan.auth", "dhan.quotes", "dhan.history", "dhan.chain"]) assert.equal(by(r, id).status, "not_configured");
});
test("expired token, stale quotes while open, incomplete/delayed history", () => {
  assert.equal(by(evaluate({ ...base, tokenExp: NOW - 1 }), "dhan.auth").status, "failed");
  assert.equal(by(evaluate({ ...base, quoteAt: NOW - 120e3 }), "dhan.quotes").status, "stale");
  assert.equal(by(evaluate({ ...base, quoteAt: NOW - 120e3, marketOpen: false }), "dhan.quotes").status, "healthy");
  assert.equal(by(evaluate({ ...base, hist: { ...base.hist, have: 100, fresh: 100 } }), "dhan.history").status, "incomplete");
  assert.equal(by(evaluate({ ...base, hist: { ...base.hist, fresh: 10 } }), "dhan.history").status, "delayed");
  assert.equal(by(evaluate({ ...base, hist: { ...base.hist, have: 0, fresh: 0 } }), "dhan.history").status, "stale");
});
test("gaps are not_connected, never faked; missing instruments flagged", () => {
  const r = evaluate(base);
  for (const id of ["fundamentals", "filings", "flows", "macro", "funds", "histopt", "adjusted"]) assert.equal(by(r, id).status, "not_connected");
  assert.equal(by(evaluate({ ...base, instGenerated: null }), "dhan.instruments").status, "failed");
  assert.equal(by(evaluate({ ...base, instGenerated: NOW - 6 * 86400e3 }), "dhan.instruments").status, "stale");
});
test("fmtAge", () => { assert.equal(fmtAge(30), "30s ago"); assert.equal(fmtAge(7200), "2h ago"); assert.equal(fmtAge(null), "—"); });
