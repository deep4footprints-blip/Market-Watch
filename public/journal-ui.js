// "Journal" tab: manual/CSV trade log with performance analytics computed only from recorded trades.
import { stats, groupBy, tradePnl, rMultiple, parseCsv } from "./journal.js";
import { esc, fin, pc, pp, num, inr, clsAbs, metric, note, downloadCsv, csvCell, twoLines, disclaimer } from "./ui-kit.js";

const MISTAKES = ["Chased entry", "Moved/ignored stop", "Oversized", "No plan", "Early exit", "Revenge trade", "FOMO", "Followed rules"];
export function createJournal({ LS, getRegime = () => "" }) {
  const S = { root: null, trades: LS.get("journal", []), edit: null, msg: "", by: "setup", show: 30 };
  const save = () => LS.set("journal", S.trades);
  const g = (id) => S.root.querySelector(id)?.value ?? "";
  const dt = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : "");

  function form() {
    const t = S.edit && S.trades.find((x) => x.id === S.edit) || { side: 1, tags: [], regime: getRegime() };
    const f = (id, label, v, type = "text", w = "") => `<label class="fld">${label}<input id="${id}" type="${type}" step="any" value="${esc(v ?? "")}" ${w ? `style="width:${w}"` : ""}></label>`;
    return `<div class="card"><div class="n">${S.edit ? "Edit trade" : "Add trade"}</div><div class="rs-f">${f("j-sym", "Symbol", t.sym, "text", "110px")}<label class="fld">Side<select id="j-side"><option value="1" ${t.side === 1 ? "selected" : ""}>Long</option><option value="-1" ${t.side === -1 ? "selected" : ""}>Short</option></select></label>${f("j-qty", "Qty", t.qty, "number", "80px")}${f("j-entry", "Entry ₹", t.entry, "number", "90px")}${f("j-exit", "Exit ₹ (blank=open)", t.exit, "number", "90px")}${f("j-stop", "Planned stop ₹", t.stop, "number", "90px")}${f("j-fees", "Fees ₹", t.fees, "number", "80px")}${f("j-ed", "Entry date", dt(t.entryT), "date")}${f("j-xd", "Exit date", dt(t.exitT), "date")}${f("j-setup", "Setup / strategy", t.setup, "text", "130px")}${f("j-regime", "Regime at entry", t.regime, "text", "130px")}${f("j-rule", "Rule-following 1-5", t.rule, "number", "70px")}</div>
      <div class="chips">${MISTAKES.map((m) => `<label class="chip"><input type="checkbox" data-mk="${m}" ${t.tags?.includes(m) ? "checked" : ""}> ${m}</label>`).join("")}</div>
      <label class="fld" style="width:100%">Thesis / notes<textarea id="j-notes" rows="2">${esc(t.notes || "")}</textarea></label>
      <div class="rs-act"><button class="btn" data-act="save">${S.edit ? "Update" : "Add"}</button>${S.edit ? ` <button class="btn ghost" data-act="cancel">Cancel</button>` : ""}</div></div>`;
  }
  function paint() {
    const s = stats(S.trades), grp = groupBy(S.trades.filter((t) => fin(tradePnl(t))), S.by === "setup" ? (t) => t.setup || "—" : S.by === "sym" ? (t) => t.sym : S.by === "mistake" ? (t) => (t.tags?.length ? t.tags : ["(none)"]) : (t) => (t.side > 0 ? "Long" : "Short"));
    const list = [...S.trades].sort((a, b) => (b.exitT || b.entryT || 0) - (a.exitT || a.entryT || 0)).slice(0, S.show);
    S.root.innerHTML = `<h2>Journal</h2>${note("Performance below is computed only from the trades you record. It describes your process; it does not diagnose psychology or predict results. Fees entered are yours: nothing is auto-imported (Dhan trade-history import is not wired; use CSV).")}
      ${S.msg ? `<div class="banner-inline">${esc(S.msg)}</div>` : ""}${form()}
      ${s.n ? `<h3>Performance (${s.n} closed, ${s.open} open)</h3><div class="card">${twoLines(s.curve, null, { fmt: (x) => inr(x) })}<div class="mtrs">${metric("Net P&L", inr(s.net), clsAbs(s.net))}${metric("Win rate", pp(s.winRate, 0))}${metric("Avg win / loss", `${inr(s.avgWin)} / ${inr(s.avgLoss)}`)}${metric("Profit factor", s.profitFactor === Infinity ? "∞" : num(s.profitFactor))}${metric("Expectancy / trade", inr(s.expectancy), clsAbs(s.expectancy))}${metric("Avg R (" + s.rCount + " with stops)", fin(s.avgR) ? s.avgR.toFixed(2) : "—")}${metric("Max drawdown", inr(s.maxDrawdown))}${metric("Fees paid", inr(s.fees))}${metric("Avg hold (days)", fin(s.avgHold) ? s.avgHold.toFixed(1) : "—")}${metric("Best / worst", `${inr(s.best)} / ${inr(s.worst)}`)}</div></div>
        <h3>Breakdown <span class="seg sm">${[["setup", "Setup"], ["sym", "Stock"], ["side", "Side"], ["mistake", "Mistake tag"]].map(([k, l]) => `<button data-by="${k}" class="${S.by === k ? "on" : ""}">${l}</button>`).join("")}</span></h3>
        <div class="tw"><table class="rs-t"><thead><tr><th>Group</th><th>Trades</th><th>Net</th><th>Win %</th><th>Expectancy</th><th>PF</th></tr></thead><tbody>${grp.map((x) => `<tr><td>${esc(x.key)}</td><td>${x.n}</td><td class="${clsAbs(x.net)}">${inr(x.net)}</td><td>${pp(x.winRate, 0)}</td><td>${inr(x.expectancy)}</td><td>${x.profitFactor === Infinity ? "∞" : num(x.profitFactor)}</td></tr>`).join("")}</tbody></table></div>
        ${note("Small samples are noisy: a group with fewer than ~20 trades says little.")}` : ""}
      <h3>Trades (${S.trades.length})</h3><div class="tw"><table class="rs-t"><thead><tr><th>Symbol</th><th>Side</th><th>Qty</th><th>Entry</th><th>Exit</th><th>P&L</th><th>R</th><th>Setup</th><th></th></tr></thead><tbody>${list.map((t) => { const p = tradePnl(t), r = rMultiple(t); return `<tr><td><b>${esc(t.sym)}</b><small>${esc((t.tags || []).join(", "))}</small></td><td>${t.side > 0 ? "L" : "S"}</td><td>${t.qty}</td><td>${num(t.entry)}</td><td>${fin(t.exit) ? num(t.exit) : "open"}</td><td class="${clsAbs(p)}">${fin(p) ? inr(p) : "—"}</td><td>${fin(r) ? r.toFixed(2) : "—"}</td><td>${esc(t.setup || "")}</td><td><button class="x-btn" data-edit="${t.id}">✎</button><button class="x-btn" data-del="${t.id}">✕</button></td></tr>`; }).join("") || `<tr><td colspan="9" class="empty">No trades yet.</td></tr>`}</tbody></table></div>
      ${S.trades.length > list.length ? `<button class="btn ghost" data-act="more">Show more</button>` : ""}
      <h3>Import / export</h3><div class="card"><div class="note">CSV columns: symbol, qty, entry (required); side, exit, entry_date, exit_date, fees, stop, setup (optional).</div><input type="file" id="j-file" accept=".csv,text/csv"><div class="rs-act"><button class="btn ghost" data-act="export">Export CSV</button></div></div>${disclaimer}`;
  }
  function submit() {
    const n = (id) => (g(id) === "" ? null : +g(id)), sym = g("#j-sym").trim().toUpperCase(), qty = n("#j-qty"), entry = n("#j-entry");
    if (!sym || !(qty > 0) || !(entry > 0)) { S.msg = "Symbol, quantity and entry price are required."; return paint(); }
    const old = S.edit && S.trades.find((x) => x.id === S.edit);
    const t = { id: old?.id || `j${Date.now()}`, sym, side: +g("#j-side"), qty, entry, exit: n("#j-exit"), stop: n("#j-stop"), fees: n("#j-fees") || 0, entryT: g("#j-ed") ? Date.parse(g("#j-ed")) : null, exitT: g("#j-xd") ? Date.parse(g("#j-xd")) : null, setup: g("#j-setup"), regime: g("#j-regime"), rule: n("#j-rule"), notes: g("#j-notes"), tags: [...S.root.querySelectorAll("[data-mk]:checked")].map((x) => x.dataset.mk) };
    if (fin(t.exit) && !fin(t.exitT)) t.exitT = Date.now();
    S.trades = old ? S.trades.map((x) => (x.id === old.id ? t : x)) : [...S.trades, t]; save(); S.edit = null; S.msg = ""; paint();
  }
  return {
    mount(el) {
      S.root = el; paint();
      el.addEventListener("click", (e) => {
        const a = e.target.closest("[data-act]")?.dataset.act, ed = e.target.closest("[data-edit]")?.dataset.edit, dl = e.target.closest("[data-del]")?.dataset.del, by = e.target.closest("[data-by]")?.dataset.by;
        if (a === "save") return submit(); if (a === "cancel") { S.edit = null; return paint(); } if (a === "more") { S.show += 30; return paint(); }
        if (a === "export") return downloadCsv("journal.csv", ["symbol,side,qty,entry,exit,entry_date,exit_date,fees,stop,setup,regime,rule_score,mistakes,notes", ...S.trades.map((t) => [t.sym, t.side > 0 ? "buy" : "sell", t.qty, t.entry, t.exit, dt(t.entryT), dt(t.exitT), t.fees, t.stop, t.setup, t.regime, t.rule, (t.tags || []).join("; "), t.notes].map(csvCell).join(","))]);
        if (ed) { S.edit = ed; paint(); return S.root.scrollIntoView(); } if (by) { S.by = by; return paint(); }
        if (dl && confirm("Delete this trade?")) { S.trades = S.trades.filter((t) => t.id !== dl); save(); paint(); }
      });
      el.addEventListener("change", async (e) => {
        if (e.target.id !== "j-file" || !e.target.files[0]) return;
        const r = parseCsv(await e.target.files[0].text()); S.trades = [...S.trades, ...r.trades]; save(); S.msg = `Imported ${r.trades.length} trade(s)${r.errors.length ? `; ${r.errors.length} issue(s): ${r.errors.slice(0, 3).join(" · ")}` : ""}.`; paint();
      });
    },
  };
}
