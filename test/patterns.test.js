import test from "node:test";
import assert from "node:assert/strict";
import { PATTERNS, scanBars, swings, invalidated } from "../public/patterns.js";

/** piecewise-linear closes through waypoints [[index, price], ...] */
function path(points) {
  const out = [];
  for (let k = 0; k + 1 < points.length; k++) { const [i0, p0] = points[k], [i1, p1] = points[k + 1]; for (let i = i0; i < i1; i++) out.push(p0 + ((p1 - p0) * (i - i0)) / (i1 - i0)); }
  out.push(points[points.length - 1][1]); return out;
}
const mkBars = (cl, { spread = 0.5, v = 1000, vf = null } = {}) => cl.map((c, i) => ({ t: 1.7e9 + i * 86400, o: c - 0.1, h: c + spread, l: c - spread, c, v: vf ? vf(i) : v }));
const rise = (n, a = 50, b = 100) => path([[0, a], [n, b]]);

test("52w breakout: close above prior 252-day high with volume", () => {
  const cl = [...rise(300), 101.5];
  const b = mkBars(cl, { vf: (i) => (i === cl.length - 1 ? 3000 : 1000) });
  const r = PATTERNS.breakout52.detect(b);
  assert.equal(r.state, "breakout"); assert.ok(r.score >= 75);
  assert.equal(PATTERNS.breakout52.detect(mkBars(rise(300, 100, 50))), null);
});
test("flat base near highs, then breakout", () => {
  const flat = [...rise(250, 50, 100), ...Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i / 3) * 0.8), 100.3];
  const r = PATTERNS.flatBase.detect(mkBars(flat, { spread: 0.8 }));
  assert.ok(r && ["forming", "near_trigger"].includes(r.state));
  const out = PATTERNS.flatBase.detect(mkBars([...flat, 106], { spread: 0.8 }));
  assert.equal(out.state, "breakout");
  assert.equal(PATTERNS.flatBase.detect(mkBars(rise(280, 50, 150))), null); // trending, not flat
});
test("NR7 and inside bar", () => {
  const cl = Array(20).fill(100);
  const b = mkBars(cl, { spread: 2 }); b[19] = { ...b[19], h: 100.3, l: 99.8 };
  const r = PATTERNS.nr7.detect(b); assert.ok(r); assert.ok(r.notes.includes("NR7") && r.notes.includes("inside bar"));
  assert.equal(PATTERNS.nr7.detect(mkBars(cl, { spread: 2 })), null);
});
test("pocket pivot requires volume above largest down-day volume", () => {
  const cl = [...rise(280, 50, 100)]; const b = mkBars(cl);
  const L = b.length - 1;
  for (let i = L - 9; i < L; i++) { b[i].c = b[i - 1].c - 0.2; b[i].v = 500; } // down days, vol 500
  b[L] = { ...b[L], o: 99, c: 100.5, v: 900 };
  assert.ok(PATTERNS.pocketPivot.detect(b));
  b[L].v = 400; assert.equal(PATTERNS.pocketPivot.detect(b), null);
});
test("relative-volume breakout", () => {
  const cl = [...rise(100, 50, 60), 70]; const b = mkBars(cl, { vf: (i) => (i === cl.length - 1 ? 5000 : 1000) });
  assert.equal(PATTERNS.rvolBreakout.detect(b).state, "breakout");
});
test("golden cross detected within 5 sessions only", () => {
  const cl = [...path([[0, 100], [200, 60]]), ...path([[0, 60], [60, 140]]).slice(1)];
  let hit = false; for (let k = 0; k < 40; k++) { const r = PATTERNS.goldenCross.detect(mkBars(cl.slice(0, cl.length - k))); if (r) hit = true; }
  assert.ok(hit);
  assert.equal(PATTERNS.goldenCross.detect(mkBars(rise(300, 50, 200))), null); // long-established trend: no fresh cross
});
test("RSI recovery cross above 60", () => {
  const cl = [...Array(40).fill(0).map((_, i) => 100 + Math.sin(i) * 0.3), 101, 103, 106, 110];
  let hit = false; for (let k = 0; k < 4; k++) if (PATTERNS.rsiRecovery.detect(mkBars(cl.slice(0, cl.length - k)))) hit = true;
  assert.ok(hit);
  assert.equal(PATTERNS.rsiRecovery.detect(mkBars(Array(60).fill(100))), null);
});
test("high tight flag", () => {
  const cl = [...Array(60).fill(50), ...path([[0, 50], [35, 110]]).slice(1), ...Array.from({ length: 15 }, (_, i) => 108 - (i % 4) * 2)];
  const r = PATTERNS.highTightFlag.detect(mkBars(cl)); assert.ok(r); assert.equal(r.id, "highTightFlag");
  assert.equal(PATTERNS.highTightFlag.detect(mkBars(rise(150, 50, 80))), null); // only +60%
});
test("double bottom", () => {
  const cl = [...Array(80).fill(0).map((_, i) => 100 - i * 0.1), ...path([[0, 92], [12, 80], [24, 95], [36, 80.5], [48, 90]]).slice(1)];
  // ensure shape: lows ~80 twice, peak 95 between
  const r = PATTERNS.doubleBottom.detect(mkBars(cl, { spread: 0.3 })); assert.ok(r, "double bottom expected"); assert.equal(r.pivot > 90, true);
});
test("cup and handle", () => {
  const cup = path([[0, 100], [30, 80], [60, 99]]);
  const cl = [...path([[0, 60], [100, 100]]).slice(0, 100), ...cup, ...path([[0, 99], [8, 94], [12, 97]]).slice(1)];
  const r = PATTERNS.cupHandle.detect(mkBars(cl, { spread: 0.3 })); assert.ok(r, "cup expected"); assert.ok(["forming", "near_trigger", "breakout"].includes(r.state));
  assert.equal(PATTERNS.cupHandle.detect(mkBars(rise(200, 50, 150))), null);
});
test("VCP: successively shallower pullbacks", () => {
  const pts = [[0, 60], [150, 100], [160, 100], [175, 85], [190, 100], [198, 93], [208, 100], [213, 96.5], [221, 99.5]];
  const cl = path(pts); const b = mkBars(cl, { spread: 0.2, vf: (i) => (i > cl.length - 12 ? 400 : 1000) });
  const r = PATTERNS.vcp.detect(b); assert.ok(r, "vcp expected"); assert.ok(r.notes[0].includes("→"));
});
test("scanBars never throws on short/odd data; swings finds extremes; invalidation", () => {
  assert.deepEqual(scanBars(mkBars([1, 2, 3])), []);
  assert.ok(swings(mkBars(path([[0, 1], [10, 10], [20, 1]]))).length >= 1);
  assert.equal(invalidated({ stop: 99 }, [{ c: 98 }]), true);
  assert.equal(invalidated({ stop: null }, [{ c: 98 }]), false);
});
