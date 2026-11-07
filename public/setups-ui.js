// "Setups" tab: pattern scanner over the cached daily-bar universe. Every detection shows its published rule.
import { scanBars, PATTERNS, PATTERN_IDS, invalidated } from "./patterns.js";
import { esc, fin, pc, num, cls, dstr, chartAttr, downloadCsv, csvCell, note, disclaimer } from "./ui-kit.js";

const STATE_LABEL = { forming: "Forming", near_trigger: "Near trigger", breakout: "Breakout", failed: "Failed" };
const GROUPS = [...new Set(PATTERN_IDS.map((i) => PATTERNS[i].group))];

export function createSetups({ LS, history, getInst, hasCreds, getRs = () => new Map() }) {
  const S = { root: null, hits: [], asOf: null, scanned: 0, busy: false, f: { pattern: "", state: "", group: "", minScore: 0, q: "", sort: "score", dir: -1, limit: 60, ...LS.get("sufilters", {}) }, open: null };
  const $ = (q) => S.root?.querySelector(q);

  async function scan() {
    if (S.busy) return; S.busy = true; paint();
    const inst = await getInst(), hits = []; let scanned = 0, asOf = 0;
    for (const s of inst.fno || []) {
      const bars = await history.bars("NSE_EQ", s.id); if (bars.length < 60) continue;
      scanned++; asOf = Math.max(asOf, bars[bars.length - 1].t);
      const tail = bars.slice(-320);
      for (const h of scanBars(tail)) hits.push({ ...h, sym: s.s, name: s.n, secId: s.id, px: tail[tail.length - 1].c, invalid: invalidated(h, tail) });
    }
    S.hits = hits; S.scanned = scanned; S.asOf = asOf; S.busy = false; paint();
  }
  function filtered() {
    const f = S.f, q = f.q.trim().toUpperCase(), rs = getRs();
    const rows = S.hits.filter((h) => (!f.pattern || h.id === f.pattern) && (!f.group || PATTERNS[h.id].group === f.group) && (!f.state || h.state === f.state) && h.score >= f.minScore && (!q || h.sym.includes(q)));
    const val = (h) => ({ sym: h.sym, pattern: PATTERNS[h.id].name, state: h.state, score: h.score, dist: h.pivot ? h.px / h.pivot - 1 : null, rs: rs.get(h.sym) ?? null })[f.sort];
    return rows.sort((a, b) => { const x = val(a), y = val(b); if (x == null) return 1; if (y == null) return -1; return (typeof x === "string" ? x.localeCompare(y) : x - y) * f.dir; });
  }
  function paint() {
    const f = S.f, rs = getRs(), all = S.hits.length ? filtered() : [], shown = all.slice(0, f.limit);
    const counts = {}; for (const h of S.hits) counts[h.id] = (counts[h.id] || 0) + 1;
    const body = S.hits.length || S.asOf ? `
      <div class="rs-f"><input id="su-q" placeholder="Symbol" value="${esc(f.q)}">
        <select class="mini" data-f="group"><option value="">all groups</option>${GROUPS.map((g) => `<option ${f.group === g ? "selected" : ""}>${g}</option>`).join("")}</select>
        <select class="mini" data-f="pattern"><option value="">all patterns</option>${PATTERN_IDS.map((i) => `<option value="${i}" ${f.pattern === i ? "selected" : ""}>${PATTERNS[i].name} (${counts[i] || 0})</option>`).join("")}</select>
        <select class="mini" data-f="state"><option value="">any state</option>${Object.entries(STATE_LABEL).map(([k, l]) => `<option value="${k}" ${f.state === k ? "selected" : ""}>${l}</option>`).join("")}</select>
        <label>Score ≥<input class="mini num" data-f="minScore" type="number" min="0" max="100" value="${f.minScore || ""}"></label><button class="btn ghost" data-act="csv">CSV</button></div>
      ${note(`${all.length} detections across ${S.scanned} stocks · EOD ${dstr(S.asOf)} · score = share of the pattern's optional quality checks that pass (rules below), not a probability of success.`)}
      <div class="tw"><table class="rs-t sc"><thead><tr>${[["sym", "Symbol"], ["pattern", "Pattern"], ["state", "State"], ["score", "Score"], ["dist", "vs pivot"], ["rs", "RS"]].map(([k, l]) => `<th data-sort="${k}" class="${f.sort === k ? "on" : ""}">${l}${f.sort === k ? (f.dir < 0 ? " ▾" : " ▴") : ""}</th>`).join("")}<th>Pivot</th><th>Stop</th></tr></thead><tbody>${shown.map((h, i) => `<tr data-i="${i}">
        <td class="sym" ${chartAttr("NSE_EQ", h.secId, "EQUITY", h.sym, h.name)}><b>${esc(h.sym)}</b><small>${esc(h.notes.join(" · "))}</small></td><td>${esc(PATTERNS[h.id].name)}</td>
        <td><span class="tag ${h.state === "breakout" ? "up" : h.state === "failed" ? "dn" : ""}">${STATE_LABEL[h.state]}${h.invalid ? " · below stop" : ""}</span></td><td>${h.score}</td><td class="${cls(h.pivot ? h.px / h.pivot - 1 : null)}">${h.pivot ? pc(h.px / h.pivot - 1) : "—"}</td><td>${rs.get(h.sym) ?? "—"}</td><td>${h.pivot ? num(h.pivot) : "—"}</td><td>${h.stop ? num(h.stop) : "—"}</td></tr>`).join("") || `<tr><td colspan="8" class="empty">No detections match.</td></tr>`}</tbody></table></div>
      ${all.length > shown.length ? `<button class="btn ghost" data-act="more">Show more (${all.length - shown.length})</button>` : ""}
      <h3>Detection rules (all measurable; thresholds in code)</h3>${GROUPS.map((g) => `<div class="card" style="margin-bottom:8px"><div class="n">${g}</div>${PATTERN_IDS.filter((i) => PATTERNS[i].group === g).map((i) => `<div class="note"><b>${esc(PATTERNS[i].name)}.</b> ${esc(PATTERNS[i].rule)}</div>`).join("")}</div>`).join("")}`
      : `<div class="empty">${S.busy ? "Scanning…" : hasCreds() ? "Press <b>Scan</b>. It uses the daily history already cached by the Research tab (load it there first)." : "Add Dhan credentials in Settings."}</div>`;
    S.root.innerHTML = `<div class="rs-top"><h2 style="margin:0">Setups</h2><button class="btn ghost" data-act="scan">${S.busy ? "Scanning…" : "Scan"}</button></div>${note("Pattern detection on completed daily bars of the Nifty F&O universe. A detection means the published rule conditions are met; it is not a recommendation and carries no backtested edge. Intraday setups (gap-and-go, VWAP) are not available: they need an intraday history store.")}${body}${disclaimer}`;
  }
  function csv() { const rows = filtered(); downloadCsv(`setups-${dstr(S.asOf).replace(/ /g, "-")}.csv`, [`# Setups export · EOD ${dstr(S.asOf)} · source Dhan daily bars (derived) · filters ${JSON.stringify(S.f)}`, "symbol,pattern,state,score,close,pivot,stop,notes", ...rows.map((h) => [h.sym, PATTERNS[h.id].name, h.state, h.score, h.px, h.pivot, h.stop, h.notes.join("; ")].map(csvCell).join(","))]); }
  return {
    mount(el) {
      S.root = el; paint();
      el.addEventListener("click", (e) => {
        const a = e.target.closest("[data-act]")?.dataset.act;
        if (a === "scan") return scan(); if (a === "more") { S.f.limit += 60; return paint(); } if (a === "csv") return csv();
        const th = e.target.closest("[data-sort]"); if (th) { const k = th.dataset.sort; S.f.dir = S.f.sort === k ? -S.f.dir : k === "sym" ? 1 : -1; S.f.sort = k; LS.set("sufilters", S.f); paint(); }
      });
      el.addEventListener("input", (e) => { if (e.target.id === "su-q") { S.f.q = e.target.value; paint(); const q = $("#su-q"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); } });
      el.addEventListener("change", (e) => { const k = e.target.dataset.f; if (!k) return; S.f[k] = k === "minScore" ? +e.target.value || 0 : e.target.value; S.f.limit = 60; LS.set("sufilters", S.f); paint(); });
    },
    hits: () => S.hits,
  };
}
