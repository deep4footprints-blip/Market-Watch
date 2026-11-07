import test from "node:test";
import assert from "node:assert/strict";
import { TOOLS } from "../public/tools-ui.js";
test("every calculator computes from its defaults without errors/NaN", () => {
  assert.ok(TOOLS.length >= 17);
  for (const t of TOOLS) {
    const v = Object.fromEntries((t.f || []).map(([k, , d]) => [k, d])); if (t.sel) v[t.sel[0]] = t.sel[3]; if (t.ta) v[t.ta[0]] = t.ta[2]; if (t.ta2) { v.a = "A,10\nB,5"; v.b = "A,6\nC,9"; }
    const o = t.run(v);
    assert.ok(o && !/banner-inline|NaN|undefined/.test(o), `${t.id}: ${o?.slice(0, 100)}`);
  }
});
test("calculators reject bad input instead of printing NaN", () => {
  const pos = TOOLS.find((t) => t.id === "pos");
  assert.match(pos.run({ capital: 1e6, riskPct: 1, entry: 100, stop: "", atr: "", atrMult: 2, lot: 1, maxPct: "" }), /banner-inline/);
  assert.match(TOOLS.find((t) => t.id === "cagr").run({ start: 0, end: 5, years: 1 }), /banner-inline/);
  assert.match(TOOLS.find((t) => t.id === "xirr").run({ data: "2022-01-01,100\n2023-01-01,50" }), /banner-inline/);
});
