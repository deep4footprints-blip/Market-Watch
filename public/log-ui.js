// "Log" tab: minute-by-minute P&L for (a) the Dhan live portfolio and (b) Payoff strategy sessions, kept separate.
import { summarize, toCsv, hm, dayOf } from "./pnllog.js";
import { morph } from "./dom.js";
import * as V from "./viz.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fin = (n) => n != null && Number.isFinite(n);
const money = (n) => {
  if (!fin(n)) return "—";
  const a = Math.abs(n), s = n < 0 ? "−" : "+";
  return a >= 1e7 ? `${s}₹${(a / 1e7).toFixed(2)} Cr` : a >= 1e5 ? `${s}₹${(a / 1e5).toFixed(2)} L` : `${s}₹${Math.round(a).toLocaleString("en-IN")}`;
};
const cls = (n) => (!fin(n) || n === 0 ? "flat" : n > 0 ? "up" : "dn");
const axis = (n) => (Math.abs(n) >= 1e5 ? `${(n / 1e5).toFixed(1)}L` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${Math.round(n)}`);
const SESSION = [9 * 60 + 15, 15 * 60 + 30]; // minutes of IST day, the x-axis span

const SERIES = {
  port: { title: "Dhan portfolio", cols: ["total", "holdings_day", "positions"], names: ["Total", "Holdings (day)", "Positions"], colors: [V.C.acc, "#4f8cff", "#b08cff"], blurb: "Holdings day P&L (LTP − prev close) plus open/booked positions P&L reported by Dhan." },
  st: { title: "Payoff strategy", cols: ["total", "realised", "open"], names: ["Total", "Realised", "Open (LTP − entry)"], colors: [V.C.acc, "#4f8cff", "#b08cff"], blurb: "Strategy P&L: exited legs (exit − entry) plus open legs (LTP − entry)." },
};

const SRC = { live: "Live samples (taken while the app was open)", recon: "Reconstructed from Dhan 1-minute history", mixed: "Live samples + reconstructed gaps" };

export function createLogUI({ plog, LS, rebuild = {} }) {
  const S = { root: null, kind: LS.get("logKind", "port"), sid: null, day: null, scrub: null, off: {}, sig: "", busy: false, status: "", last: {} };
  const $ = (q) => S.root?.querySelector(q);

  const seriesId = () => (S.kind === "port" ? "port" : S.sid ? `st:${S.sid}` : null);
  function pick() {
    if (S.kind === "st") {
      const ss = plog.sessions();
      if (!ss.some((x) => x.id === S.sid)) S.sid = ss[0]?.id || null;
    }
    const id = seriesId(), days = id ? plog.days(id) : [];
    if (!days.includes(S.day)) S.day = days[0] || null;
    return { id, days };
  }

  function chart(pts, cfg) {
    const W = 360, H = 230, Lm = 48, Rm = 8, Tm = 10, Bm = 20;
    const t0 = pts[0][0] - (((pts[0][0] + 330 * 60000) % 864e5) - SESSION[0] * 60000); // 09:15 IST of that day
    const t1 = t0 + (SESSION[1] - SESSION[0]) * 60000;
    const cols = cfg.cols.map((_, k) => k).filter((k) => k === 0 || !S.off[k]);
    const vals = pts.flatMap((p) => cols.map((k) => p[1 + k]));
    let mn = Math.min(0, ...vals), mx = Math.max(0, ...vals);
    const pad = (mx - mn || 1) * 0.1; mn -= pad; mx += pad;
    const X = (t) => Lm + ((Math.min(Math.max(t, t0), t1) - t0) / (t1 - t0)) * (W - Lm - Rm);
    const Y = (v) => Tm + ((mx - v) / (mx - mn)) * (H - Tm - Bm);
    const y0 = Y(0), f = (n) => n.toFixed(1);
    const path = (k) => pts.map((p, i) => `${i ? "L" : "M"}${f(X(p[0]))},${f(Y(p[1 + k]))}`).join("");
    const tot = path(0);
    const area = `${tot}L${f(X(pts[pts.length - 1][0]))},${f(y0)}L${f(X(pts[0][0]))},${f(y0)}Z`;
    const yt = [mn + pad, (mn + mx) / 2, mx - pad].map((v) => `<line x1="${Lm}" x2="${W - Rm}" y1="${f(Y(v))}" y2="${f(Y(v))}" stroke="#16161a"/><text x="${Lm - 4}" y="${f(Y(v) + 3)}" text-anchor="end">${axis(v)}</text>`).join("");
    const xt = [9 * 60 + 15, 11 * 60, 13 * 60, 15 * 60].map((m) => { const t = t0 + (m - SESSION[0]) * 60000; return `<text x="${f(X(t))}" y="${H - 5}" text-anchor="middle">${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}</text>`; }).join("");
    const lines = cols.filter((k) => k > 0).map((k) => `<path d="${path(k)}" fill="none" stroke="${cfg.colors[k]}" stroke-width="1.3" opacity=".85"/>`).join("");
    const last = pts[pts.length - 1];
    const hi = pts.reduce((a, p) => (p[1] > a[1] ? p : a)), lo = pts.reduce((a, p) => (p[1] < a[1] ? p : a));
    const dot = (p, c) => `<circle cx="${f(X(p[0]))}" cy="${f(Y(p[1]))}" r="3" fill="#000" stroke="${c}" stroke-width="1.5"/>`;
    S.geom = { t0, t1, W, Lm, Rm };
    return `<svg id="lg-svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="P&L by minute" style="touch-action:pan-y;display:block">
      <defs><clipPath id="lu"><rect x="0" y="0" width="${W}" height="${f(y0)}"/></clipPath><clipPath id="ld"><rect x="0" y="${f(y0)}" width="${W}" height="${H}"/></clipPath></defs>
      <g font-size="9" fill="#8a8a90" font-family="ui-monospace,monospace">${yt}${xt}</g>
      <line x1="${Lm}" x2="${W - Rm}" y1="${f(y0)}" y2="${f(y0)}" stroke="#4a4a52"/>
      <path d="${area}" fill="#2ecc8f" opacity=".16" clip-path="url(#lu)"/><path d="${area}" fill="#ff5c5c" opacity=".2" clip-path="url(#ld)"/>
      ${lines}
      <path d="${tot}" fill="none" stroke="#2ecc8f" stroke-width="2" clip-path="url(#lu)"/><path d="${tot}" fill="none" stroke="#ff5c5c" stroke-width="2" clip-path="url(#ld)"/>
      ${dot(hi, V.C.up)}${dot(lo, V.C.dn)}${dot(last, "#f2f2f0")}
      <line id="lg-xl" x1="0" x2="0" y1="${Tm}" y2="${H - Bm}" stroke="#fff" stroke-width=".8" opacity="0"/>
    </svg>`;
  }

  async function run(manual) {
    const { id } = pick();
    const key = S.kind === "port" ? "port" : id;
    if (S.busy || !key || (!manual && Date.now() - (S.last[key] || 0) < 300000)) return;
    S.busy = true; S.status = "Rebuilding from Dhan 1-minute history…"; draw(true);
    try {
      const res = S.kind === "port" ? await rebuild.portfolio?.(5) : await rebuild.strategy?.(S.sid.replace(/^st:/, ""));
      if (res?.skipped) S.status = "";
      else { S.last[key] = Date.now(); S.status = res && res.added ? `Filled ${res.added} missing minutes from Dhan history.` : "History is up to date."; }
    } catch (e) { S.last[key] = Date.now(); S.status = `Rebuild failed: ${e.message || e}`; }
    S.busy = false; draw(true);
  }

  function html() {
    const cfg = SERIES[S.kind], { id, days } = pick();
    const tabs = `<div class="seg lgk"><button data-k="port" class="${S.kind === "port" ? "on" : ""}">Dhan portfolio</button><button data-k="st" class="${S.kind === "st" ? "on" : ""}">Payoff strategy</button></div>`;
    let sess = "";
    if (S.kind === "st") {
      const ss = plog.sessions();
      sess = ss.length ? `<label class="sess"><span class="n">Strategy</span><select id="lg-sid">${ss.map((x) => `<option value="${esc(x.id)}" ${x.id === S.sid ? "selected" : ""}>${esc(x.name || x.id)}</option>`).join("")}</select></label>${ss.find((x) => x.id === S.sid)?.legs ? `<div class="note">${esc(ss.find((x) => x.id === S.sid).legs)}</div>` : ""}` : "";
    }
    const chips = days.length ? `<div class="chips">${days.slice(0, 10).map((d) => `<button class="chip ${d === S.day ? "on" : ""}" data-day="${d}">${new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}</button>`).join("")}</div>` : "";
    const rb = `<div class="lgb"><button class="chip" id="lg-rb" ${S.busy ? "disabled" : ""}>↻ Rebuild history</button></div><div class="note" id="lg-st">${esc(S.status)}</div>`;
    if (!id || !S.day) {
      return `<h2>P&amp;L log</h2>${tabs}${sess}${rb}<div class="empty big"><b>No history yet</b><br>${S.kind === "port" ? "Tap Rebuild: the last trading days are rebuilt from Dhan's 1-minute candles of your holdings." : "Tap Rebuild: the P&amp;L since entry is rebuilt from the legs' 1-minute candles. Build or open a strategy in the Payoff tab first."}</div>`;
    }
    const pts = plog.get(id, S.day), sm = summarize(pts);
    const live = S.day === dayOf(Date.now());
    const card = (n, v, k = "", sub = "") => `<div class="card"><div class="n">${n}</div><div class="v sm ${k}">${v}</div>${sub ? `<div class="note">${sub}</div>` : ""}</div>`;
    const legend = `<div class="lgt">${cfg.names.map((n, k) => `<button data-col="${k}" class="${k === 0 || !S.off[k] ? "on" : ""}" ${k === 0 ? "disabled" : ""}><i style="background:${cfg.colors[k]}"></i>${n}</button>`).join("")}</div>`;
    return `<h2>P&amp;L log</h2>${tabs}${sess}${chips}
      <div class="hero lgs">
        ${card(live ? "Now" : "Close", money(sm.last[1]), cls(sm.last[1]), hm(sm.last[0]))}
        ${card("Peak", money(sm.hi[1]), cls(sm.hi[1]), hm(sm.hi[0]))}
        ${card("Trough", money(sm.lo[1]), cls(sm.lo[1]), hm(sm.lo[0]))}
        ${card("Max drawdown", money(sm.drawdown), cls(sm.drawdown), "peak to trough")}
      </div>
      <div class="n" style="margin-top:6px">${esc(cfg.title)} · ${S.day} · ${sm.n} minutes (${hm(sm.first[0])}–${hm(sm.last[0])})</div>
      <div class="note">${SRC[plog.source(id, S.day)] || ""}${plog.meta?.(id)?.recon === "model" && S.kind === "st" ? " · option prices modelled (Black-Scholes anchored to your entry) because Dhan candles were unavailable" : ""}</div>
      ${legend}<div id="lg-chart">${chart(pts, cfg)}</div><div id="lg-read" class="note">Drag across the chart to read the P&amp;L at any minute.</div>
      <div class="lgb"><button class="chip" id="lg-csv">Copy CSV</button><button class="chip" id="lg-rb" ${S.busy ? "disabled" : ""}>↻ Rebuild history</button><button class="chip dn" id="lg-clr">Delete this day</button></div>
      <div class="note" id="lg-st">${esc(S.status)}</div>
      <h3>${S.kind === "port" ? "Day P&amp;L at close, by day" : "Strategy P&amp;L at day end, by day"}</h3>
      ${V.divBars(days.slice(0, 10).map((d) => { const a = plog.get(id, d), l = a[a.length - 1]; return { label: new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }), value: l ? l[1] : null, attrs: `data-day="${d}"` }; }), { fmt: money })}
      <div class="note">${esc(cfg.blurb)} Live samples are taken once a minute while the app is open. Everything else is rebuilt from Dhan's 1-minute candles whenever you open this tab, so it does not need the app running. Rebuilt holdings P&amp;L assumes today's quantities; positions are not rebuilt.</div>`;
  }

  function scrub(e) {
    const svg = $("#lg-svg"), id = seriesId();
    if (!svg || !S.geom || !id) return;
    const pts = plog.get(id, S.day);
    if (!pts.length) return;
    const r = svg.getBoundingClientRect(), g = S.geom;
    const px = Math.min(Math.max(((e.clientX - r.left) / r.width) * g.W, g.Lm), g.W - g.Rm);
    const t = g.t0 + ((px - g.Lm) / (g.W - g.Lm - g.Rm)) * (g.t1 - g.t0);
    const p = pts.reduce((a, q) => (Math.abs(q[0] - t) < Math.abs(a[0] - t) ? q : a));
    const x = g.Lm + ((p[0] - g.t0) / (g.t1 - g.t0)) * (g.W - g.Lm - g.Rm);
    const xl = svg.querySelector("#lg-xl");
    if (xl) { xl.setAttribute("x1", x); xl.setAttribute("x2", x); xl.setAttribute("opacity", ".7"); }
    const cfg = SERIES[S.kind];
    $("#lg-read").innerHTML = `<b>${hm(p[0])}</b> · ${cfg.names.map((n, k) => `${n} <b class="${cls(p[1 + k])}">${money(p[1 + k])}</b>`).join(" · ")}`;
  }

  function draw(force) {
    if (!S.root?.isConnected) return;
    if (S.scrub && !force) return; // don't redraw under a finger
    const el = $("#lg-body");
    if (document.activeElement?.id === "lg-sid" && !force) return;
    morph(el, html());
  }

  function bind(root) {
    root.addEventListener("click", async (e) => {
      const t = e.target.closest("button, [data-day]");
      if (!t) return;
      if (t.id === "lg-rb") return run(true);
      if (t.dataset.k) { S.kind = t.dataset.k; LS.set("logKind", S.kind); S.day = null; S.off = {}; S.status = ""; draw(true); return run(false); }
      if (t.dataset.day) { S.day = t.dataset.day; return draw(true); }
      if (t.dataset.col) { S.off[t.dataset.col] = !S.off[t.dataset.col]; return draw(true); }
      if (t.id === "lg-clr") { const id = seriesId(); if (id && S.day) { plog.clearDay(id, S.day); S.day = null; draw(true); } return; }
      if (t.id === "lg-csv") {
        const id = seriesId(), cfg = SERIES[S.kind];
        if (!id) return;
        const csv = toCsv(plog.get(id, S.day), cfg.cols);
        try { await navigator.clipboard.writeText(csv); t.textContent = "Copied ✓"; } catch { t.textContent = "Copy blocked"; }
        setTimeout(() => { t.textContent = "Copy CSV"; }, 1500);
      }
    });
    root.addEventListener("change", (e) => { if (e.target.id === "lg-sid") { S.sid = e.target.value; S.day = null; S.status = ""; draw(true); run(false); } });
    root.addEventListener("pointerdown", (e) => { if (e.target.closest("#lg-chart")) { S.scrub = true; scrub(e); } });
    root.addEventListener("pointermove", (e) => { if (S.scrub || (e.pointerType === "mouse" && e.target.closest("#lg-chart"))) scrub(e); });
    for (const ev of ["pointerup", "pointercancel"]) root.addEventListener(ev, () => { S.scrub = false; });
  }

  return {
    mount(root) { S.root = root; root.innerHTML = `<div id="lg-body"></div>`; bind(root); draw(true); run(false); },
    refresh() { draw(false); },
  };
}
