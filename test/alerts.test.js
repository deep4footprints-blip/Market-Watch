import test from "node:test";
import assert from "node:assert/strict";
import { KINDS, validate, evaluate, runAlerts, describe, inQuiet } from "../public/alerts.js";

const R = (o) => ({ id: "a", kind: "priceAbove", sym: "X", key: "NSE_EQ:1", params: { level: 100 }, repeat: "once", cooldownMin: 60, active: true, ...o });
test("validate", () => {
  assert.equal(validate(R()), null); assert.match(validate(R({ params: {} })), /level/); assert.match(validate(R({ kind: "nope" })), /unknown/);
  assert.match(validate(R({ key: "" })), /instrument/); assert.equal(validate({ kind: "regimeBelow", params: { level: 30 } }), null);
});
test("evaluate: fires, and every non-fire reason is explicit", () => {
  const now = 1e12;
  assert.equal(evaluate(R(), { ltp: 101 }, now).fire, true);
  assert.equal(evaluate(R(), { ltp: 99 }, now).reason, "not met");
  assert.equal(evaluate(R({ active: false }), { ltp: 101 }, now).reason, "paused");
  assert.equal(evaluate(R({ expires: now - 1 }), { ltp: 101 }, now).reason, "expired");
  assert.equal(evaluate(R({ firedAt: now - 1 }), { ltp: 101 }, now).reason, "done");
  assert.equal(evaluate(R({ repeat: "recurring", firedAt: now - 60000 }), { ltp: 101 }, now).reason, "cooldown");
  assert.equal(evaluate(R({ repeat: "recurring", firedAt: now - 3600001 }), { ltp: 101 }, now).fire, true);
  assert.equal(evaluate(R(), null, now).reason, "no data");
  assert.equal(evaluate(R(), { ltp: null }, now).fire, false);
});
test("rule kinds on RS/stage/pattern/pcr/regime", () => {
  assert.equal(evaluate(R({ kind: "rsAbove", params: { level: 80 } }), { rs: 85 }).fire, true);
  assert.equal(evaluate(R({ kind: "stageChange", params: {} }), { stage: 2, prevStage: 1 }).fire, true);
  assert.equal(evaluate(R({ kind: "stageChange", params: {} }), { stage: 2, prevStage: 2 }).fire, false);
  assert.equal(evaluate(R({ kind: "pattern", params: { pattern: "vcp", state: "breakout" } }), { patterns: [{ id: "vcp", state: "breakout" }] }).fire, true);
  assert.equal(evaluate(R({ kind: "pattern", params: { pattern: "vcp", state: "breakout" } }), { patterns: [{ id: "vcp", state: "forming" }] }).fire, false);
  assert.equal(evaluate(R({ kind: "pcrAbove", params: { level: 1.2 } }), { pcr: 1.3 }).fire, true);
  assert.equal(evaluate(R({ kind: "regimeBelow", params: { level: 40 } }), { regime: 35 }).fire, true);
});
test("runAlerts honours data class: EOD rules never run in the live pass; once-rules deactivate; events carry class and asOf", () => {
  const rules = [R({ id: "live1" }), R({ id: "eod1", kind: "rsAbove", params: { level: 80 } })];
  const live = runAlerts(rules, "live", () => ({ ltp: 200, rs: 99 }), 5);
  assert.equal(live.events.length, 1); assert.equal(live.events[0].cls, "live"); assert.equal(live.rules[0].active, false); assert.equal(live.rules[1].firedAt, undefined);
  const eod = runAlerts(rules, "eod", () => ({ ltp: 200, rs: 99 }), 7, 1234);
  assert.equal(eod.events.length, 1); assert.equal(eod.events[0].cls, "eod"); assert.equal(eod.events[0].asOf, 1234);
  assert.equal(runAlerts(live.rules, "live", () => ({ ltp: 200 }), 9).events.length, 0);
});
test("describe and quiet hours (IST), including overnight window", () => {
  assert.match(describe(R()), /Price above 100/);
  const t = Date.UTC(2026, 10, 4, 17, 0); // 22:30 IST
  assert.equal(inQuiet(t, { on: true, from: 22 * 60, to: 7 * 60 }), true);
  assert.equal(inQuiet(Date.UTC(2026, 10, 4, 6, 0), { on: true, from: 22 * 60, to: 7 * 60 }), false);
  assert.equal(inQuiet(t, { on: false, from: 0, to: 1 }), false);
  assert.ok(Object.keys(KINDS).length >= 12);
});
