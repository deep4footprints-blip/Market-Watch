// "Research" tab: Breadth & regime, Screener (RS / Stage / trend template), Sector rotation. All EOD, derived from Dhan daily history
// cached on the device. Nothing here is live: every panel states its as-of date and universe.
import { summarise, rateUniverse, breadth, regimeScore, REGIME_DEFAULT, DEFAULT_TEMPLATE, DEFAULT_RS_WEIGHTS, TD, ret, rsLine } from "./analytics.js";
import * as V from "./viz.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fin = (n) => n != null && Number.isFinite(n);
const pc = (n, d = 1) => { if (!fin(n)) return "—"; const t = (n * 100).toFixed(d); return Number(t) === 0 ? `${(0).toFixed(d)}%` : `${n > 0 ? "+" : ""}${t}%`; };
const p0 = (n) => (fin(n) ? `${n.toFixed(0)}%` : "—");
const px = (n) => (fin(n) ? n.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—");
const cls = (n) => (!fin(n) || Math.abs(n) < 0.0005 ? "flat" : n > 0 ? "up" : "dn");
const dstr = (t) => (t ? new Date(t * 1000).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—");
const STAGE_NAME = { 1: "1 Basing", 2: "2 Advancing", 3: "3 Topping", 4: "4 Declining" };
const DEFAULT_F = { q: "", minRs: 0, stage: "", minTt: 0, maxOff: "", rsHigh: false, sort: "rs", dir: -1, limit: 50 };
const COLS = [
  ["sym", "Symbol"], ["px", "Close"], ["r1m", "1M"], ["r3m", "3M"], ["r12m", "12M"], ["rs", "RS"], ["stage", "Stage"], ["tt", "Trend"], ["offHigh", "Off 52wH"], ["vs200", "vs 200D"],
];

export function createResearch({ LS, history, getInst, hasCreds, friendly, onHistory = () => {} }) {
  const S = {
    root: null, sub: LS.get("rsub", "breadth"), rows: [], bench: null, vix: null, sectors: [], br: null, regime: null, asOf: null,
    run: null, prog: null, err: "", filters: { ...DEFAULT_F, ...LS.get("rfilters", {}) }, weights: { ...REGIME_DEFAULT, ...LS.get("rweights", {}) },
    template: { ...DEFAULT_TEMPLATE, ...LS.get("rtemplate", {}) }, computing: false, universe: [], lastRes: null,
  };
  const $ = (q) => S.root?.querySelector(q);

  async function universe() {
    const inst = await getInst();
    const ix = (k) => inst.indices?.find((i) => i.key === k);
    const bench = ix("nifty50"), vix = ix("vix");
    const sectors = (inst.indices || []).filter((i) => i.group === "sector");
    const stocks = (inst.fno || []).map((s) => ({ seg: "NSE_EQ", id: s.id, instrument: "EQUITY", label: s.s, name: s.n, sym: s.s }));
    const idx = [bench, vix, ...sectors].filter(Boolean).map((i) => ({ seg: "IDX_I", id: i.id, instrument: "INDEX", label: i.name, name: i.name, key: i.key }));
    S.universe = [...idx, ...stocks];
    return { bench, vix, sectors, stocks };
  }

  async function compute() {
    S.computing = true; paint();
    const u = await universe();
    if (!u.bench) { S.computing = false; S.err = "Nifty 50 not found in instruments.json"; return paint(); }
    const benchBars = await history.bars("IDX_I", u.bench.id);
    S.bench = benchBars;
    S.vix = u.vix ? (await history.bars("IDX_I", u.vix.id)).map((b) => b.c) : null;
    const rows = [];
    for (const s of u.stocks) {
      const b = await history.bars("NSE_EQ", s.id);
      if (b.length < 60) continue;
      const r = summarise(b, benchBars, DEFAULT_RS_WEIGHTS);
      rows.push({ ...r, key: `NSE_EQ:${s.id}`, id: s.id, sym: s.sym, name: s.name });
    }
    rateUniverse(rows, S.template);
    S.rows = rows;
    S.br = rows.length ? breadth(rows) : null;
    // sectors: relative strength of each sector index vs Nifty 50
    const secRows = [];
    for (const sc of u.sectors) {
      const b = await history.bars("IDX_I", sc.id);
      if (b.length < 130 || !benchBars.length) continue;
      const cl = b.map((x) => x.c), bcl = benchBars.map((x) => x.c);
      const rel = (d, back = 0) => { const a = ret(cl.slice(0, cl.length - back), d), c = ret(bcl.slice(0, bcl.length - back), d); return fin(a) && fin(c) ? (1 + a) / (1 + c) - 1 : null; };
      const r3 = rel(TD.m3), r3prev = rel(TD.m3, TD.m1);
      const mom = fin(r3) && fin(r3prev) ? r3 - r3prev : null;
      secRows.push({ id: sc.id, name: sc.name, r1m: ret(cl, TD.m1), r3m: ret(cl, TD.m3), r6m: ret(cl, TD.m6), rel3: r3, mom, quad: quadrant(r3, mom), px: cl[cl.length - 1] });
    }
    S.sectors = secRows;
    S.regime = regimeScore({ indexCl: benchBars.map((b) => b.c), vixCl: S.vix, br: S.br }, S.weights);
    S.asOf = benchBars.length ? benchBars[benchBars.length - 1].t : null;
    S.computing = false; S.err = "";
    paint();
  }

  const quadrant = (rel, mom) => (!fin(rel) || !fin(mom) ? null : rel >= 0 ? (mom >= 0 ? "Leading" : "Weakening") : mom >= 0 ? "Improving" : "Lagging");

  async function load(force = false) {
    if (S.run) return;
    if (!hasCreds()) { S.err = friendly({ code: "NOKEY" }); return paint(); }
    await universe();
    const ctrl = new AbortController();
    S.run = ctrl; S.err = ""; S.prog = { i: 0, n: S.universe.length, label: "" }; paint();
    // benchmark first so partial runs are still usable
    const order = [...S.universe].sort((a, b) => (a.seg === "IDX_I" ? 0 : 1) - (b.seg === "IDX_I" ? 0 : 1));
    let last = 0;
    const res = await history.ensure(order, {
      force, signal: ctrl.signal,
      onProgress: (p) => { S.prog = p; if (Date.now() - last > 400) { last = Date.now(); const el = $("#rs-prog"); if (el) el.innerHTML = progHtml(); } },
    });
    S.run = null; S.prog = null; S.lastRes = res;
    if (res.aborted === "auth") S.err = "Dhan rejected the token. Paste a fresh one in Settings.";
    else if (res.aborted === "network") S.err = "Offline or Dhan unreachable. Cached data is still shown.";
    else if (res.failed.length) S.err = `${res.failed.length} instrument(s) failed (e.g. ${res.failed[0].label}: ${res.failed[0].message}).`;
    onHistory(res);
    await compute();
  }

  const progHtml = () => {
    const p = S.prog; if (!p) return "";
    const pctDone = p.n ? (p.i / p.n) * 100 : 0;
    const eta = Math.max(0, Math.round(((p.n - p.i) * 0.4)));
    return `<div class="note">Loading daily history from Dhan: ${p.i}/${p.n} ${esc(p.label)} · about ${eta}s left (Dhan chart-API pacing).</div><div class="bar"><i style="width:${pctDone.toFixed(1)}%;background:var(--acc)"></i></div>`;
  };

  // ---------- views ----------
  const head = () => `<div class="rs-top"><div class="seg">${[["breadth", "Breadth"], ["screen", "Screener"], ["sectors", "Sectors"]].map(([k, l]) => `<button data-sub="${k}" class="${S.sub === k ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="rs-act">${S.run ? `<button class="btn ghost" data-act="cancel">Stop</button>` : `<button class="btn ghost" data-act="load">${S.rows.length ? "Refresh history" : "Load history"}</button>`}</div></div>
    <div id="rs-prog">${progHtml()}</div>${S.err ? `<div class="banner-inline">${esc(S.err)}</div>` : ""}
    <div class="note">${S.asOf ? `EOD data as of <b>${dstr(S.asOf)}</b> close · ` : ""}Universe: Nifty F&amp;O stocks (${S.rows.length} with enough history) · source: Dhan daily bars, price-only · derived metrics, not live.</div>`;

  const empty = () => `<div class="empty">${S.computing ? "Computing…" : hasCreds() ? "No history cached yet. Press <b>Load history</b> (about 1.5 min for the first run; later runs only fetch what is stale)." : "Add your Dhan credentials in Settings first."}</div>`;

  function breadthView() {
    if (!S.br) return empty();
    const b = S.br, r = S.regime;
    const bar = (label, o) => `<div class="mrow"><span>${label}</span><div class="bar"><i style="width:${fin(o.pct) ? o.pct.toFixed(1) : 0}%;background:${fin(o.pct) && o.pct >= 50 ? V.C.up : V.C.dn}"></i></div><b>${p0(o.pct)}</b></div>`;
    const bar2 = (label, v) => bar(label, { pct: v });
    const comps = r ? Object.entries(r.components).map(([k, c]) => `<tr><td>${k}</td><td>${(r.weights[k] * 100).toFixed(0)}%</td><td>${(c.v * 100).toFixed(0)}</td><td class="note">${esc(c.detail)}</td></tr>`).join("") : "";
    const missing = r ? Object.keys(REGIME_DEFAULT).filter((k) => !r.components[k]) : [];
    const stN = Math.max(1, b.stageN);
    return `<div class="hero">
      <div class="card"><div class="n">Market regime (model)</div>${r ? V.gauge(r.score / 100, { label: r.score.toFixed(0), sub: "/ 100", w: 170, color: r.score >= 60 ? V.C.up : r.score >= 40 ? V.C.acc : V.C.dn }) : "—"}
        <div class="v" style="font-size:20px">${r ? esc(r.label) : "—"}</div><div class="note">Coverage ${r ? (r.coverage * 100).toFixed(0) : 0}% of weight${missing.length ? ` · missing: ${missing.join(", ")}` : ""}. Model classification, not a forecast.</div></div>
      <div class="card"><div class="n">New 52-week highs / lows</div><div class="v"><span class="up">${b.newHighs}</span> <span class="flat">/</span> <span class="dn">${b.newLows}</span></div><div class="note">Close-based, ${b.cov52} stocks with ≥ 1y history</div>
        <div class="note">Within 5% of high: ${p0(b.near5)} · 10%: ${p0(b.near10)} · 20%: ${p0(b.near20)}</div></div>
    </div>
    <h3>% of stocks above moving average</h3><div class="card">${bar("20 DMA", b.above20)}${bar("50 DMA", b.above50)}${bar("100 DMA", b.above100)}${bar("150 DMA", b.above150)}${bar("200 DMA", b.above200)}${bar2("3M return > 0", b.posR3m)}</div>
    <h3>Stage distribution (daily 150-DMA approximation)</h3><div class="card">${V.stack(b.stages.map((v, i) => ({ v, color: [V.C.cat[5], V.C.up, V.C.acc, V.C.dn][i] })))}
      <div class="legend rs-legend">${b.stages.map((v, i) => `<div><span>${STAGE_NAME[i + 1]}</span><b>${v} · ${((v / stN) * 100).toFixed(0)}%</b></div>`).join("")}</div></div>
    <h3>Regime inputs and weights</h3>
    <div class="card">${r ? `<table class="rs-t"><thead><tr><th>Input</th><th>Weight</th><th>Score</th><th>How it is computed</th></tr></thead><tbody>${comps}</tbody></table>` : empty()}
      <div class="rs-w">${Object.entries(S.weights).map(([k, w]) => `<label>${k}<input class="mini num" data-w="${k}" type="number" min="0" max="100" step="5" value="${Math.round(w * 100)}"></label>`).join("")}<button class="btn ghost" data-act="wreset">Reset</button></div>
      <div class="note">Weights are relative (re-normalised over available inputs). Missing inputs are excluded and lower the coverage figure, not treated as neutral.</div></div>`;
  }

  function filtered() {
    const f = S.filters, q = f.q.trim().toUpperCase();
    let rows = S.rows.filter((r) =>
      (!q || r.sym.includes(q) || (r.name || "").toUpperCase().includes(q)) &&
      (!f.minRs || (r.rs ?? 0) >= f.minRs) &&
      (!f.stage || r.stage?.stage === +f.stage) &&
      (!f.minTt || (r.tt?.passed ?? 0) >= f.minTt) &&
      (f.maxOff === "" || (fin(r.offHigh) && r.offHigh * 100 <= +f.maxOff)) &&
      (!f.rsHigh || r.rsNewHigh === true));
    const val = (r) => ({ sym: r.sym, px: r.px, r1m: r.r1m, r3m: r.r3m, r12m: r.r12m, rs: r.rs, stage: r.stage?.stage, tt: r.tt?.passed, offHigh: r.offHigh, vs200: r.sma200 ? r.px / r.sma200 - 1 : null })[f.sort];
    rows.sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1; if (y == null) return -1;
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * f.dir;
    });
    return rows;
  }

  function screenView() {
    if (!S.rows.length) return empty();
    const f = S.filters, all = filtered(), shown = all.slice(0, f.limit);
    const watch = new Set(LS.get("watch", []).map((w) => String(w.id)));
    const ttTotal = S.rows[0]?.tt?.rules.length || 9;
    const rowsHtml = shown.map((r) => `<tr>
      <td class="sym" data-c="${esc(["NSE_EQ", r.id, "EQUITY", r.sym, r.name || ""].join("|"))}"><b>${esc(r.sym)}</b><small>${esc(r.name || "")}</small></td>
      <td>${px(r.px)}</td><td class="${cls(r.r1m)}">${pc(r.r1m)}</td><td class="${cls(r.r3m)}">${pc(r.r3m)}</td><td class="${cls(r.r12m)}">${pc(r.r12m)}</td>
      <td><b>${r.rs ?? "—"}</b>${r.rsNewHigh ? ` <span class="tag up" title="RS line at 52w high">RS↑</span>` : ""}</td>
      <td>${r.stage ? `<span class="st st${r.stage.stage}" title="slope ${pc(r.stage.slope)}${r.stage.conf === "low" ? " · price within 2% of MA: low confidence" : ""}">${r.stage.stage}${r.stage.conf === "low" ? "?" : ""}</span>` : "—"}</td>
      <td><span title="${esc(r.tt ? r.tt.rules.map((x) => `${x.pass ? "✓" : "✗"} ${x.label}`).join("\n") : "")}">${r.tt ? `${r.tt.passed}/${r.tt.total}${r.tt.unknown ? "*" : ""}` : "—"}</span></td>
      <td class="${cls(-r.offHigh)}">${fin(r.offHigh) ? `-${(r.offHigh * 100).toFixed(1)}%` : "—"}</td><td class="${cls(r.sma200 ? r.px / r.sma200 - 1 : null)}">${r.sma200 ? pc(r.px / r.sma200 - 1) : "—"}</td>
      <td><button class="x-btn" data-wl="${r.id}" data-s="${esc(r.sym)}" data-n="${esc(r.name || "")}" aria-label="Add to watchlist">${watch.has(String(r.id)) ? "★" : "☆"}</button></td></tr>`).join("");
    return `<div class="rs-f">
      <input id="rs-q" placeholder="Search symbol/name" value="${esc(f.q)}">
      <label>RS ≥<input class="mini num" data-f="minRs" type="number" min="0" max="99" value="${f.minRs || ""}"></label>
      <label>Stage<select class="mini" data-f="stage"><option value="">any</option>${[1, 2, 3, 4].map((s) => `<option value="${s}" ${+f.stage === s ? "selected" : ""}>${s}</option>`).join("")}</select></label>
      <label>Trend ≥<input class="mini num" data-f="minTt" type="number" min="0" max="${ttTotal}" value="${f.minTt || ""}"></label>
      <label>≤ % off high<input class="mini num" data-f="maxOff" type="number" min="0" max="100" value="${f.maxOff}"></label>
      <label><input type="checkbox" data-f="rsHigh" ${f.rsHigh ? "checked" : ""}> RS line at 52w high</label>
      <button class="btn ghost" data-act="freset">Clear</button><button class="btn ghost" data-act="csv">CSV</button></div>
    <div class="note">${all.length} of ${S.rows.length} stocks match. RS = percentile (1–99) of weighted 3/6/9/12-month performance vs Nifty 50 within this universe. Trend = Minervini-style template, hover for each rule; * = a rule lacked data. Stage = daily approximation; "?" = low confidence.</div>
    <div class="tw"><table class="rs-t sc"><thead><tr>${COLS.map(([k, l]) => `<th data-sort="${k}" class="${f.sort === k ? "on" : ""}">${l}${f.sort === k ? (f.dir < 0 ? " ▾" : " ▴") : ""}</th>`).join("")}<th></th></tr></thead><tbody>${rowsHtml || `<tr><td colspan="11" class="empty">No stocks match these filters.</td></tr>`}</tbody></table></div>
    ${all.length > shown.length ? `<button class="btn ghost" data-act="more">Show more (${all.length - shown.length})</button>` : ""}`;
  }

  function sectorsView() {
    if (!S.sectors.length) return empty();
    const rows = [...S.sectors].sort((a, b) => (b.rel3 ?? -9) - (a.rel3 ?? -9));
    return `<div class="note">Sector indices vs Nifty 50. Relative 3M = (1+sector 3M)/(1+Nifty 3M)−1. Momentum = change in that relative figure over the last month. Quadrants: Leading (rel+, mom+), Weakening (rel+, mom−), Lagging (rel−, mom−), Improving (rel−, mom+). This is a simple return-based rotation view, <b>not</b> JdK RS-Ratio/RS-Momentum.</div>
    <div class="tw"><table class="rs-t"><thead><tr><th>Sector</th><th>1M</th><th>3M</th><th>6M</th><th>Rel 3M</th><th>Mom</th><th>Quadrant</th></tr></thead><tbody>${rows.map((r) => `<tr><td class="sym" data-c="${esc(["IDX_I", r.id, "INDEX", r.name, ""].join("|"))}"><b>${esc(r.name.replace("Nifty ", ""))}</b></td><td class="${cls(r.r1m)}">${pc(r.r1m)}</td><td class="${cls(r.r3m)}">${pc(r.r3m)}</td><td class="${cls(r.r6m)}">${pc(r.r6m)}</td><td class="${cls(r.rel3)}">${pc(r.rel3)}</td><td class="${cls(r.mom)}">${pc(r.mom)}</td><td>${r.quad ? `<span class="tag q${r.quad}">${r.quad}</span>` : "—"}</td></tr>`).join("")}</tbody></table></div>
    <div class="note">Constituent-level sector breadth needs an effective-dated sector classification, which is not connected (see Data tab).</div>`;
  }

  function paint() {
    if (!S.root) return;
    const keepQ = S.root.querySelector("#rs-q") === document.activeElement;
    const body = S.sub === "breadth" ? breadthView() : S.sub === "screen" ? screenView() : sectorsView();
    S.root.innerHTML = `${head()}<div id="rs-body">${body}</div>`;
    if (keepQ) { const q = $("#rs-q"); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
  }

  const saveF = () => LS.set("rfilters", S.filters);
  function csv() {
    const rows = filtered();
    const f = S.filters;
    const head = [`# Market Pulse screener export`, `# As of EOD ${dstr(S.asOf)} · source: Dhan daily bars (price-only, derived) · universe: Nifty F&O stocks`, `# Filters: ${JSON.stringify({ ...f, sort: undefined, dir: undefined, limit: undefined })}`, `# RS weights ${JSON.stringify(DEFAULT_RS_WEIGHTS)} vs Nifty 50 · stage = daily 150DMA approximation`,
      "symbol,close,ret_1m,ret_3m,ret_12m,rs_rating,stage,trend_passed,trend_total,pct_off_52w_high,pct_vs_200dma"];
    const body = rows.map((r) => [r.sym, r.px, r.r1m, r.r3m, r.r12m, r.rs, r.stage?.stage ?? "", r.tt?.passed ?? "", r.tt?.total ?? "", fin(r.offHigh) ? (r.offHigh * 100).toFixed(2) : "", r.sma200 ? ((r.px / r.sma200 - 1) * 100).toFixed(2) : ""].map((x) => (x == null ? "" : fin(x) ? +x.toFixed?.(6) ?? x : x)).join(","));
    const blob = new Blob([[...head, ...body].join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `screener-${dstr(S.asOf).replace(/ /g, "-")}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function bind() {
    S.root.addEventListener("click", (e) => {
      const sub = e.target.closest("[data-sub]");
      if (sub) { S.sub = sub.dataset.sub; LS.set("rsub", S.sub); return paint(); }
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "load") return load(false);
      if (act === "cancel") { S.run?.abort(); return; }
      if (act === "more") { S.filters.limit += 50; return paint(); }
      if (act === "freset") { S.filters = { ...DEFAULT_F }; saveF(); return paint(); }
      if (act === "csv") return csv();
      if (act === "wreset") { S.weights = { ...REGIME_DEFAULT }; LS.set("rweights", S.weights); return compute(); }
      const th = e.target.closest("[data-sort]");
      if (th) { const k = th.dataset.sort; S.filters.dir = S.filters.sort === k ? -S.filters.dir : (k === "sym" ? 1 : -1); S.filters.sort = k; saveF(); return paint(); }
      const wl = e.target.closest("[data-wl]");
      if (wl) {
        const list = LS.get("watch", []);
        if (!list.some((x) => String(x.id) === wl.dataset.wl) && list.length < 100) list.push({ id: Number(wl.dataset.wl), s: wl.dataset.s, n: wl.dataset.n });
        LS.set("watch", list); wl.textContent = "★";
      }
    });
    S.root.addEventListener("input", (e) => {
      const t = e.target;
      if (t.id === "rs-q") { S.filters.q = t.value; S.filters.limit = 50; saveF(); const b = $("#rs-body"); if (b) b.innerHTML = screenView(); }
      else if (t.dataset.w) {
        S.weights[t.dataset.w] = Math.max(0, Math.min(100, +t.value || 0)) / 100; LS.set("rweights", S.weights);
        clearTimeout(bind.t); bind.t = setTimeout(() => { if (S.br) { S.regime = regimeScore({ indexCl: (S.bench || []).map((b) => b.c), vixCl: S.vix, br: S.br }, S.weights); const keep = t.dataset.w; paint(); $(`[data-w="${keep}"]`)?.focus(); } }, 400);
      }
    });
    S.root.addEventListener("change", (e) => {
      const k = e.target.dataset.f; if (!k) return;
      const v = e.target.type === "checkbox" ? e.target.checked : e.target.value;
      S.filters[k] = ["minRs", "minTt"].includes(k) ? +v || 0 : v; S.filters.limit = 50; saveF(); paint();
    });
  }

  return {
    mount(el) { S.root = el; bind(); paint(); compute().catch((e) => { S.computing = false; S.err = String(e.message || e); paint(); }); },
    status: () => ({ run: !!S.run }),
  };
}
