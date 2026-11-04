import test from "node:test";
import assert from "node:assert/strict";
import { analyze, bsGreeks, bsPrice, expiryPnl, impliedVol, ncdf, portfolioGreeks, scenarioPnl, suggest } from "../public/payoff.js";

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} ${a} vs ${b}`);
const leg = (type, strike, side, entry, lots = 1, iv = 0.2) => ({ type, strike, side, lots, entry, iv });

test("normal cdf", () => {
  close(ncdf(0), 0.5, 1e-7);
  close(ncdf(1.96), 0.975, 1e-4);
  close(ncdf(-1.96), 0.025, 1e-4);
});

test("Black-Scholes reference value and put-call parity", () => {
  close(bsPrice("CE", 100, 100, 1, 0.2, 0.05), 10.4506, 1e-3);
  close(bsPrice("PE", 100, 100, 1, 0.2, 0.05), 5.5735, 1e-3);
  const c = bsPrice("CE", 24000, 24500, 0.1, 0.15), p = bsPrice("PE", 24000, 24500, 0.1, 0.15);
  close(c - p, 24000 - 24500 * Math.exp(-0.065 * 0.1), 1e-6, "parity");
});

test("greeks match finite differences", () => {
  const [S, K, T, s] = [24000, 24100, 0.05, 0.14];
  for (const t of ["CE", "PE"]) {
    const g = bsGreeks(t, S, K, T, s);
    const h = 1;
    close(g.delta, (bsPrice(t, S + h, K, T, s) - bsPrice(t, S - h, K, T, s)) / (2 * h), 1e-5, t + " delta");
    close(g.gamma, (bsPrice(t, S + h, K, T, s) - 2 * bsPrice(t, S, K, T, s) + bsPrice(t, S - h, K, T, s)) / (h * h), 1e-6, t + " gamma");
    close(g.vega, (bsPrice(t, S, K, T, s + 0.0001) - bsPrice(t, S, K, T, s - 0.0001)) / 0.0002 / 100, 1e-3, t + " vega");
    close(g.theta, bsPrice(t, S, K, T - 1 / 365, s) - bsPrice(t, S, K, T, s), 0.5, t + " theta"); // 1-day change
  }
});

test("implied vol round-trips and rejects impossible prices", () => {
  const p = bsPrice("PE", 24000, 23800, 0.04, 0.17);
  close(impliedVol("PE", p, 24000, 23800, 0.04), 0.17, 1e-6);
  assert.equal(impliedVol("CE", 0.01, 24000, 24000, 0.04), null);
  assert.equal(impliedVol("CE", 100, 24000, 24000, 0), null);
});

test("long straddle: two breakevens, bounded loss, unlimited profit", () => {
  const legs = [leg("CE", 100, 1, 5), leg("PE", 100, 1, 4)];
  const a = analyze(legs, 10, { spot: 100, T: 0.05, atmIv: 0.2 });
  assert.deepEqual(a.breakevens.map((x) => +x.toFixed(6)), [91, 109]);
  assert.equal(a.maxLoss, -90);
  assert.equal(a.unlimitedProfit, true);
  assert.equal(a.netPremium, -90);
  assert.ok(a.pop > 0 && a.pop < 0.5);
});

test("short strangle: unlimited loss, bounded profit = credit", () => {
  const legs = [leg("CE", 110, -1, 2), leg("PE", 90, -1, 3)];
  const a = analyze(legs, 1, { spot: 100, T: 0.05, atmIv: 0.2 });
  assert.equal(a.unlimitedLoss, true);
  assert.equal(a.maxProfit, 5);
  assert.deepEqual(a.breakevens.map((x) => +x.toFixed(6)), [85, 115]);
  assert.ok(a.pop > 0.5);
});

test("iron condor: both ends bounded, risk = wing - credit", () => {
  const legs = [leg("PE", 90, 1, 1), leg("PE", 95, -1, 2.5), leg("CE", 105, -1, 2.5), leg("CE", 110, 1, 1)];
  const a = analyze(legs, 1, { spot: 100, T: 0.05, atmIv: 0.2 });
  assert.equal(a.unlimitedLoss || a.unlimitedProfit, false);
  close(a.maxProfit, 3, 1e-9);
  close(a.maxLoss, -2, 1e-9);
  assert.deepEqual(a.breakevens.map((x) => +x.toFixed(6)), [92, 108]);
});

test("expiry payoff agrees with the analytic summary at breakevens", () => {
  const legs = [leg("CE", 100, 1, 5, 2)];
  const a = analyze(legs, 25, { spot: 100, T: 0.05, atmIv: 0.2 });
  assert.deepEqual(a.breakevens, [105]);
  close(expiryPnl(legs, 25, 105), 0, 1e-9);
});

test("scenario curve converges to expiry payoff as T -> 0 and portfolio greeks sum legs", () => {
  const legs = [leg("CE", 100, 1, 5), leg("PE", 100, -1, 4)];
  for (const S of [80, 100, 120]) close(scenarioPnl(legs, 10, S, 0, 0), expiryPnl(legs, 10, S), 1e-9);
  const g = portfolioGreeks(legs, 10, 100, 0.1, 0);
  close(g.delta, 10 * (bsGreeks("CE", 100, 100, 0.1, 0.2).delta - bsGreeks("PE", 100, 100, 0.1, 0.2).delta), 1e-9);
});

test("suggest: short straddle gets a protective wing that improves tail risk; empty/expired give null", () => {
  const spot = 24000, T = 6 / 365, iv = 0.15, lot = 65;
  const quotes = [];
  for (let K = 22000; K <= 26000; K += 50) for (const ty of ["CE", "PE"]) quotes.push({ type: ty, strike: K, price: Math.max(bsPrice(ty, spot, K, T, iv), 0.05), iv, oi: 1000 });
  const px = (ty, K) => quotes.find((q) => q.type === ty && q.strike === K).price;
  const legs = [{ type: "CE", strike: 24000, side: -1, lots: 1, entry: px("CE", 24000), iv }, { type: "PE", strike: 24000, side: -1, lots: 1, entry: px("PE", 24000), iv }];
  const s = suggest(legs, lot, { spot, T, atmIv: iv, quotes });
  assert.ok(s.best, "expected a suggestion");
  assert.equal(s.best.kind, "ADD");
  assert.equal(s.best.steps[0].action, "BUY");
  assert.ok(s.best.after.ES > s.base.ES, "tail must improve");
  assert.ok(s.best.exact.maxLoss > s.base.exact.maxLoss || s.base.exact.unlimitedLoss);
  assert.equal(suggest([], lot, { spot, T, atmIv: iv, quotes }), null);
  assert.equal(suggest(legs, lot, { spot, T: 0, atmIv: iv, quotes }), null);
});

test("suggest: exiting a leg books (price - entry) * qty minus cost into realised", () => {
  const spot = 24000, T = 6 / 365, iv = 0.15, lot = 65;
  const quotes = [{ type: "CE", strike: 24000, price: 150, iv, oi: 1 }];
  const legs = [{ type: "CE", strike: 24000, side: -1, lots: 1, entry: 200, iv }];
  const s = suggest(legs, lot, { spot, T, atmIv: iv, quotes, realized: 0 });
  const ex = [s.best, ...s.alts].find((c) => c && c.kind === "EXIT");
  assert.ok(ex, "exit candidate exists (short call, price fell, tail unlimited)");
  close(ex.realizedAfter, -65 * (150 - 200) - 0.5 * 65, 1e-9);
});
