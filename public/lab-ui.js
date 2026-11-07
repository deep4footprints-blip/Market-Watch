// "Lab" tab: equity strategy backtester (RS/momentum family) on cached Dhan daily history. Reproducible runs are saved and comparable.
import { align, run, sensitivity, DEFAULTS } from "./backtest.js";
import { esc, fin, pc, pp, num, inr, cls, dstr, inputRow, selectRow, metric, note, twoLines, drawdownArea, downloadCsv, csvCell } from "./ui-kit.js";

const VERSION = "bt-1"; // bump when the engine's behaviour changes, so saved runs stay interpretable
const M = (m, k) => m?.[k];

export function createLab({ LS, history, getInst, hasCreds }) {
  const cfg0 = { ...DEFAULTS, weights: undefined };
  const S = { root: null, cfg: { topN: 20, every: 21, costBps: 20, slipBps: 10, buffer: 0, above200: true, stage2: false, minRs: 0, regimeFilter: false, stopLoss: 0, capital: 1000000, rf: 6.5, ...LS.get("labcfg", {}) }, res: null, sens: null, busy: false, msg: "", saved: LS.get("btruns", []), data: null, meta: null, cmp: new Set() };

  async function load() {
    const inst = await getInst(), b = inst.indices?.find((i) => i.key === "nifty50");
    if (!b) throw new Error("Nifty 50 missing from instruments.json");
    const bench = await history.bars("IDX_I", b.id); if (!bench.length) throw new Error("No cached history. Load it in the Research tab first.");
    const uni = new Map(); for (const s of inst.fno || []) { const bars = await history.bars("NSE_EQ", s.id); if (bars.length > 300) uni.set(s.s, bars); }
    S.meta = { asOf: bench[bench.length - 1].t, bars: bench.length, universe: uni.size, from: bench[0].t };
    S.data = align(bench, uni);
  }
  const conf = () => ({ ...S.cfg, stopLoss: S.cfg.stopLoss ? S.cfg.stopLoss / 100 : null, rf: S.cfg.rf / 100 });
  async function go(sens = false) {
    if (S.busy) return; S.busy = true; S.msg = "Running…"; paint();
    try {
      if (!S.data) await load();
      await new Promise((r) => setTimeout(r, 20)); // let the UI paint before the CPU-bound run
      if (sens) { S.sens = sensitivity(S.data, conf(), { topN: [10, 20, 30], every: [21, 42] }); S.msg = S.sens.error || ""; }
      else { S.res = run(S.data, conf()); S.msg = S.res.error || ""; if (!S.res.error) S.sens = null; }
    } catch (e) { S.msg = String(e.message || e); }
    S.busy = false; paint();
  }
  function save() {
    const r = S.res; if (!r || r.error) return;
    const rec = { id: `bt${Date.now()}`, at: Date.now(), version: VERSION, cfg: S.cfg, meta: S.meta, m: r.metrics, b: r.benchMetrics, oos: r.outOfSample, is: r.inSample, source: "Dhan daily bars (price-only)", warnings: r.warnings };
    S.saved = [rec, ...S.saved].slice(0, 25); LS.set("btruns", S.saved); S.msg = "Saved (never overwrites older runs)."; paint();
  }
  const tbl = (rows, head) => `<div class="tw"><table class="rs-t"><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
  function results() {
    const r = S.res; if (!r || r.error) return S.msg ? `<div class="banner-inline">${esc(S.msg)}</div>` : "";
    const m = r.metrics, b = r.benchMetrics, row = (l, f, k) => `<tr><td>${l}</td><td>${f(m[k])}</td><td>${f(b[k])}</td><td>${f(r.inSample[k])}</td><td>${f(r.outOfSample[k])}</td></tr>`;
    const months = new Map(); r.monthly.forEach((x) => { const [y, mo] = x.month.split("-"); if (!months.has(y)) months.set(y, {}); months.get(y)[+mo] = x.ret; });
    const grid = [...months].map(([y, v]) => `<tr><td>${y}</td>${Array.from({ length: 12 }, (_, i) => `<td class="${cls(v[i + 1])}">${fin(v[i + 1]) ? (v[i + 1] * 100).toFixed(1) : ""}</td>`).join("")}</tr>`).join("");
    return `<h3>Result · ${dstr(r.t[0])} → ${dstr(r.t[r.t.length - 1])} · ${S.meta.universe} stocks</h3>
      <div class="card">${twoLines(r.equity, r.bench, { fmt: (x) => inr(x) })}<div class="note"><span style="color:#d9c9a3">━</span> strategy · <span style="color:#6b6b72">━</span> Nifty 50 (price index) · starting ${inr(r.cfg.capital)}</div>${drawdownArea(r.equity)}<div class="note">Strategy drawdown</div></div>
      ${tbl([row("Total return", pc, "total"), row("CAGR", pc, "cagr"), row("Volatility (ann.)", pp, "vol"), row("Sharpe (rf " + S.cfg.rf + "%)", (v) => num(v), "sharpe"), row("Sortino", (v) => num(v), "sortino"), row("Max drawdown", pp, "maxDD"), row("Longest underwater (days)", (v) => (fin(v) ? v : "—"), "maxDDLen"), row("Calmar", (v) => num(v), "calmar")], ["Metric", "Strategy", "Nifty 50", "First 70%", "Last 30% (out-of-sample)"])}
      <div class="mtrs">${metric("Trades", m.trades)}${metric("Win rate", pp(m.winRate, 0))}${metric("Profit factor", num(m.profitFactor))}${metric("Avg hold (bars)", fin(m.avgHold) ? m.avgHold.toFixed(0) : "—")}${metric("Turnover (×/yr)", num(m.turnover))}${metric("Avg exposure", pp(m.exposure, 0))}${metric("Costs paid", inr(m.costs))}${metric("Best / worst trade", `${inr(m.best)} / ${inr(m.worst)}`)}</div>
      <div class="note">The 70/30 split is a stability check on one fixed parameter set, not a re-optimised out-of-sample test. If the last 30% is far worse than the first 70%, treat the full-period result as fragile.</div>
      <h3>Monthly returns (%)</h3><div class="tw"><table class="rs-t"><thead><tr><th>Year</th>${"JFMAMJJASOND".split("").map((x) => `<th>${x}</th>`).join("")}</tr></thead><tbody>${grid}</tbody></table></div>
      <h3>Trade ledger (${r.trades.length}; showing last 100)</h3>${tbl(r.trades.slice(-100).reverse().map((t) => `<tr><td>${esc(t.key)}</td><td>${dstr(t.entryT)}</td><td>${dstr(t.exitT)}</td><td>${num(t.entry)}</td><td>${num(t.exit)}</td><td class="${cls(t.pnl)}">${inr(t.pnl)}</td><td>${t.reason}</td></tr>`), ["Stock", "In", "Out", "Entry", "Exit", "Net P&L", "Exit reason"])}
      ${r.open.length ? note(`Open at end: ${r.open.map((o) => esc(o.key)).join(", ")} (not force-sold; excluded from the ledger).`) : ""}
      <h3>Warnings</h3><div class="card">${r.warnings.map((w) => `<div class="note">⚠ ${esc(w)}</div>`).join("")}</div>
      <div class="rs-act"><button class="btn" data-act="save">Save this run</button> <button class="btn ghost" data-act="sens">Parameter sensitivity</button> <button class="btn ghost" data-act="csv">Ledger CSV</button></div>`;
  }
  function sens() {
    if (!S.sens || S.sens.error) return "";
    return `<h3>Parameter sensitivity (topN × rebalance days)</h3>${tbl(S.sens.rows.map((x) => `<tr><td>${x.topN}</td><td>${x.every}</td><td>${pc(x.cagr)}</td><td>${pp(x.maxDD)}</td><td>${num(x.sharpe)}</td></tr>`), ["Top N", "Every (days)", "CAGR", "Max DD", "Sharpe"])}
      ${note(`CAGR ranges ${pc(S.sens.cagrMin)} to ${pc(S.sens.cagrMax)} (spread ${pc(S.sens.cagrSpread)}). A wide spread means the result depends on a lucky parameter choice; do not pick the best row as "the edge".`)}`;
  }
  function saved() {
    if (!S.saved.length) return "";
    return `<h3>Saved runs</h3>${tbl(S.saved.map((r) => `<tr><td><input type="checkbox" data-cmp="${r.id}" ${S.cmp.has(r.id) ? "checked" : ""}></td><td>${dms(r.at)}</td><td>Top ${r.cfg.topN} / ${r.cfg.every}d${r.cfg.stage2 ? " S2" : ""}${r.cfg.regimeFilter ? " regime" : ""}</td><td>${pc(r.m.cagr)}</td><td>${pc(r.b.cagr)}</td><td>${pp(r.m.maxDD)}</td><td>${num(r.m.sharpe)}</td><td>${pc(r.oos.cagr)}</td><td>${r.version}</td></tr>`), ["Cmp", "Saved", "Config", "CAGR", "Nifty", "Max DD", "Sharpe", "Last 30% CAGR", "Engine"])}
      <div class="note">Each run stores its config, data as-of date, universe size and engine version, so it can be re-run and compared. <button class="btn ghost" data-act="clear">Delete all</button></div>`;
  }
  const dms = (ms) => dstr(ms / 1000);
  function paint() {
    const c = S.cfg;
    S.root.innerHTML = `<div class="rs-top"><h2 style="margin:0">Backtest lab</h2></div>
      ${note("Long-only, equal-weight RS-momentum portfolio of the Nifty F&O stocks vs Nifty 50. Signals use data up to the close; fills happen at the next open plus slippage. <b>Results are inflated by survivorship bias</b> (today's stock list) and exclude dividends. This is research, not a forecast.")}
      <div class="card"><div class="rs-f">
        ${inputRow("Top N", "bt-topN", c.topN, { min: 1, max: 60, step: 1, w: "60px" })}${inputRow("Rebalance (days)", "bt-every", c.every, { min: 1, step: 1, w: "60px" })}${inputRow("Buffer (ranks)", "bt-buffer", c.buffer, { min: 0, step: 1, w: "60px" })}
        ${inputRow("Cost bps/side", "bt-cost", c.costBps, { min: 0, w: "60px" })}${inputRow("Slippage bps", "bt-slip", c.slipBps, { min: 0, w: "60px" })}${inputRow("Stop loss %", "bt-stop", c.stopLoss, { min: 0, w: "60px" })}${inputRow("Min RS rating", "bt-rs", c.minRs, { min: 0, max: 99, step: 1, w: "60px" })}${inputRow("Capital ₹", "bt-cap", c.capital, { w: "100px" })}${inputRow("Risk-free %", "bt-rf", c.rf, { w: "60px" })}
        <label class="fld"><input type="checkbox" id="bt-200" ${c.above200 ? "checked" : ""}> price &gt; 200 DMA</label><label class="fld"><input type="checkbox" id="bt-s2" ${c.stage2 ? "checked" : ""}> Stage 2 only</label><label class="fld"><input type="checkbox" id="bt-reg" ${c.regimeFilter ? "checked" : ""}> cash when Nifty &lt; 200 DMA</label></div>
        <div class="note">Ranking: weighted 3/6/9/12-month relative performance vs Nifty 50 (40/20/20/20). Defaults for costs are assumptions: check them against your broker's charges.</div>
        <div class="rs-act"><button class="btn" data-act="run">${S.busy ? "Running…" : "Run backtest"}</button> ${S.data ? note(`Data: ${S.meta.universe} stocks, ${S.meta.bars} bars to ${dstr(S.meta.asOf)}`) : ""}</div>${S.msg && !S.res ? `<div class="banner-inline">${esc(S.msg)}</div>` : ""}</div>
      ${results()}${sens()}${saved()}`;
  }
  function read() {
    const g = (id) => S.root.querySelector(id), n = (id, d) => (fin(+g(id)?.value) && g(id).value !== "" ? +g(id).value : d);
    Object.assign(S.cfg, { topN: Math.max(1, n("#bt-topN", 20)), every: Math.max(1, n("#bt-every", 21)), buffer: n("#bt-buffer", 0), costBps: n("#bt-cost", 20), slipBps: n("#bt-slip", 10), stopLoss: n("#bt-stop", 0), minRs: n("#bt-rs", 0), capital: n("#bt-cap", 1e6), rf: n("#bt-rf", 6.5), above200: g("#bt-200").checked, stage2: g("#bt-s2").checked, regimeFilter: g("#bt-reg").checked });
    LS.set("labcfg", S.cfg);
  }
  return {
    mount(el) {
      S.root = el; paint();
      el.addEventListener("click", (e) => {
        const a = e.target.closest("[data-act]")?.dataset.act; if (!a) return;
        if (a === "run" || a === "sens") { if (!hasCreds()) { S.msg = "Add Dhan credentials first."; return paint(); } read(); S.data = null; return go(a === "sens"); }
        if (a === "save") return save(); if (a === "clear") { S.saved = []; LS.set("btruns", []); return paint(); }
        if (a === "csv" && S.res) downloadCsv("backtest-ledger.csv", [`# Backtest ledger · engine ${VERSION} · cfg ${JSON.stringify(S.cfg)} · data to ${dstr(S.meta.asOf)} · price-only, survivorship-biased`, "stock,entry_date,exit_date,entry,exit,shares,net_pnl,reason", ...S.res.trades.map((t) => [t.key, dstr(t.entryT), dstr(t.exitT), t.entry, t.exit, t.shares, t.pnl, t.reason].map(csvCell).join(","))]);
      });
    },
  };
}
