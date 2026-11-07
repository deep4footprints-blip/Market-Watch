import test from "node:test";
import assert from "node:assert/strict";
import { cagr, realReturn, recoveryGain, xirr, sip, lumpVsSip, sipXirr, positionSize, rewardRisk, expectedMove, futuresBasis, optionBreakeven, orderCost, fdVsMarket } from "../public/calc.js";
import { returns, beta, corr, maxDrawdown, varEs, concentration, analysePortfolio, annVol } from "../public/risk.js";
import { tradePnl, rMultiple, stats, groupBy, parseCsv } from "../public/journal.js";
const close = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);

test("CAGR, real return, recovery", () => {
  close(cagr(100, 200, 5), 2 ** 0.2 - 1); assert.equal(cagr(0, 5, 1), null);
  close(realReturn(0.12, 0.06), 1.12 / 1.06 - 1);
  close(recoveryGain(0.5), 1); close(recoveryGain(0.2), 0.25); assert.equal(recoveryGain(1), null);
});
test("XIRR: 1 year doubling = 100%; two-flow 10% ; rejects no sign change", () => {
  const y = 365 * 864e5;
  close(xirr([{ t: 0, amt: -100 }, { t: y, amt: 110 }]), 0.10, 1e-6);
  close(xirr([{ t: 0, amt: -100 }, { t: y, amt: 200 }]), 1, 1e-6);
  assert.equal(xirr([{ t: 0, amt: 100 }, { t: y, amt: 110 }]), null);
});
test("SIP: closed form, step-up, lump vs sip", () => {
  const m = 1.12 ** (1 / 12) - 1;
  const closedForm = 1000 * ((1 + m) ** 12 - 1) / m * (1 + m); // annuity-due
  close(sip({ monthly: 1000, annual: 0.12, months: 12 }).fv, closedForm, 1e-6);
  const s = sip({ monthly: 1000, annual: 0, months: 24, stepUp: 0.1 });
  close(s.invested, 12000 + 12 * 1100); close(s.fv, s.invested);
  assert.ok(lumpVsSip({ total: 120000, annual: 0.1, months: 12 }).diff > 0);
  close(sipXirr({ monthly: 1000, months: 12, fv: sip({ monthly: 1000, annual: 0.12, months: 12 }).fv }), 0.12, 0.01);
});
test("position sizing: stop distance, ATR, lot rounding, cap", () => {
  const p = positionSize({ capital: 1e6, riskPct: 0.01, entry: 100, stop: 95 });
  assert.equal(p.qty, 2000); close(p.riskAmt, 10000);
  assert.equal(positionSize({ capital: 1e6, riskPct: 0.01, entry: 100, atr: 2, atrMult: 2 }).qty, 2500);
  assert.equal(positionSize({ capital: 1e6, riskPct: 0.01, entry: 100, stop: 95, lot: 75 }).qty, 1950);
  assert.equal(positionSize({ capital: 1e6, riskPct: 0.01, entry: 100, stop: 95, maxPct: 0.1 }).qty, 1000);
  assert.equal(positionSize({ capital: 1e6, riskPct: 0.01, entry: 100 }), null);
  close(rewardRisk({ entry: 100, stop: 95, target: 115 }).rr, 3);
});
test("expected move, basis, breakeven", () => {
  close(expectedMove(25000, 15, 7), 25000 * 0.15 * Math.sqrt(7 / 365)); close(expectedMove(25000, 0.15, 7), expectedMove(25000, 15, 7));
  close(futuresBasis(25100, 25000, 30).annualised, 0.004 * 365 / 30);
  assert.equal(optionBreakeven({ type: "CE", strike: 100, premium: 5 }), 105); assert.equal(optionBreakeven({ type: "PE", strike: 100, premium: 5 }), 95);
});
test("order cost: itemised, GST on brokerage+exchange+SEBI, STT only on sell for intraday", () => {
  const b = orderCost("eq_intraday", "buy", 100000), s = orderCost("eq_intraday", "sell", 100000);
  assert.equal(b.stt, 0); close(s.stt, 25); assert.equal(b.brokerage, 20);
  close(b.gst, (b.brokerage + b.exch + b.sebi) * 0.18); close(b.total, b.brokerage + b.stt + b.exch + b.stamp + b.sebi + b.gst);
  close(orderCost("eq_delivery", "buy", 100000).stt, 100);
  assert.equal(orderCost("nope", "buy", 1), null);
  assert.ok(fdVsMarket({ amount: 100, fdRate: 0.07, marketReturn: 0.12, years: 10, taxRate: 0.3 }).market > 0);
});

test("risk: returns, beta, corr, drawdown, VaR, concentration", () => {
  assert.deepEqual(returns([100, 110, 99]).map((x) => +x.toFixed(4)), [0.1, -0.1]);
  const b = [0.01, -0.02, 0.03, 0.01, -0.01], a = b.map((x) => 2 * x);
  close(beta(a, b), 2); close(corr(a, b), 1);
  const d = maxDrawdown([100, 120, 90, 110]); close(d.dd, 0.25); assert.equal(d.peakI, 1); assert.equal(d.troughI, 2);
  const r = Array.from({ length: 200 }, (_, i) => (i < 10 ? -0.05 : 0.001)); // worst 5% = 10 obs of -5%
  close(varEs(r, 0.95).var, 0.05); close(varEs(r, 0.95).es, 0.05); assert.equal(varEs([0.1], 0.95), null);
  close(concentration([50, 50]).effective, 2); close(concentration([100, 0]).hhi, 1);
  const cl = Array.from({ length: 300 }, (_, i) => 100 * 1.001 ** i * (1 + Math.sin(i) * 0.01));
  const an = analysePortfolio([{ key: "A", value: 60, cl }, { key: "B", value: 40, cl: cl.map((x) => x * 2) }], cl);
  close(an.beta, 1, 1e-9); assert.ok(an.vol > 0); assert.equal(an.corr.m[0][1] > 0.999, true);
  assert.equal(analysePortfolio([], cl), null);
});
test("journal: pnl, R multiple, stats, grouping, csv", () => {
  const T = (o) => ({ side: 1, qty: 10, entry: 100, fees: 0, tags: [], entryT: 0, exitT: 864e5, ...o });
  const ts = [T({ exit: 110, stop: 95, setup: "VCP" }), T({ exit: 95, stop: 95, setup: "VCP" }), T({ exit: 90, side: -1, setup: "Pullback" }), T({ exit: null })];
  assert.equal(tradePnl(ts[0]), 100); assert.equal(rMultiple(ts[0]), 2); assert.equal(rMultiple(ts[1]), -1); assert.equal(tradePnl(ts[3]), null);
  const s = stats(ts); assert.equal(s.n, 3); assert.equal(s.open, 1); assert.equal(s.net, 100 - 50 + 100); close(s.winRate, 2 / 3);
  close(s.profitFactor, 200 / 50); close(s.expectancy, 150 / 3); assert.equal(s.maxDrawdown, 50);
  assert.equal(groupBy(ts, (t) => t.setup)[0].key, "Pullback");
  const c = parseCsv("symbol,side,qty,entry,exit,setup\nabc,buy,5,100,110,VCP\nxyz,,0,1,2,\n");
  assert.equal(c.trades.length, 1); assert.equal(c.trades[0].sym, "ABC"); assert.equal(c.errors.length, 1);
  assert.equal(parseCsv("a,b\n1,2").errors.length, 1);
});
