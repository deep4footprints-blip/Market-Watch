import test from "node:test";
import assert from "node:assert/strict";
import { createWatchlists, DEFAULT_LIST } from "../public/watchlists.js";
const mkLS = (init = {}) => { const m = { ...init }; return { get: (k, d) => (k in m ? m[k] : d), set: (k, v) => { m[k] = v; }, m }; };
test("default list keeps V1 storage key; existing V1 data is visible", () => {
  const LS = mkLS({ watch: [{ id: 1, s: "A" }] }); const w = createWatchlists(LS);
  assert.deepEqual(w.names(), [DEFAULT_LIST]); assert.equal(w.get().length, 1);
  w.add({ id: 2, s: "B" }); assert.equal(LS.m.watch.length, 2);
});
test("create/add/dedupe/rename/duplicate/remove", () => {
  const w = createWatchlists(mkLS());
  assert.equal(w.create("Swing"), "Swing"); assert.equal(w.active(), "Swing"); assert.equal(w.create("Swing"), null); assert.equal(w.create("  "), null);
  assert.equal(w.add({ id: 5, s: "X" }), true); assert.equal(w.add({ id: 5, s: "X" }), false);
  assert.equal(w.rename("Swing", "Positional"), "Positional"); assert.equal(w.active(), "Positional"); assert.equal(w.get().length, 1);
  assert.equal(w.rename(DEFAULT_LIST, "Z"), null);
  assert.equal(w.duplicate("Positional", "Copy"), "Copy"); assert.equal(w.get("Copy").length, 1);
  w.removeItem(5, "Copy"); assert.equal(w.get("Copy").length, 0);
  assert.equal(w.remove("Positional"), true); assert.ok(!w.names().includes("Positional")); assert.equal(w.remove(DEFAULT_LIST), false);
  assert.equal(w.active() === "Copy" || w.active() === DEFAULT_LIST, true);
});
test("cap and allIds", () => {
  const w = createWatchlists(mkLS()); for (let i = 0; i < 105; i++) w.add({ id: i, s: "S" + i });
  assert.equal(w.get().length, 100); w.create("L2"); w.add({ id: 7, s: "S7" }); w.add({ id: 500, s: "N" });
  assert.equal(new Set(w.allIds()).size, 101);
});
