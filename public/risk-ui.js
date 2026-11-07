// "Risk" tab: portfolio risk from the user's Dhan holdings, using daily history. Weights are CURRENT value weights over the past window.
import { analysePortfolio, returns } from "./risk.js";
import { align } from "./backtest.js";
import { esc, fin, pc, pp, num, inr, clsAbs, metric, note, disclaimer, dstr } from "./ui-kit.js";

export function createRisk({ history, getInst, getBook, getPortfolio, hasCreds }) {
  const S = { root: null, res: null, busy: false, msg: "", win: 252, miss: [] };
  async function go() {
    if (S.busy) return;
    const port = getPortfolio(); if (!hasCreds()) { S.msg = "Add Dhan credentials first."; return paint(); }
    if (!port?.holdings?.length) { S.msg = "No holdings loaded yet: open the Portfolio tab once, then return."; return paint(); }
    S.busy = true; S.msg = "Loading daily history for your holdings (Dhan chart limits apply)…"; paint();
    try {
      const inst = await getInst(), nb = inst.indices?.find((i) => i.key === "nifty50");
      const items = [{ seg: "IDX_I", id: nb.id, instrument: "INDEX", label: "Nifty 50" }, ...port.holdings.filter((h) => h.seg === "NSE_EQ" || h.seg === "BSE_EQ").map((h) => ({ seg: h.seg, id: h.id, instrument: "EQUITY", label: h.sym }))];
      const r = await history.ensure(items);
      if (r.aborted === "auth") throw new Error("Dhan rejected the token.");
      const bench = await history.bars("IDX_I", nb.id), uni = new Map(), miss = [];
      for (const h of port.holdings) { const b = await history.bars(h.seg, h.id); if (b.length > 80 && h.value > 0) uni.set(h.sym, { b, value: h.value }); else miss.push(h.sym); }
      const a = align(bench, new Map([...uni].map(([k, v]) => [k, v.b])));
      const hs = [...uni].map(([k, v]) => ({ key: k, value: v.value, cl: a.series.get(k)?.c.slice(a.series.get(k).first) })).filter((x) => x.cl);
      // align to common tail length
      const n = Math.min(...hs.map((h) => h.cl.length), a.bench.c.length); S.miss = miss;
      S.res = analysePortfolio(hs.map((h) => ({ ...h, cl: h.cl.slice(-n) })), a.bench.c.slice(-n), { window: S.win }); S.asOf = bench[bench.length - 1]?.t;
      S.msg = S.res ? "" : "Not enough history for these holdings.";
    } catch (e) { S.msg = String(e.message || e); }
    S.busy = false; paint();
  }
  function heat(c) {
    const col = (v) => (v == null ? "#0b0b0c" : v >= 0 ? `rgba(46,204,143,${(Math.min(Math.abs(v), 1) * 0.6).toFixed(2)})` : `rgba(255,92,92,${(Math.min(Math.abs(v), 1) * 0.6).toFixed(2)})`);
    return `<div class="tw"><table class="rs-t"><thead><tr><th></th>${c.keys.map((k) => `<th>${esc(k.slice(0, 6))}</th>`).join("")}</tr></thead><tbody>${c.m.map((r, i) => `<tr><td>${esc(c.keys[i])}</td>${r.map((v) => `<td style="background:${col(v)}">${fin(v) ? v.toFixed(2) : "—"}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  function paint() {
    const r = S.res;
    S.root.innerHTML = `<div class="rs-top"><h2 style="margin:0">Portfolio risk</h2><button class="btn ghost" data-act="go">${S.busy ? "Working…" : "Analyse holdings"}</button></div>
      ${note("Uses your current Dhan holdings' value weights applied to the last ~1 year of daily returns (a 'what if held today' view, not your realised history). Holdings only; positions/derivatives and mutual funds are excluded. Sector/market-cap concentration needs a classification feed that is not connected.")}
      ${S.msg ? `<div class="banner-inline">${esc(S.msg)}</div>` : ""}
      ${r ? `<div class="mtrs">${metric("Volatility (ann.)", pp(r.vol, 1))}${metric("Beta vs Nifty 50", fin(r.beta) ? r.beta.toFixed(2) : "—")}${metric("Max drawdown (window)", pp(r.dd.dd, 1))}${metric("VaR 95% (1 day)", r.var95 ? pp(r.var95.var, 2) : "—")}${metric("Expected shortfall 95%", r.var95 ? pp(r.var95.es, 2) : "—")}${metric("Effective # holdings", r.conc ? r.conc.effective.toFixed(1) : "—")}${metric("Top holding / top 5", r.conc ? `${pp(r.conc.top1, 0)} / ${pp(r.conc.top5, 0)}` : "—")}</div>
        ${note(`Historical simulation over ${r.n} sessions to ${dstr(S.asOf)}. VaR/ES are loss estimates assuming the past window repeats; tail events outside it are not captured.${S.miss.length ? ` Excluded (no/short history): ${esc(S.miss.join(", "))}.` : ""}`)}
        <h3>Holding betas & volatility</h3><div class="tw"><table class="rs-t"><thead><tr><th>Holding</th><th>Weight</th><th>Beta</th><th>Vol (ann.)</th></tr></thead><tbody>${[...r.betas].sort((a, b) => b.w - a.w).map((x) => `<tr><td>${esc(x.key)}</td><td>${pp(x.w, 1)}</td><td>${fin(x.beta) ? x.beta.toFixed(2) : "—"}</td><td>${pp(x.vol, 1)}</td></tr>`).join("")}</tbody></table></div>
        <h3>Correlation matrix</h3>${heat(r.corr)}` : ""}${disclaimer}`;
  }
  return { mount(el) { S.root = el; paint(); el.addEventListener("click", (e) => { if (e.target.closest("[data-act='go']")) go(); }); } };
}
