// Full-screen candlestick chart for any ticker: customisable timeframe, pan/zoom, SMA, volume, live last candle.
import { applyTick, fetchCandles, hhmm, dayStr, istDay, PRESETS, parseTf, sma, tfLabel } from "./candles.js";
import { morph } from "./dom.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fin = (n) => n != null && Number.isFinite(n);
const px = (n) => (fin(n) ? Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
const vol = (n) => (n >= 1e7 ? `${(n / 1e7).toFixed(2)}Cr` : n >= 1e5 ? `${(n / 1e5).toFixed(2)}L` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n || 0)));
const UP = "#2ecc8f", DN = "#ff5c5c", ACC = "#d9c9a3", MUTE = "#8a8a90";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const W = 360, H = 330, LM = 4, RM = 52, PT = 8, PB = 236, VT = 246, VB = 304, AX = 322;

export function createChart({ client, LS, friendly, getQuote }) {
  const saved = LS.get("ct", {});
  const C = {
    open: false, pushed: false, inst: null, tf: saved.tf || "5", cands: [], loading: false, err: "",
    vis: saved.vis || 70, off: 0, sel: null, sma20: saved.sma20 !== false, sma50: !!saved.sma50, vol: saved.vol !== false,
    fetchedAt: 0, root: null, geom: null, drag: null,
  };
  const persist = () => LS.set("ct", { tf: C.tf, vis: C.vis, sma20: C.sma20, sma50: C.sma50, vol: C.vol });
  const root = () => (C.root ||= document.getElementById("chartm"));
  const $ = (s) => root().querySelector(s);
  const refreshMs = () => (parseTf(C.tf).kind === "I" ? 60e3 : 5 * 60e3);

  async function load() {
    if (C.loading || !C.inst) return;
    C.loading = true; C.err = ""; draw();
    const tf = C.tf, inst = C.inst;
    try {
      const c = await fetchCandles(client, inst, tf);
      if (tf !== C.tf || inst !== C.inst) { C.loading = false; return load(); } // timeframe/ticker changed mid-flight
      C.cands = c; C.fetchedAt = Date.now();
      C.err = c.length ? "" : "No candles returned (market closed, or no chart data for this instrument on your plan).";
    } catch (e) { C.err = e instanceof TypeError ? "Could not reach Dhan." : friendly(e); }
    C.loading = false; draw();
  }

  function slice() {
    const n = C.vis, end = Math.max(C.cands.length - C.off, 0), start = Math.max(end - n, 0);
    return { start, end, n, view: C.cands.slice(start, end) };
  }

  function chartSvg() {
    if (!C.cands.length) return `<div class="empty">${C.loading ? "Loading candles…" : esc(C.err || "—")}</div>`;
    const { start, n, view } = slice();
    const sm20 = C.sma20 ? sma(C.cands, 20).slice(start, start + view.length) : [], sm50 = C.sma50 ? sma(C.cands, 50).slice(start, start + view.length) : [];
    const hi = Math.max(...view.map((k) => k.h), ...sm20.filter(fin), ...sm50.filter(fin)), lo = Math.min(...view.map((k) => k.l), ...sm20.filter(fin), ...sm50.filter(fin));
    const padv = (hi - lo || hi * 0.01) * 0.08, top = hi + padv, bot = lo - padv;
    const slot = (W - LM - RM) / n, bw = Math.max(slot * 0.66, 1);
    const Y = (v) => PT + ((top - v) / (top - bot)) * (PB - PT);
    const pos = (i) => LM + (n - view.length + i) * slot + slot / 2;
    const vmax = Math.max(1, ...view.map((k) => k.v));
    C.geom = { slot, n, vlen: view.length, start };
    const intraday = parseTf(C.tf).kind === "I";
    // grid + price axis
    let g = "";
    for (let i = 0; i <= 4; i++) { const v = bot + ((top - bot) * i) / 4, y = Y(v); g += `<line x1="${LM}" x2="${W - RM}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#16161a"/><text x="${W - RM + 4}" y="${(y + 3).toFixed(1)}" fill="${MUTE}">${v >= 1000 ? Math.round(v).toLocaleString("en-IN") : v.toFixed(2)}</text>`; }
    // candles, volume, day separators, x labels
    let body = "", vols = "", xl = "", sep = "", lastDay = null, lastLabelX = -99;
    view.forEach((k, i) => {
      const x = pos(i), up = k.c >= k.o, col = up ? UP : DN;
      body += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${Y(k.h).toFixed(1)}" y2="${Y(k.l).toFixed(1)}" stroke="${col}"/><rect x="${(x - bw / 2).toFixed(1)}" y="${Y(Math.max(k.o, k.c)).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(Math.abs(Y(k.o) - Y(k.c)), 1).toFixed(1)}" fill="${col}"/>`;
      if (C.vol) vols += `<rect x="${(x - bw / 2).toFixed(1)}" y="${(VB - (k.v / vmax) * (VB - VT)).toFixed(1)}" width="${bw.toFixed(1)}" height="${((k.v / vmax) * (VB - VT)).toFixed(1)}" fill="${col}" opacity=".35"/>`;
      const d = istDay(k.t);
      if (intraday && lastDay != null && d !== lastDay) sep += `<line x1="${(x - slot / 2).toFixed(1)}" x2="${(x - slot / 2).toFixed(1)}" y1="${PT}" y2="${VB}" stroke="#2a2a2e" stroke-dasharray="2 3"/>`;
      lastDay = d;
      if (x - lastLabelX > 62) {
        const t = new Date((k.t + 19800) * 1000);
        const lab = intraday ? (i === 0 || istDay(view[i - 1].t) !== d ? `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}` : hhmm(k.t)) : `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}${parseTf(C.tf).kind === "M" || t.getUTCMonth() === 0 ? ` '${String(t.getUTCFullYear()).slice(2)}` : ""}`;
        xl += `<text x="${x.toFixed(1)}" y="${AX}" text-anchor="middle">${lab}</text>`; lastLabelX = x;
      }
    });
    const lineOf = (arr, col) => { const pts = arr.map((v, i) => (fin(v) ? `${pos(i).toFixed(1)},${Y(v).toFixed(1)}` : null)).filter(Boolean); return pts.length > 1 ? `<path d="M${pts.join("L")}" fill="none" stroke="${col}" stroke-width="1.3" opacity=".9"/>` : ""; };
    // last price tag
    const last = C.cands[C.cands.length - 1], lc = last.c >= last.o ? UP : DN, ly = Y(last.c);
    const tag = `<line x1="${LM}" x2="${W - RM}" y1="${ly.toFixed(1)}" y2="${ly.toFixed(1)}" stroke="${lc}" stroke-dasharray="3 3" opacity=".7"/><rect x="${W - RM}" y="${(ly - 8).toFixed(1)}" width="${RM}" height="16" fill="${lc}"/><text x="${W - RM + 4}" y="${(ly + 4).toFixed(1)}" fill="#000" font-weight="700">${last.c >= 1000 ? Math.round(last.c).toLocaleString("en-IN") : last.c.toFixed(2)}</text>`;
    // selection crosshair
    let cross = "";
    if (C.sel != null && C.sel >= start && C.sel < start + view.length) {
      const k = C.cands[C.sel], x = pos(C.sel - start);
      cross = `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${PT}" y2="${VB}" stroke="#fff" stroke-opacity=".5"/><line x1="${LM}" x2="${W - RM}" y1="${Y(k.c).toFixed(1)}" y2="${Y(k.c).toFixed(1)}" stroke="#fff" stroke-opacity=".25"/>`;
    }
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" id="cm-chart" style="touch-action:pan-y;display:block;user-select:none" font-family="ui-monospace,monospace" font-size="9">
      <g fill="${MUTE}">${g}${xl}</g>${sep}${vols}${body}${lineOf(sm20, ACC)}${lineOf(sm50, "#8aa4d6")}${tag}${cross}
      ${C.loading ? `<text x="${LM + 6}" y="${PT + 14}" fill="${MUTE}">updating…</text>` : ""}</svg>`;
  }

  function readout() {
    if (!C.cands.length) return "";
    const i = C.sel != null && C.sel < C.cands.length ? C.sel : C.cands.length - 1;
    const k = C.cands[i], prev = i > 0 ? C.cands[i - 1].c : k.o, chg = k.c - prev, intraday = parseTf(C.tf).kind === "I";
    const t = `${dayStr(k.t)}${intraday ? ` ${hhmm(k.t)}` : ""}`;
    const cl = chg >= 0 ? "up" : "dn";
    return `<span class="flat">${t}</span> O <b>${px(k.o)}</b> H <b>${px(k.h)}</b> L <b>${px(k.l)}</b> C <b class="${cl}">${px(k.c)}</b> <span class="${cl}">${chg >= 0 ? "+" : ""}${((chg / prev) * 100).toFixed(2)}%</span> · Vol <b>${vol(k.v)}</b>`;
  }

  function draw() {
    if (!C.open || !C.inst) return;
    const q = getQuote(C.inst.seg, C.inst.id) || {};
    const tfs = [...PRESETS.map(String), "D", "W", "M"];
    const html = `
      <div class="cm-head"><button class="cm-x" id="cm-x" aria-label="Back">←</button>
        <div class="cm-t"><b>${esc(C.inst.sym)}</b><small>${esc(C.inst.name || C.inst.seg)}</small></div>
        <div class="cm-px"><b class="${q.chg > 0 ? "up" : q.chg < 0 ? "dn" : ""}">${px(q.ltp ?? C.cands[C.cands.length - 1]?.c)}</b><span class="${q.pct > 0 ? "up" : q.pct < 0 ? "dn" : "flat"}">${fin(q.pct) ? `${q.pct > 0 ? "+" : ""}${q.pct.toFixed(2)}%` : ""}</span></div></div>
      <div class="cm-tf">${tfs.map((t) => `<button data-tf="${t}" class="${t === C.tf ? "on" : ""}">${tfLabel(t)}</button>`).join("")}
        <span class="cm-cu"><input id="cm-custom" type="number" min="1" max="375" inputmode="numeric" placeholder="min" aria-label="Custom minutes"><button data-tf="custom">Set</button></span></div>
      <div class="cm-ro" id="cm-ro">${readout()}</div>
      <div id="cm-svg">${chartSvg()}</div>
      <div class="cm-tools"><button data-z="-1" aria-label="Zoom out">−</button><button data-z="1" aria-label="Zoom in">+</button><button data-z="0">Latest</button>
        <button data-tg="sma20" class="${C.sma20 ? "on" : ""}">SMA 20</button><button data-tg="sma50" class="${C.sma50 ? "on" : ""}">SMA 50</button><button data-tg="vol" class="${C.vol ? "on" : ""}">Volume</button></div>
      <div class="note">${C.err ? esc(C.err) : "Drag to pan, pinch-free zoom with ± buttons (mouse wheel on desktop), tap a candle for its values."}</div>`;
    morph(root(), html);
  }

  function indexAt(clientX) {
    const svg = $("#cm-chart");
    if (!svg || !C.geom) return null;
    const r = svg.getBoundingClientRect(), x = ((clientX - r.left) / r.width) * W;
    const { slot, n, vlen, start } = C.geom;
    const i = Math.floor((x - LM) / slot) - (n - vlen);
    return i >= 0 && i < vlen ? start + i : null;
  }

  function bind() {
    const r = root();
    r.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.id === "cm-x") return close();
      if (b.dataset.tf) {
        let tf = b.dataset.tf;
        if (tf === "custom") { const v = Math.round(+$("#cm-custom").value); if (!(v >= 1 && v <= 375)) return; tf = String(v); }
        if (tf !== C.tf) { C.tf = tf; C.cands = []; C.off = 0; C.sel = null; persist(); load(); }
        return;
      }
      if (b.dataset.z != null) { const z = +b.dataset.z; C.vis = z === 0 ? C.vis : Math.min(Math.max(Math.round(C.vis * (z > 0 ? 0.75 : 1.33)), 15), 400); if (z === 0) { C.off = 0; C.sel = null; } persist(); return draw(); }
      if (b.dataset.tg) { C[b.dataset.tg] = !C[b.dataset.tg]; persist(); draw(); }
    });
    r.addEventListener("wheel", (e) => { if (!e.target.closest("#cm-chart")) return; e.preventDefault(); C.vis = Math.min(Math.max(Math.round(C.vis * (e.deltaY < 0 ? 0.88 : 1.14)), 15), 400); draw(); }, { passive: false });
    r.addEventListener("pointerdown", (e) => { if (e.target.closest("#cm-chart")) C.drag = { x: e.clientX, off: C.off, moved: false }; });
    r.addEventListener("pointermove", (e) => {
      if (!e.target.closest("#cm-chart") && !C.drag) return;
      if (C.drag && e.buttons) {
        const dx = e.clientX - C.drag.x, svg = $("#cm-chart");
        if (Math.abs(dx) > 4) C.drag.moved = true;
        if (svg && C.geom && C.drag.moved) {
          const slotPx = (svg.getBoundingClientRect().width * C.geom.slot) / W;
          C.off = Math.min(Math.max(C.drag.off + Math.round(dx / slotPx), 0), Math.max(C.cands.length - 10, 0));
          draw();
        }
      } else if (e.pointerType === "mouse") { const i = indexAt(e.clientX); if (i != null && i !== C.sel) { C.sel = i; draw(); } }
    });
    const up = (e) => { if (C.drag && !C.drag.moved) { const i = indexAt(e.clientX); if (i != null) { C.sel = i; draw(); } } C.drag = null; };
    r.addEventListener("pointerup", up);
    r.addEventListener("pointercancel", () => { C.drag = null; });
    document.addEventListener("keydown", (e) => { if (C.open && e.key === "Escape") close(); });
    window.addEventListener("popstate", () => { if (C.open) { C.pushed = false; hide(); } });
  }

  function hide() { C.open = false; const r = root(); r.hidden = true; document.body.classList.remove("cm-on"); }
  function close() { if (C.pushed) { C.pushed = false; history.back(); } else hide(); }
  let bound = false;

  return {
    open(inst) {
      if (!bound) { bind(); bound = true; }
      C.inst = { ...inst, instrument: inst.instrument || "EQUITY" };
      C.cands = []; C.off = 0; C.sel = null; C.err = ""; C.open = true; C.fetchedAt = 0;
      root().hidden = false; document.body.classList.add("cm-on");
      if (!C.pushed) { history.pushState({ cm: 1 }, ""); C.pushed = true; }
      draw(); load();
    },
    target: () => (C.open && C.inst ? { seg: C.inst.seg, id: C.inst.id } : null),
    /** Called by the feed each cycle: apply the live price to the last candle and redraw. */
    tick() {
      if (!C.open || !C.inst) return;
      const q = getQuote(C.inst.seg, C.inst.id);
      if (q?.ltp) applyTick(C.cands, C.tf, q.ltp);
      if (Date.now() - C.fetchedAt > refreshMs() && !C.loading) load();
      if (!C.drag) draw();
    },
  };
}
