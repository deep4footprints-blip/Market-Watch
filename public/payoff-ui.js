// Payoff terminal UI. Analysis only: it reads the Dhan option chain and never places or prepares orders.
import { analyze, bsPrice, expiryPnl, impliedVol, legGreeks, legQty, portfolioGreeks, scenarioPnl, suggest } from "./payoff.js";
import { morph } from "./dom.js";
import * as V from "./viz.js";

const UND = {
  nifty50: { name: "Nifty", key: "NIFTY", id: 13, seg: "IDX_I", lot: 65 },
  sensex: { name: "Sensex", key: "SENSEX", id: 51, seg: "IDX_I", lot: 20 },
};
const GREEKS = { delta: ["Delta", 2], theta: ["Theta", 2], gamma: ["Gamma", 4], vega: ["Vega", 2] };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fin = (n) => n != null && Number.isFinite(n);
const num = (n, d = 2) => (fin(n) ? Number(n).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—");
const money = (n) => {
  if (n === Infinity || n === -Infinity) return "Unlimited";
  if (!fin(n)) return "—";
  const a = Math.abs(n), s = n < 0 ? "−" : "+";
  return a >= 1e7 ? `${s}₹${(a / 1e7).toFixed(2)} Cr` : a >= 1e5 ? `${s}₹${(a / 1e5).toFixed(2)} L` : `${s}₹${Math.round(a).toLocaleString("en-IN")}`;
};
const rs = (n) => (fin(n) ? money(Math.abs(n)).replace("+", "").replace("−", "") : "—"); // unsigned rupees
const axisK = (n) => `${n < 0 ? "−" : ""}₹${Math.abs(n) >= 1e5 ? `${(Math.abs(n) / 1e5).toFixed(1)}L` : Math.abs(n) >= 1e3 ? `${(Math.abs(n) / 1e3).toFixed(1)}K` : Math.round(Math.abs(n))}`;
const cls = (n) => (!fin(n) || n === 0 ? "flat" : n > 0 ? "up" : "dn");
const todayIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const tYears = (exp) => {
  const t = exp ? Date.parse(`${exp}T15:30:00+05:30`) : NaN;
  return Number.isFinite(t) ? Math.max((t - Date.now()) / (365 * 864e5), 0) : 0;
};
const dte = (exp) => Math.round((Date.parse(exp) - Date.parse(todayIST())) / 864e5);
const dmon = (exp) => new Date(`${exp}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const toLocalInput = (ms) => (fin(ms) ? new Date(ms + 330 * 60000).toISOString().slice(0, 16) : "");  // IST wall clock
const fromLocalInput = (v) => { const t = Date.parse(`${v}:00+05:30`); return Number.isFinite(t) ? t : null; };
const rid = () => `L${Math.random().toString(36).slice(2, 8)}`;
const legTag = (l) => `${l.side > 0 ? "B" : "S"} ${num(l.strike, 0)} ${l.type}`;

export function createPayoff({ client, LS, getInst, friendly, hasCreds, getQuote = () => null, onSession = () => {} }) {
  const saved = LS.get("pf", {});
  const S = {
    und: UND[saved.und] ? saved.und : "nifty50",
    expiry: saved.expiry || null,
    legs: Array.isArray(saved.legs) ? saved.legs : [],
    sid: saved.sid || null, name: saved.name || null,
    depth: [15, 20, 25, 30, 35, 40].includes(saved.depth) ? saved.depth : 15, // strikes shown each side of ATM
    greekCols: Array.isArray(saved.greekCols) ? saved.greekCols.filter((g) => GREEKS[g]) : ["delta"],
    show: saved.show || { exp: true, t0: true },
    lot: saved.lot || {},
    days: 0, ivShift: 0, move: 0,
    expiries: {}, chain: null, chainAt: 0, busy: false, again: false, msg: "",
    strategies: LS.get("pfSaved", []),
    geom: null, root: null, instLots: null, live: null, scrubbing: false,
    pop: null, menu: null, saving: false, sug: null,
  };
  for (const l of S.legs) l.id ||= rid();
  const ivs = () => S.ivShift / 100; // slider is in vol points, IVs are decimals
  let sessT = null;
  const persist = () => {
    LS.set("pf", { und: S.und, expiry: S.expiry, legs: S.legs, sid: S.sid, name: S.name, depth: S.depth, greekCols: S.greekCols, show: S.show, lot: S.lot });
    if (S.sid && S.legs.length) { clearTimeout(sessT); sessT = setTimeout(() => onSession(S.sid, sessionMeta()), 800); } // definition for history rebuilds
  };
  const sessionMeta = () => ({
    name: S.name || `${UND[S.und].name} ${S.expiry}`, und: UND[S.und].name, undKey: UND[S.und].key, expiry: S.expiry, lot: lotSize(),
    legs: S.legs.map(legTag).join(" · "),
    defs: S.legs.map(({ type, strike, side, lots, entry, exit, tIn, tOut, secId, iv }) => ({ type, strike, side, lots, entry, exit: fin(exit) ? exit : null, tIn: tIn ?? null, tOut: tOut ?? null, secId: secId ?? null, iv: iv ?? null })),
  });
  const lotSize = () => S.lot[S.und] || S.instLots?.[UND[S.und].key] || UND[S.und].lot;
  const $ = (id) => S.root?.querySelector(id);
  const ensureSid = () => { if (!S.sid) S.sid = `s${Date.now().toString(36)}`; };

  // ---------- pricing helpers on top of the chain ----------
  const side = (row, type) => (type === "CE" ? row?.ce : row?.pe);
  function premium(row, type) {
    const o = side(row, type);
    if (!o) return null;
    if (o.ltp > 0) return o.ltp;
    if (o.bid > 0 && o.ask > 0) return (o.bid + o.ask) / 2;
    return null;
  }
  const ivDec = (v) => (v > 0 ? (v > 3 ? v / 100 : v) : null);
  function legIv(row, type, K) {
    const ch = S.chain, o = side(row, type);
    if (ivDec(o?.iv)) return ivDec(o.iv);
    const p = premium(row, type);
    const solved = p && ch ? impliedVol(type, p, ch.spot, K, tYears(S.expiry)) : null;
    return solved || ch?.atmIv || 0.15;
  }
  function priceLeg(type, K) {
    const row = S.chain?.byStrike.get(K);
    const p = premium(row, type);
    return p != null ? p : S.chain ? bsPrice(type, S.chain.spot, K, tYears(S.expiry), S.chain.atmIv || 0.15) : null;
  }
  function syncLegs() {
    if (!S.chain) return;
    for (const l of S.legs) {
      const row = S.chain.byStrike.get(l.strike);
      l.iv = legIv(row, l.type, l.strike);
      l.secId = side(row, l.type)?.secId ?? l.secId ?? null; // contract id: lets history be rebuilt from Dhan candles
      if (l.entry == null) l.entry = priceLeg(l.type, l.strike);
    }
    persist();
  }
  const mkLeg = (type, K, sd, lots, entry) => ({ id: rid(), type, strike: K, side: sd, lots, entry: entry ?? priceLeg(type, K), iv: legIv(S.chain?.byStrike.get(K), type, K), exit: null, tIn: Date.now(), tOut: null, secId: side(S.chain?.byStrike.get(K), type)?.secId ?? null });

  function ctx() {
    const ch = S.chain;
    if (!ch || !fin(ch.spot)) return null;
    const spot = S.live && Date.now() - S.live.t < 5000 ? S.live.v : ch.spot; // 1 s index quote beats the 3 s chain spot
    const Tn = tYears(S.expiry), lot = lotSize();
    const all = S.legs.filter((l) => fin(l.entry) && fin(l.iv));
    const exited = all.filter((l) => fin(l.exit)), legs = all.filter((l) => !fin(l.exit));
    // Exited legs: realised = (exit - entry) x qty.  Open legs: (LTP - entry) x qty (model price if the strike has no traded price).
    const realized = exited.reduce((a, l) => a + legQty(l, lot) * (l.exit - l.entry), 0);
    let mark = 0;
    for (const l of legs) { const p = premium(ch.byStrike.get(l.strike), l.type); mark += legQty(l, lot) * ((p != null ? p : bsPrice(l.type, spot, l.strike, Tn, l.iv)) - l.entry); }
    return { ch, spot, Tn, Ts: Math.max(Tn - S.days / 365, 0), lot, all, legs, exited, realized, mark, total: realized + mark, scn: spot * (1 + S.move / 100), atmIv: ch.atmIv || (legs.length ? legs.reduce((a, l) => a + l.iv, 0) / legs.length : 0.15) };
  }

  // ---------- loading ----------
  async function ensureExpiries() {
    const c = S.expiries[S.und];
    if (c && Date.now() - c.t < 6 * 3600e3) return c.list;
    const u = UND[S.und];
    const all = await client.expiryList(u.id, u.seg);
    const list = all.filter((e) => e >= todayIST());
    S.expiries[S.und] = { t: Date.now(), list };
    return list;
  }

  async function load() {
    if (S.busy) { S.again = true; return; }
    if (!hasCreds()) { S.msg = "Add your Dhan client id + token in Settings (⚙)."; renderAll(); return; }
    S.busy = true;
    try {
      do {
        S.again = false;
        if (!S.instLots) { try { S.instLots = (await getInst())?.lots || {}; } catch { S.instLots = {}; } }
        const u = UND[S.und], und0 = S.und;
        const list = await ensureExpiries();
        if (!list.length) throw Object.assign(new Error("No live expiries returned by Dhan"), { code: "NO_EXPIRY" });
        if (!list.includes(S.expiry)) S.expiry = list[0];
        const exp0 = S.expiry;
        const chain = await client.optionChain(u.id, u.seg, exp0);
        if (und0 !== S.und || exp0 !== S.expiry) { S.again = true; continue; }
        S.chain = chain; S.chainAt = Date.now();
        S.msg = chain.rows.length ? "" : "Dhan returned an empty option chain (market closed or no data on this plan).";
        syncLegs();
      } while (S.again);
    } catch (e) {
      S.msg = e instanceof TypeError ? "Could not reach Dhan (offline or blocked)." : friendly(e);
    } finally { S.busy = false; }
    renderAll(true);
  }

  // ---------- leg operations ----------
  function addLeg(type, K, sd, lots = 1) {
    if (!S.chain) return;
    ensureSid();
    S.legs.push(mkLeg(type, K, sd, lots));
    S.sug = null; persist(); renderLegs(); renderResults();
  }
  function moveStrike(i, dir) {
    const l = S.legs[i], ch = S.chain;
    if (!l || !ch) return;
    const idx = ch.strikes.indexOf(l.strike) + dir;
    if (idx < 0 || idx >= ch.strikes.length) return;
    l.strike = ch.strikes[idx];
    l.entry = priceLeg(l.type, l.strike);
    l.iv = legIv(ch.byStrike.get(l.strike), l.type, l.strike);
    S.sug = null; persist(); renderLegs(); renderResults();
  }
  function setExit(l, raw) {
    const v = parseFloat(raw), had = fin(l.exit);
    l.exit = String(raw).trim() === "" ? null : fin(v) && v >= 0 ? v : l.exit; // empty = leg still open
    if (fin(l.exit) && !had) l.tOut = Date.now();
    if (!fin(l.exit)) l.tOut = null;
  }

  // ---------- rendering: header ----------
  function renderTop() {
    const list = S.expiries[S.und]?.list || (S.expiry ? [S.expiry] : []);
    const ch = S.chain;
    $("#pf-und").innerHTML = Object.entries(UND).map(([k, u]) => `<button data-u="${k}" class="${k === S.und ? "on" : ""}">${u.name}</button>`).join("");
    $("#pf-chips").innerHTML = list.slice(0, 12).map((e) => `<button class="xc ${e === S.expiry ? "on" : ""}" data-exp="${e}"><b>${dmon(e)}</b><small>${dte(e)} DTE</small></button>`).join("");
    renderSpot();
    $("#pf-msg").textContent = S.msg || (S.busy && !ch ? "Loading option chain…" : "");
    $("#pf-msg").hidden = !$("#pf-msg").textContent;
    const setVal = (sel, v) => { const el = $(sel); if (el && document.activeElement !== el) el.value = String(v); };
    setVal("#pf-lot", lotSize());
    const maxDays = Math.floor(tYears(S.expiry) * 365);
    $("#pf-days").max = String(Math.max(maxDays, 0));
    $("#pf-days").disabled = maxDays < 1;
    S.days = Number.isFinite(S.days) ? Math.min(S.days, Math.max(maxDays, 0)) : 0;
    setVal("#pf-days", S.days);
    setVal("#pf-ivs", S.ivShift);
    setVal("#pf-mv", S.move);
    renderMenus();
    renderSliderLabels();
  }
  function renderSpot() {
    const c = ctx(), u = UND[S.und], el = $("#pf-spot");
    if (!el) return;
    el.dataset.c = [u.seg, u.id, "INDEX", u.name, u.name].join("|");
    el.innerHTML = c ? `<span class="pill sp">Spot <b>${num(c.spot, 0)}</b></span><small class="flat">${S.expiry ? `${(c.Tn * 365).toFixed(1)}d to expiry` : ""}${c.ch.atmIv ? ` · ATM IV ${(c.ch.atmIv * 100).toFixed(1)}%` : ""} · tap for chart</small>` : "";
  }
  function renderSliderLabels() {
    const c = ctx(), left = Math.max(Math.round(tYears(S.expiry) * 365) - S.days, 0);
    $("#v-days").innerHTML = S.days === 0 ? `<b>Today</b> · ${dte(S.expiry || todayIST())} DTE (IST)` : `<b>+${S.days}d</b> · ${Math.max(dte(S.expiry) - S.days, 0)} DTE`;
    $("#v-iv").textContent = `${S.ivShift > 0 ? "+" : ""}${S.ivShift} pts`;
    $("#v-mv").textContent = `${S.move > 0 ? "+" : ""}${S.move.toFixed(1)}%${c ? ` → ${num(c.scn, 0)}` : ""}`;
    S.root?.querySelectorAll("[data-show]").forEach((b) => b.classList.toggle("on", !!S.show[b.dataset.show]));
    void left;
  }
  function renderMenus() {
    const pm = $("#pf-pfmenu"), gm = $("#pf-gkmenu");
    if (!pm || !gm) return;
    pm.hidden = S.menu !== "pf";
    gm.hidden = S.menu !== "gk";
    $("#pf-pfbtn").classList.toggle("on", S.menu === "pf");
    $("#pf-gkbtn").classList.toggle("on", S.menu === "gk");
    $("#pf-gkn").textContent = String(S.greekCols.length);
    pm.innerHTML = S.strategies.length
      ? S.strategies.map((s, i) => `<div class="ddi"><button class="ddl" data-ld="${i}"><b>${esc(s.name)}</b><small>${esc(UND[s.und]?.name || "")} · ${esc(s.expiry)} · ${s.legs.length} legs</small></button><button class="x-btn" data-dl="${i}" aria-label="Delete saved strategy">✕</button></div>`).join("")
      : `<div class="ddn">No saved portfolios yet — add legs and hit Save in the positions panel.</div>`;
    gm.innerHTML = Object.entries(GREEKS).map(([k, [n]]) => `<button class="ddc ${S.greekCols.includes(k) ? "on" : ""}" data-gk="${k}">${n}<i>${S.greekCols.includes(k) ? "✓" : ""}</i></button>`).join("");
  }

  // ---------- rendering: positions ----------
  function renderLegs() {
    const box = $("#pf-legs");
    $("#pf-npos").textContent = String(S.legs.length);
    if (!S.legs.length) { box.innerHTML = `<div class="empty">No positions yet. Tap <b>B</b> or <b>S</b> next to a strike in the option chain below.</div>`; renderOrders(); return; }
    box.innerHTML = S.legs.map((l, i) => `<div class="leg ${fin(l.exit) ? "done" : ""}" data-i="${i}">
      <div class="lh">
        <button class="bs ${l.side > 0 ? "b" : "s"}" data-a="flip" aria-label="Flip buy/sell">${l.side > 0 ? "Buy" : "Sell"}</button>
        <b class="ty">${l.type}</b>
        <span class="st"><button data-a="k-" aria-label="Lower strike">−</button><span>${num(l.strike, 0)}</span><button data-a="k+" aria-label="Higher strike">+</button></span>
        <span class="st"><button data-a="l-" aria-label="Fewer lots">−</button><span>${l.lots}</span><button data-a="l+" aria-label="More lots">+</button></span>
        <button class="x-btn" data-a="rm" aria-label="Remove leg">✕</button>
      </div>
      <div class="px2">
        <label>Entry<input class="en" data-a="entry" type="number" step="0.05" inputmode="decimal" value="${fin(l.entry) ? +l.entry.toFixed(2) : ""}" placeholder="Entry"></label>
        <label>Exit<input class="en ex" data-a="exit" type="number" step="0.05" inputmode="decimal" value="${fin(l.exit) ? +l.exit.toFixed(2) : ""}" placeholder="Open"></label>
      </div>
      <div class="lg"></div></div>`).join("");
    renderOrders();
  }

  function updateLegCells(c) {
    S.root?.querySelectorAll(".leg").forEach((el) => {
      const l = S.legs[+el.dataset.i], cell = el.querySelector(".lg");
      if (!l || !cell) return;
      el.classList.toggle("done", fin(l.exit));
      if (!c || !fin(l.entry) || !fin(l.iv)) { cell.textContent = "—"; return; }
      const q = legQty(l, c.lot);
      if (fin(l.exit)) {
        const real = q * (l.exit - l.entry);
        cell.innerHTML = `<b class="tagx">EXITED</b> ${num(l.entry)} → ${num(l.exit)} · realised (exit − entry) <b class="${cls(real)}">${money(real)}</b>`;
        return;
      }
      const row = c.ch.byStrike.get(l.strike);
      const p = premium(row, l.type), ltp = p != null ? p : bsPrice(l.type, c.spot, l.strike, c.Tn, l.iv);
      const g = legGreeks(l, c.lot, c.spot, c.Tn, 0);
      const open = q * (ltp - l.entry);
      cell.innerHTML = `LTP <b>${num(ltp)}</b> · IV <b>${(l.iv * 100).toFixed(1)}%</b> · Delta <b>${num(g.delta, 1)}</b> · Theta <b class="${cls(g.theta)}">${num(g.theta, 0)}</b> · Vega <b class="${cls(g.vega)}">${num(g.vega, 0)}</b><br>P&amp;L (LTP − entry) <b class="${cls(open)}">${money(open)}</b>`;
    });
  }

  // ---------- order log (entry/exit timestamps, editable) ----------
  function ordersHtml() {
    const ev = [];
    for (const l of S.legs) {
      const nm = `${l.lots}×${num(l.strike, 0)} ${l.type}`;
      ev.push({ id: l.id, kind: "ENTRY", t: l.tIn, sd: l.side, text: nm, px: l.entry });
      if (fin(l.exit)) ev.push({ id: l.id, kind: "EXIT", t: l.tOut, sd: -l.side, text: `${nm} · close`, px: l.exit });
    }
    if (!ev.length) return `<div class="note">Orders you add or close are time-stamped here. You can correct the date/time or delete an order.</div>`;
    ev.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
    return ev.map((e) => `<div class="ord" data-leg="${e.id}" data-kind="${e.kind}">
      <span class="tg ${e.sd > 0 ? "b" : "s"}">${e.sd > 0 ? "BUY" : "SELL"}</span>
      <span class="ot">${esc(e.text)}<small>@ ${num(e.px)} · ${e.kind === "ENTRY" ? "entry" : "exit"}</small></span>
      <input type="datetime-local" step="60" data-a="otime" value="${toLocalInput(e.t)}" aria-label="Order date and time (IST)">
      <button class="x-btn" data-a="odel" aria-label="Delete this order">✕</button></div>`).join("");
  }
  function renderOrders() { const el = $("#pf-orders"); if (el) morph(el, ordersHtml()); }

  // ---------- chart ----------
  function chartHtml(c, an) {
    if (!c.all.length) return `<div class="empty big"><b>Tap B / S on a strike to add a leg</b><br>The curve above zero is profit, below is loss. The blue line shows the position valued before expiry (time value included).</div>`;
    if (!c.legs.length) return `<div class="empty">All legs are exited. Realised P&amp;L <b class="${cls(c.realized)}">${money(c.realized)}</b>. Clear an exit price to reopen a leg.</div>`;
    const W = 360, H = 270, Lm = 52, Rm = 10, Tm = 10, Bm = 22;
    const sd = an?.sd || c.spot * 0.01;
    const ks = c.legs.map((l) => l.strike);
    const lo = Math.max(Math.min(c.spot - 2.5 * sd, ...ks.map((k) => k - sd)), c.spot * 0.5);
    const hi = Math.max(c.spot + 2.5 * sd, ...ks.map((k) => k + sd));
    const N = 160, xs = Array.from({ length: N + 1 }, (_, i) => lo + ((hi - lo) * i) / N);
    const ye = xs.map((x) => expiryPnl(c.legs, c.lot, x) + c.realized);
    const ys = xs.map((x) => scenarioPnl(c.legs, c.lot, x, c.Ts, ivs()) + c.realized);
    let mn = Math.min(0, ...ye, ...ys), mx = Math.max(0, ...ye, ...ys);
    const pad = (mx - mn || 1) * 0.08; mn -= pad; mx += pad;
    const X = (v) => Lm + ((v - lo) / (hi - lo)) * (W - Lm - Rm);
    const Y = (v) => Tm + ((mx - v) / (mx - mn)) * (H - Tm - Bm);
    const y0 = Y(0), f1 = (n) => n.toFixed(1);
    const line = (arr) => arr.map((v, i) => `${i ? "L" : "M"}${f1(X(xs[i]))},${f1(Y(v))}`).join("");
    const area = `${line(ye)}L${f1(X(hi))},${f1(y0)}L${f1(X(lo))},${f1(y0)}Z`;
    S.geom = { lo, hi, W, Lm, Rm };
    const yv = Array.from({ length: 5 }, (_, i) => mn + pad + ((mx - mn - 2 * pad) * i) / 4);
    const grid = yv.map((v) => `<line x1="${Lm}" x2="${W - Rm}" y1="${f1(Y(v))}" y2="${f1(Y(v))}" stroke="#16161a"/><text x="${Lm - 5}" y="${f1(Y(v) + 3)}" text-anchor="end">${axisK(v)}</text>`).join("");
    const xt = [0, 0.25, 0.5, 0.75, 1].map((f) => { const v = lo + (hi - lo) * f; return `<line x1="${f1(X(v))}" x2="${f1(X(v))}" y1="${Tm}" y2="${H - Bm}" stroke="#16161a"/><text x="${f1(X(v))}" y="${H - 6}" text-anchor="${f === 0 ? "start" : f === 1 ? "end" : "middle"}">${num(v, 0)}</text>`; }).join("");
    const vl = (x, label, col, dash) => `<line x1="${f1(X(x))}" x2="${f1(X(x))}" y1="${Tm}" y2="${H - Bm}" stroke="${col}" stroke-dasharray="${dash}" stroke-width="1"/><text transform="translate(${f1(X(x) + 4)},${Tm + 4}) rotate(90)" font-size="9" fill="${col}" text-anchor="start">${label}</text>`;
    const bes = (an?.breakevens || []).filter((b) => b > lo && b < hi).map((b) => vl(b, `BE ${num(b, 0)}`, "#a8a8b0", "1 3")).join("");
    const spotL = vl(clamp(c.spot, lo, hi), `Spot ${num(c.spot, 0)}`, "#ffa726", "4 3");
    const exp = S.show.exp ? `<path d="${line(ye)}" fill="none" stroke="#2ecc8f" stroke-width="2.2" clip-path="url(#cu)"/><path d="${line(ye)}" fill="none" stroke="#ff5c5c" stroke-width="2.2" clip-path="url(#cd)"/>` : "";
    const t0 = S.show.t0 ? `<path d="${line(ys)}" fill="none" stroke="#4f8cff" stroke-width="2"/>` : "";
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Payoff chart" style="touch-action:pan-y;display:block">
      <defs><clipPath id="cu"><rect x="0" y="0" width="${W}" height="${f1(y0)}"/></clipPath><clipPath id="cd"><rect x="0" y="${f1(y0)}" width="${W}" height="${H}"/></clipPath></defs>
      <g font-size="9" fill="#8a8a90" font-family="ui-monospace,monospace">${grid}${xt}</g>
      <path d="${area}" fill="#2ecc8f" opacity=".10" clip-path="url(#cu)"/><path d="${area}" fill="#ff5c5c" opacity=".22" clip-path="url(#cd)"/>
      <line x1="${Lm}" x2="${W - Rm}" y1="${f1(y0)}" y2="${f1(y0)}" stroke="#4a4a52"/>
      <g font-family="ui-monospace,monospace">${bes}${spotL}</g>
      ${exp}${t0}
      ${S.move ? `<line x1="${f1(X(clamp(c.scn, lo, hi)))}" x2="${f1(X(clamp(c.scn, lo, hi)))}" y1="${Tm}" y2="${H - Bm}" stroke="#d9c9a3" stroke-width="1"/>` : ""}
      <line id="pf-xl" x1="0" x2="0" y1="${Tm}" y2="${H - Bm}" stroke="#fff" stroke-width=".8" opacity="0"/>
    </svg>`;
  }

  // ---------- stats grid (Quintal-style two-column label/value) ----------
  function kvHtml(c, an) {
    const g = c.legs.length ? portfolioGreeks(c.legs, c.lot, c.spot, c.Tn, 0) : { delta: 0, gamma: 0, theta: 0, vega: 0 };
    const decay = c.legs.length && c.Tn > 0 ? scenarioPnl(c.legs, c.lot, c.spot, Math.max(c.Tn - 1 / 365, 0), 0) - scenarioPnl(c.legs, c.lot, c.spot, c.Tn, 0) : 0;
    const it = (l, v, k = "", sub = "") => `<div class="kvi"><span class="kl">${l}</span><b class="kvv ${k}">${v}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
    const net = an?.netPremium;
    return `<div class="kvg">
      ${it("Max profit", an ? (an.unlimitedProfit ? "Unlimited" : money(an.maxProfit)) : "—", "up")}
      ${it("Max loss", an ? (an.unlimitedLoss ? "Unlimited" : money(an.maxLoss)) : "—", "dn")}
      ${it("Breakevens", an?.breakevens.length ? an.breakevens.map((b) => num(b, 0)).join(" / ") : "—")}
      ${it("Net premium", fin(net) ? `${rs(net)} (${net >= 0 ? "credit" : "debit"})` : "—", net >= 0 ? "up" : "dn")}
      ${it("P&amp;L live", c.all.length ? money(c.total) : "—", cls(c.total), c.exited.length ? `realised ${money(c.realized)} · open ${money(c.mark)}` : "")}
      ${it("Prob. of profit", an && fin(an.pop) ? `${(an.pop * 100).toFixed(0)}%` : "—")}
      ${it("Lot size", c.lot)}
      ${it("Delta units", num(g.delta, 2), cls(g.delta))}
      ${it("Gamma Δ/pt", num(g.gamma, 4), cls(g.gamma))}
      ${it("Theta ₹/day", money(g.theta), cls(g.theta))}
      ${it("Decay next day", money(decay), cls(decay))}
      ${it("Vega ₹/1% IV", money(g.vega), cls(g.vega))}
    </div>`;
  }

  // ---------- outcome infographics (probability, profit zone, reward vs risk) ----------
  function statsHtml(c, an) {
    if (!an) return "";
    const rr = fin(an.maxProfit) && fin(an.maxLoss) && an.maxLoss < 0 ? `${(an.maxProfit / -an.maxLoss).toFixed(2)} : 1` : "—";
    const pe = expiryPnl(c.legs, c.lot, c.scn) + c.realized, ps = scenarioPnl(c.legs, c.lot, c.scn, c.Ts, ivs()) + c.realized;
    const sd = an.sd || c.spot * 0.01, lo = c.spot - 2.5 * sd, hi = c.spot + 2.5 * sd;
    const samples = Array.from({ length: 64 }, (_, i) => expiryPnl(c.legs, c.lot, lo + ((hi - lo) * (i + 0.5)) / 64) + c.realized);
    const popCol = !fin(an.pop) ? V.C.mute : an.pop >= 0.5 ? V.C.up : an.pop >= 0.3 ? V.C.acc : V.C.dn;
    const rrBar = fin(an.maxProfit) && fin(an.maxLoss) && an.maxLoss < 0
      ? `${V.stack([{ v: an.maxProfit, color: V.C.up, label: "Max profit" }, { v: -an.maxLoss, color: V.C.dn, label: "Max loss" }])}<div class="rl"><span class="up">${money(an.maxProfit)}</span><span>reward : risk ${rr}</span><span class="dn">${money(an.maxLoss)}</span></div>`
      : `<div class="rl"><span class="up">${an.unlimitedProfit ? "Unlimited profit" : money(an.maxProfit)}</span><span></span><span class="dn">${an.unlimitedLoss ? "Unlimited loss" : money(an.maxLoss)}</span></div>`;
    return `<div class="card vrow">${V.gauge(an.pop, { label: fin(an.pop) ? `${(an.pop * 100).toFixed(0)}%` : "—", sub: "probability of profit", color: popCol })}
      <div class="vcol"><div class="n">Profit zone at expiry (±2.5σ)</div>${V.zoneStrip(samples, 0.5)}<div class="rl"><span>${num(lo, 0)}</span><span>spot ${num(c.spot, 0)}</span><span>${num(hi, 0)}</span></div>
      <div class="n" style="margin-top:12px">Reward vs risk</div>${rrBar}</div></div>
      <div class="note">At ${num(c.scn, 0)}: expiry <b class="${cls(pe)}">${money(pe)}</b> · ${S.days ? `T+${S.days}d` : "today"} <b class="${cls(ps)}">${money(ps)}</b>. Expected P&amp;L <b class="${cls(an.expected)}">${money(an.expected)}</b>. POP and expected P&amp;L are model values (lognormal at ATM IV, risk-neutral), not forecasts; realised P&amp;L of exited legs is included.</div>`;
  }

  // ---------- portfolio greeks in plain English + stress table ----------
  function greeksHtml(c) {
    if (!c.legs.length) return `<div class="empty">Add an open position to see its risk in plain English.</div>`;
    const L = c.legs, now = (s, T, iv = 0) => scenarioPnl(L, c.lot, s, T, iv);
    const g = portfolioGreeks(L, c.lot, c.spot, c.Tn, 0);
    const base = now(c.spot, c.Tn);
    const up1 = now(c.spot * 1.01, c.Tn) - base, dn1 = now(c.spot * 0.99, c.Tn) - base;
    const day = c.Tn > 0 ? now(c.spot, Math.max(c.Tn - 1 / 365, 0)) - base : 0;
    const v1 = now(c.spot, c.Tn, 0.01) - base, v5 = now(c.spot, c.Tn, 0.05) - base;
    const pts = c.spot * 0.01;
    const lots = g.delta / c.lot;
    const posture = g.theta > 0 && g.vega < 0 && g.gamma < 0 ? ["Range-bound seller", "Earns from time passing while the index stays near its current level. Hurt by a sharp move in either direction or a jump in volatility."]
      : g.theta < 0 && g.vega > 0 && g.gamma > 0 ? ["Move buyer", "Pays time decay every day. Needs a big move (or a rise in volatility) to pay off."]
      : Math.abs(g.delta) > 0.5 * Math.max(...L.map((l) => Math.abs(legQty(l, c.lot)))) ? [g.delta > 0 ? "Bullish tilt" : "Bearish tilt", `Net exposure behaves like ${g.delta > 0 ? "long" : "short"} ${num(Math.abs(lots), 1)} lot(s) of ${UND[S.und].name} futures, plus option effects below.`]
      : ["Mixed / balanced", "No single greek dominates; read the four cards below."];
    const box = (ico, title, big, bigCls, txt, raw) => `<div class="gx"><div class="gt"><i>${ico}</i>${title}</div><div class="gb ${bigCls}">${big}</div><div class="gs">${txt}</div><small>${raw}</small></div>`;
    const dir = box("↕", "If the index moves", `${money(up1)} / ${money(dn1)}`, "", `For a <b>+1%</b> / <b>−1%</b> move (≈ ${num(pts, 0)} pts). You are net ${g.delta >= 0 ? "long" : "short"} ≈ <b>${num(Math.abs(lots), 1)} lot(s)</b> of futures.`, `Delta ${num(g.delta, 1)} index units`);
    const gam = box("⤢", "If the move accelerates", g.gamma < 0 ? "Short gamma" : "Long gamma", g.gamma < 0 ? "dn" : "up",
      g.gamma < 0 ? `Every 100 pts the index moves, your delta shifts by <b>${num(g.gamma * 100, 1)}</b> against you, so losses speed up on big moves.` : `Every 100 pts the index moves, your delta shifts by <b>+${num(g.gamma * 100, 1)}</b> in your favour, so gains speed up on big moves.`, `Gamma ${num(g.gamma, 4)} per point`);
    const the = box("⏱", "Time passing", `${money(day)} / day`, cls(day), day >= 0 ? `You <b>earn</b> about ${rs(day)} by tomorrow if nothing else changes.` : `You <b>lose</b> about ${rs(day)} by tomorrow if nothing else changes.`, `Theta ${money(g.theta)} per calendar day (instant)`);
    const veg = box("≋", "Volatility (IV)", `${money(v1)} per +1 pt`, cls(v1), v1 >= 0 ? `A rise in implied volatility <b>helps</b>: +5 pts ≈ ${money(v5)}.` : `A rise in implied volatility <b>hurts</b>: +5 pts ≈ ${money(v5)}; a fall helps.`, `Vega ${money(g.vega)} per vol point`);
    // stress table
    const moves = [-3, -2, -1, 0, 1, 2, 3], cols = [["Today", c.Tn, 0], ["+1 day", Math.max(c.Tn - 1 / 365, 0), 0], ["IV −3", c.Tn, -0.03], ["IV +3", c.Tn, 0.03]];
    const grid = moves.map((m) => cols.map(([, T, iv]) => c.realized + now(c.spot * (1 + m / 100), T, iv)));
    const peak = Math.max(1, ...grid.flat().map(Math.abs));
    const cell = (v) => `<td style="background:${v >= 0 ? `rgba(46,204,143,${(0.08 + 0.42 * Math.abs(v) / peak).toFixed(2)})` : `rgba(255,92,92,${(0.08 + 0.42 * Math.abs(v) / peak).toFixed(2)})`}">${money(v)}</td>`;
    const tbl = `<table class="stress"><thead><tr><th>Index</th>${cols.map((x) => `<th>${x[0]}</th>`).join("")}</tr></thead><tbody>${moves.map((m, i) => `<tr class="${m === 0 ? "mid" : ""}"><th>${m > 0 ? "+" : ""}${m}%<small>${num(c.spot * (1 + m / 100), 0)}</small></th>${grid[i].map(cell).join("")}</tr>`).join("")}</tbody></table>`;
    return `<div class="card posture"><div class="n">Your position is a</div><div class="pv">${posture[0]}</div><div class="note">${posture[1]}</div></div>
      <div class="gxg">${dir}${gam}${the}${veg}</div>
      <div class="n" style="margin:14px 0 6px">Stress test: total P&amp;L (realised + open) if the market shifts</div>${tbl}
      <div class="note">Each cell re-prices every open leg with Black-Scholes at that index level, time and IV shift (IVs move in parallel). Greeks and the table use live prices; the chart's what-if sliders do not change them.</div>`;
  }

  // ---------- next-step optimizer ----------
  function chainQuotes() {
    const out = [];
    for (const r of S.chain?.rows || []) for (const t of ["CE", "PE"]) {
      const p = premium(r, t), o = side(r, t);
      if (p != null) out.push({ type: t, strike: r.strike, price: p, iv: ivDec(o?.iv), oi: o?.oi });
    }
    return out;
  }
  function computeSug(c) {
    if (!c.legs.length || c.Tn <= 0) return null;
    const key = `${S.chainAt}|${S.legs.map((l) => `${l.id}${l.strike}${l.side}${l.lots}${l.entry}${l.exit}`).join(",")}|${Math.round(c.realized)}`;
    if (S.sug?.key === key) return S.sug;
    const r = suggest(c.legs, c.lot, { spot: c.spot, T: c.Tn, atmIv: c.atmIv, realized: c.realized, quotes: chainQuotes() });
    return (S.sug = { key, open: c.legs, r });
  }
  const stepTxt = (s) => `<b class="${s.action === "BUY" ? "up" : "dn"}">${s.action}</b> ${s.lots}×${num(s.strike, 0)} ${s.type} @ ${num(s.price)}`;
  function whyRows(c, base, cand) {
    const gA = portfolioGreeks(cand.legsAfter, c.lot, c.spot, c.Tn, 0), gB = base.g, ex = cand.exact, eb = base.exact;
    const row = (l, a, b, k = "") => `<div class="why"><span>${l}</span><b>${a}</b><i>→</i><b class="${k}">${b}</b></div>`;
    return row("Worst 5% of outcomes", money(base.ES), money(cand.after.ES), cls(cand.after.ES - base.ES))
      + row("Max loss", eb.unlimitedLoss ? "Unlimited" : money(eb.maxLoss), ex.unlimitedLoss ? "Unlimited" : money(ex.maxLoss), (ex.unlimitedLoss ? -Infinity : ex.maxLoss) >= (eb.unlimitedLoss ? -Infinity : eb.maxLoss) ? "up" : "dn")
      + row("Probability of profit", fin(eb.pop) ? `${(eb.pop * 100).toFixed(0)}%` : "—", fin(ex.pop) ? `${(ex.pop * 100).toFixed(0)}%` : "—", ex.pop >= eb.pop ? "up" : "dn")
      + row("Expected P&amp;L (model)", money(base.E), money(cand.after.E), cls(cand.after.E - base.E))
      + row("Net delta (units)", num(gB.delta, 1), num(gA.delta, 1), Math.abs(gA.delta) <= Math.abs(gB.delta) ? "up" : "dn")
      + row("Theta ₹/day", money(gB.theta), money(gA.theta), cls(gA.theta - gB.theta));
  }
  function sugHtml(c) {
    const s = computeSug(c);
    if (!s) return `<div class="empty">${c.legs.length ? "Expiry reached: nothing left to optimise." : "Add an open position to get a suggestion."}</div>`;
    const { r, open } = s;
    if (!r) return `<div class="empty">Not enough data to evaluate adjustments.</div>`;
    const legs = r.legs.map((v) => `<span class="lv ${v.verdict.toLowerCase()}">${esc(legTag(open[v.i]))} · ${v.verdict}</span>`).join("");
    const items = [r.best, ...r.alts].filter(Boolean);
    s.items = items;
    const lead = r.best
      ? `<div class="sg-top"><span class="pill adj">ADJUST</span><div class="sg-main">${r.best.steps.map(stepTxt).join(" <i>then</i> ")}</div></div>
         <div class="sg-why">${whyRows(c, r.base, r.best)}</div>
         <div class="sg-act"><button class="btn" data-apply="0">Apply to strategy</button><span class="note">Score +${rs(r.best.dU)} · ${r.best.kind === "ADD" ? "new leg" : r.best.kind === "EXIT" ? "close a leg" : "roll a leg"}</span></div>`
      : `<div class="sg-top"><span class="pill hold">HOLD</span><div class="sg-main">None of the ${r.tested} adjustments tested improves the risk-adjusted score materially.</div></div>`;
    const alts = r.alts.length ? `<div class="n" style="margin-top:12px">Other options</div>${r.alts.map((a, i) => `<div class="alt"><div>${a.steps.map(stepTxt).join(" <i>then</i> ")}<small>worst 5%: ${money(r.base.ES)} → ${money(a.after.ES)} · score +${rs(a.dU)}</small></div><button class="chip" data-apply="${i + 1}">Apply</button></div>`).join("")}` : "";
    return `<div class="card sg">${lead}${alts}
      <div class="n" style="margin-top:12px">Leg by leg</div><div class="lvs">${legs}</div></div>
      <div class="note">Method: ${r.tested} single adjustments (close a leg, add a leg, roll a leg to another strike) priced off the live chain, ranked by score = expected P&amp;L + 0.5 × the average of the worst 5% of outcomes, on a lognormal at ATM IV. Orders cost ₹0.5/unit slippage. A ranking of shapes under a model, not a forecast or advice; margin and your view of the market are not considered. Apply only edits this simulator.</div>`;
  }
  function applySuggestion(idx) {
    const s = S.sug, cand = s?.items?.[idx];
    if (!cand) return;
    const now = Date.now();
    ensureSid();
    for (const st of cand.steps) {
      const closing = s.open.find((l) => l.type === st.type && l.strike === st.strike && l.side === (st.action === "BUY" ? -1 : 1) && !fin(l.exit));
      if (closing && (cand.kind === "EXIT" || cand.kind === "ROLL") && cand.steps.indexOf(st) === 0) { closing.exit = st.price; closing.tOut = now; }
      else S.legs.push(mkLeg(st.type, st.strike, st.action === "BUY" ? 1 : -1, st.lots, st.price));
    }
    S.sug = null; persist(); renderLegs(); renderResults();
  }

  // ---------- option chain ----------
  function chainHtml() {
    const ch = S.chain;
    if (!ch?.rows.length) return `<div class="empty">No chain loaded.</div>`;
    const i0 = Math.max(ch.strikes.indexOf(ch.atm), 0);
    const rows = ch.rows.slice(Math.max(i0 - S.depth, 0), i0 + S.depth + 1);
    const maxAvail = Math.min(i0, ch.rows.length - 1 - i0);
    const mx = Math.max(1, ...rows.map((r) => Math.max(r.ce?.oi || 0, r.pe?.oi || 0)));
    const gc = S.greekCols;
    const bs = (t, K) => `<td class="bsb"><button class="bb" data-pop="${t}:${K}:1" aria-label="Buy ${K} ${t}">B</button><button class="sb" data-pop="${t}:${K}:-1" aria-label="Sell ${K} ${t}">S</button></td>`;
    const gk = (o) => gc.map((g) => `<td class="gk">${fin(o?.[g]) ? num(o[g], GREEKS[g][1]) : "—"}</td>`).join("");
    const px = (r, t) => { const o = side(r, t), p = premium(r, t), v = ivDec(o?.iv); return `<td class="px"><b>${p != null ? num(p) : "—"}</b><small>${v ? `${(v * 100).toFixed(1)}%` : ""}</small></td>`; };
    const more = S.depth < 40 && S.depth < maxAvail, less = S.depth > 15;
    const ctl = `<div class="occtl"><span class="note">±${Math.min(S.depth, maxAvail)} strikes around ATM</span>
      ${less ? `<button class="chip" data-depth="-5">Show less</button>` : ""}${more ? `<button class="chip" data-depth="5">+5 each side</button><button class="chip" data-depth="40">Max ±${Math.min(40, maxAvail)}</button>` : ""}</div>`;
    const head = `<tr><th></th>${gc.map((g) => `<th>${GREEKS[g][0]}</th>`).join("")}<th>Call LTP</th><th>Strike</th><th>Put LTP</th>${gc.map((g) => `<th>${GREEKS[g][0]}</th>`).join("")}<th></th></tr>`;
    return `${ctl}<div class="ocs"><table class="oc"><thead>${head}</thead><tbody>${rows.map((r) => {
      const atm = r.strike === ch.atm;
      return `<tr class="${atm ? "atm" : ""}">${bs("CE", r.strike)}${gk(r.ce)}${px(r, "CE")}<td class="k"><b>${num(r.strike, 0)}</b>${atm ? `<span class="atmb">ATM</span>` : ""}<div class="oib"><i class="c" style="width:${((r.ce?.oi || 0) / mx) * 100}%"></i><i class="p" style="width:${((r.pe?.oi || 0) / mx) * 100}%"></i></div></td>${px(r, "PE")}${gk(r.pe)}${bs("PE", r.strike)}</tr>`;
    }).join("")}</tbody></table></div>`;
  }
  function chainHead() {
    const ch = S.chain;
    if (!ch) return "";
    const ar = ch.byStrike.get(ch.atm), st = (premium(ar, "CE") || 0) + (premium(ar, "PE") || 0);
    return `<div class="sthd"><span>STRADDLE <b>${st ? num(st) : "—"}</b></span><span>STRADDLE IV <b>${ch.atmIv ? `${(ch.atmIv * 100).toFixed(1)}%` : "—"}</b></span></div>`;
  }

  function structureHtml() {
    const ch = S.chain;
    if (!ch?.rows.length) return "";
    let ce = 0, pe = 0;
    for (const r of ch.rows) { ce += r.ce?.oi || 0; pe += r.pe?.oi || 0; }
    const pcr = ce ? pe / ce : null;
    let best = null;
    for (const K of ch.strikes) {
      let pain = 0;
      for (const r of ch.rows) pain += (r.ce?.oi || 0) * Math.max(K - r.strike, 0) + (r.pe?.oi || 0) * Math.max(r.strike - K, 0);
      if (!best || pain < best.pain) best = { K, pain };
    }
    const top = (t) => [...ch.rows].filter((r) => side(r, t)?.oi > 0).sort((a, b) => side(b, t).oi - side(a, t).oi).slice(0, 3).map((r) => num(r.strike, 0));
    const i0 = Math.max(ch.strikes.indexOf(ch.atm), 0), win = ch.rows.slice(Math.max(i0 - 15, 0), i0 + 16);
    const ar = ch.byStrike.get(ch.atm), straddle = (premium(ar, "CE") || 0) + (premium(ar, "PE") || 0);
    const spot = ch.spot;
    const iv = win.map((r) => { const v = [r.ce?.iv, r.pe?.iv].filter((x) => x > 0).map((x) => (x > 3 ? x : x * 100)); return { x: r.strike, y: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }; });
    const pcrG = V.gauge(fin(pcr) ? clamp((pcr - 0.4) / 1.2, 0, 1) : null, { label: fin(pcr) ? pcr.toFixed(2) : "—", sub: "put/call ratio (OI)", color: V.C.acc });
    return `<div class="card vrow">${pcrG}<div class="vcol">
        <div class="kv"><span>Max pain</span><b>${best ? num(best.K, 0) : "—"}</b><small class="${cls(best ? best.K - spot : 0)}">${best ? `${best.K >= spot ? "+" : "−"}${Math.abs(best.K - spot).toFixed(0)} pts` : ""}</small></div>
        <div class="kv"><span>Resistance (call OI)</span><b>${top("CE").join(" · ") || "—"}</b></div>
        <div class="kv"><span>Support (put OI)</span><b>${top("PE").join(" · ") || "—"}</b></div>
        <div class="kv"><span>ATM straddle</span><b>${straddle ? num(straddle) : "—"}</b><small>${straddle ? `±${((straddle / spot) * 100).toFixed(2)}% implied move` : ""}</small></div></div></div>
      <div class="card"><div class="n">Open interest by strike <span class="flat">(<i class="dot" style="background:${V.C.up}"></i>calls <i class="dot" style="background:${V.C.dn}"></i>puts)</span></div>${V.pairBars(win.map((r) => ({ x: r.strike, a: r.ce?.oi || 0, b: r.pe?.oi || 0 })), { mark: ch.atm, fmtX: (x) => num(x, 0) })}</div>
      <div class="card"><div class="n">IV smile (%, avg of call &amp; put)</div>${V.line(iv.map((p) => ({ x: p.x, y: p.y })), { mark: ch.atm, xfmt: (x) => num(x, 0) })}</div>`;
  }

  function renderPop() {
    const el = $("#pf-pop");
    if (!el) return;
    const p = S.pop;
    if (!p) { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;
    el.innerHTML = `<div class="popc"><div class="pt ${p.side > 0 ? "up" : "dn"}">${p.side > 0 ? "Buy" : "Sell"} ${num(p.strike, 0)} ${p.type}<button class="x-btn" data-pa="close" aria-label="Close">✕</button></div>
      <div class="pr"><button class="chip" data-pa="m" aria-label="Fewer lots">−</button><input id="pf-pl" type="number" min="1" max="100" inputmode="numeric" value="${p.lots}" aria-label="Lots"><button class="chip" data-pa="p" aria-label="More lots">+</button><span class="note">lots · LTP ${num(priceLeg(p.type, p.strike))}</span></div>
      <button class="btn" data-pa="add">Add</button></div>`;
  }

  // ---------- results ----------
  function renderResults() {
    if (!S.root || !S.root.isConnected) return;
    const c = ctx();
    renderSliderLabels();
    if (!c) { for (const id of ["#pf-chart", "#pf-kv", "#pf-stats", "#pf-greeks", "#pf-sug"]) $(id).innerHTML = ""; updateLegCells(null); return; }
    const an = c.legs.length ? analyze(c.legs, c.lot, { spot: c.spot, T: c.Tn, atmIv: c.atmIv, offset: c.realized }) : null;
    if (!S.scrubbing) morph($("#pf-chart"), chartHtml(c, an)); // don't redraw under a finger that is scrubbing
    morph($("#pf-kv"), kvHtml(c, an));
    morph($("#pf-stats"), statsHtml(c, an));
    morph($("#pf-greeks"), greeksHtml(c));
    morph($("#pf-sug"), sugHtml(c));
    updateLegCells(c);
  }

  function renderAll(fromLoad) {
    if (!S.root || !S.root.isConnected) return;
    renderTop();
    if (!fromLoad || S.root.querySelectorAll(".leg").length !== S.legs.length) renderLegs();
    morph($("#pf-chainhd"), chainHead());
    morph($("#pf-chain"), chainHtml());
    morph($("#pf-struct"), structureHtml());
    renderResults();
  }

  // ---------- events ----------
  function bindOnce(root) {
    root.addEventListener("click", (e) => {
      const t = e.target.closest("button");
      if (S.menu && !e.target.closest(".dd")) { S.menu = null; renderMenus(); }
      if (!t) return;
      if (t.dataset.u) { if (t.dataset.u !== S.und) { S.und = t.dataset.u; S.expiry = null; S.legs = []; S.sid = null; S.name = null; S.chain = null; S.live = null; S.sug = null; persist(); renderAll(); load(); } return; }
      if (t.dataset.exp) { if (t.dataset.exp !== S.expiry) { S.expiry = t.dataset.exp; S.chain = null; S.sug = null; S.legs.forEach((l) => { if (!fin(l.exit)) l.entry = null; }); persist(); renderAll(); load(); } return; }
      if (t.dataset.pop) { const [ty, k, sd] = t.dataset.pop.split(":"); S.pop = { type: ty, strike: parseFloat(k), side: +sd, lots: 1 }; return renderPop(); }
      if (t.dataset.pa) {
        const a = t.dataset.pa, p = S.pop;
        if (!p) return;
        if (a === "close") S.pop = null;
        else if (a === "m") p.lots = Math.max(p.lots - 1, 1);
        else if (a === "p") p.lots = Math.min(p.lots + 1, 100);
        else if (a === "add") { addLeg(p.type, p.strike, p.side, p.lots); S.pop = null; }
        return renderPop();
      }
      if (t.dataset.show) { S.show[t.dataset.show] = !S.show[t.dataset.show]; if (!S.show.exp && !S.show.t0) S.show[t.dataset.show] = true; persist(); renderResults(); return renderSliderLabels(); }
      if (t.id === "pf-pfbtn") { S.menu = S.menu === "pf" ? null : "pf"; return renderMenus(); }
      if (t.id === "pf-gkbtn") { S.menu = S.menu === "gk" ? null : "gk"; return renderMenus(); }
      if (t.dataset.gk) {
        const g = t.dataset.gk;
        S.greekCols = S.greekCols.includes(g) ? S.greekCols.filter((x) => x !== g) : [...S.greekCols, g];
        persist(); renderMenus(); return morph($("#pf-chain"), chainHtml());
      }
      if (t.dataset.depth) {
        const d = +t.dataset.depth;
        S.depth = d === 40 ? 40 : clamp(S.depth + d, 15, 40);
        persist(); morph($("#pf-chain"), chainHtml()); return;
      }
      if (t.dataset.ld != null) { S.menu = null; return loadStrategy(+t.dataset.ld); }
      if (t.dataset.dl != null) { S.strategies.splice(+t.dataset.dl, 1); LS.set("pfSaved", S.strategies); return renderMenus(); }
      if (t.dataset.apply != null) return applySuggestion(+t.dataset.apply);
      if (t.dataset.a === "odel") {
        const row = t.closest(".ord"), l = S.legs.find((x) => x.id === row.dataset.leg);
        if (!l) return;
        if (row.dataset.kind === "ENTRY") S.legs = S.legs.filter((x) => x !== l);
        else { l.exit = null; l.tOut = null; }
        S.sug = null; persist(); renderLegs(); return renderResults();
      }
      const leg = t.closest(".leg");
      if (leg && t.dataset.a) {
        const i = +leg.dataset.i, l = S.legs[i];
        const a = t.dataset.a;
        if (a === "flip") l.side *= -1;
        else if (a === "rm") S.legs.splice(i, 1);
        else if (a === "l+") l.lots = Math.min(l.lots + 1, 100);
        else if (a === "l-") l.lots = Math.max(l.lots - 1, 1);
        else if (a === "k-") return moveStrike(i, -1);
        else if (a === "k+") return moveStrike(i, 1);
        S.sug = null; persist(); renderLegs(); renderResults();
        return;
      }
      if (t.id === "pf-clear") { S.legs = []; S.sid = null; S.name = null; S.sug = null; persist(); renderLegs(); renderResults(); }
      if (t.id === "pf-reset") { S.days = 0; S.ivShift = 0; S.move = 0; renderTop(); renderResults(); }
      if (t.id === "pf-save") { S.saving = !S.saving; $("#pf-saverow").hidden = !S.saving; if (S.saving) $("#pf-name").focus(); }
      if (t.id === "pf-savego") {
        if (!S.legs.length) return;
        ensureSid();
        const name = $("#pf-name").value.trim() || `${UND[S.und].name} ${new Date().toLocaleDateString("en-IN")}`;
        S.name = name;
        S.strategies.unshift({ name, sid: S.sid, und: S.und, expiry: S.expiry, lot: lotSize(), legs: S.legs.map(({ id, type, strike, side, lots, entry, exit, tIn, tOut, secId }) => ({ id, type, strike, side, lots, entry, exit: fin(exit) ? exit : null, tIn, tOut, secId })) });
        S.strategies = S.strategies.slice(0, 30); LS.set("pfSaved", S.strategies); persist();
        $("#pf-name").value = ""; S.saving = false; $("#pf-saverow").hidden = true; renderMenus();
      }
    });
    root.addEventListener("change", (e) => {
      const t = e.target;
      if (t.id === "pf-lot") { const v = Math.round(+t.value); if (v > 0) { S.lot[S.und] = v; S.sug = null; persist(); renderResults(); } }
      else if (t.dataset.a === "entry") {
        const i = +t.closest(".leg").dataset.i, v = parseFloat(t.value);
        if (fin(v) && v >= 0) { S.legs[i].entry = v; S.sug = null; persist(); renderResults(); renderOrders(); }
      } else if (t.dataset.a === "exit") {
        setExit(S.legs[+t.closest(".leg").dataset.i], t.value);
        S.sug = null; persist(); renderResults(); renderOrders();
      } else if (t.dataset.a === "otime") {
        const row = t.closest(".ord"), l = S.legs.find((x) => x.id === row.dataset.leg), ms = fromLocalInput(t.value);
        if (!l || ms == null) return;
        if (row.dataset.kind === "ENTRY") l.tIn = ms; else l.tOut = ms;
        persist(); renderOrders();
      }
    });
    root.addEventListener("input", (e) => {
      const t = e.target;
      if (t.id === "pf-days") S.days = +t.value;
      else if (t.id === "pf-ivs") S.ivShift = +t.value;
      else if (t.id === "pf-mv") S.move = +t.value;
      else if (t.id === "pf-pl") { if (S.pop) S.pop.lots = clamp(Math.round(+t.value) || 1, 1, 100); return; }
      else if (t.dataset.a === "entry" || t.dataset.a === "exit") { // apply while typing; P&L updates live
        const l = S.legs[+t.closest(".leg").dataset.i], v = parseFloat(t.value);
        if (t.dataset.a === "exit") { setExit(l, t.value); renderOrders(); }
        else if (fin(v) && v >= 0) l.entry = v;
        persist();
      } else return;
      renderResults();
    });
    const readout = () => $("#pf-read");
    const scrub = (e) => {
      const svg = $("#pf-chart svg"), c = ctx();
      if (!svg || !c || !S.geom) return;
      const r = svg.getBoundingClientRect();
      const px = clamp(((e.clientX - r.left) / r.width) * S.geom.W, S.geom.Lm, S.geom.W - S.geom.Rm);
      const x = S.geom.lo + ((px - S.geom.Lm) / (S.geom.W - S.geom.Lm - S.geom.Rm)) * (S.geom.hi - S.geom.lo);
      const xl = svg.querySelector("#pf-xl");
      if (xl) { xl.setAttribute("x1", px); xl.setAttribute("x2", px); xl.setAttribute("opacity", ".7"); }
      const pe = expiryPnl(c.legs, c.lot, x) + c.realized, ps = scenarioPnl(c.legs, c.lot, x, c.Ts, ivs()) + c.realized;
      readout().innerHTML = `${UND[S.und].name} <b>${num(x, 0)}</b> (${(((x / c.spot) - 1) * 100).toFixed(2)}%) · expiry <b class="${cls(pe)}">${money(pe)}</b> · ${S.days ? `T+${S.days}d` : "today"} <b class="${cls(ps)}">${money(ps)}</b>`;
    };
    const pc = root.querySelector("#pf-chart");
    pc.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse" || S.scrubbing) scrub(e); });
    pc.addEventListener("pointerdown", (e) => { S.scrubbing = true; scrub(e); });
    for (const ev of ["pointerup", "pointercancel", "pointerleave"]) pc.addEventListener(ev, () => { S.scrubbing = false; });
  }

  function loadStrategy(i) {
    const s = S.strategies[i];
    if (!s) return;
    S.und = s.und; S.expiry = s.expiry; S.lot[s.und] = s.lot || S.lot[s.und];
    S.legs = s.legs.map((l) => ({ ...l, id: l.id || rid(), iv: null }));
    S.sid = s.sid || `s${Date.now().toString(36)}`; S.name = s.name; S.sug = null;
    S.chain = null; persist(); renderAll(); load();
  }

  const SHELL = `
    <h2>Payoff terminal</h2>
    <div class="pf-top"><div class="seg" id="pf-und"></div>
      <div class="dd"><button class="ddb" id="pf-pfbtn">Portfolios <i>▾</i></button><div class="ddm" id="pf-pfmenu" hidden></div></div></div>
    <div id="pf-spot" class="pf-spot"></div>
    <div id="pf-msg" class="banner-inline" hidden></div>
    <div id="pf-kv"></div>
    <h3>Payoff chart</h3>
    <div class="sl vd"><label>Valuation date <span id="v-days"></span></label><input type="range" id="pf-days" min="0" max="0" step="1" value="0"></div>
    <div class="lgt"><button data-show="exp" class="on"><i style="background:#2ecc8f"></i>At expiry</button><button data-show="t0" class="on"><i style="background:#4f8cff"></i>Today (T+0)</button></div>
    <div id="pf-chart"></div><div id="pf-read" class="note">Drag across the chart to read P&amp;L at any index level.</div>
    <details class="whatif"><summary>What-if: IV and spot</summary>
      <div class="sl"><label>IV shift <b id="v-iv"></b></label><input type="range" id="pf-ivs" min="-10" max="10" step="0.5" value="0"></div>
      <div class="sl"><label>Spot move <b id="v-mv"></b></label><input type="range" id="pf-mv" min="-6" max="6" step="0.1" value="0"></div>
      <button class="chip" id="pf-reset">Reset</button></details>
    <div class="phd"><h3>Positions (<span id="pf-npos">0</span>)</h3><span class="pact"><label class="lotl">Lot <input id="pf-lot" class="mini num" type="number" inputmode="numeric" aria-label="Lot size"></label><button class="tbtn" id="pf-save">Save</button><button class="tbtn dn" id="pf-clear">Clear all</button></span></div>
    <div class="pf-saverow" id="pf-saverow" hidden><input id="pf-name" placeholder="Name this portfolio"><button class="btn" id="pf-savego">Save</button></div>
    <div id="pf-legs"></div>
    <h3>Order log <span class="flat">· IST, editable</span></h3>
    <div id="pf-orders"></div>
    <h3>Next step</h3><div id="pf-sug"></div>
    <h3>Your risk, in plain English</h3><div id="pf-greeks"></div>
    <h3>Outcome</h3><div id="pf-stats"></div>
    <div class="phd"><h3>Option chain</h3><div class="dd"><button class="ddb" id="pf-gkbtn">Greeks <span class="bdg" id="pf-gkn">1</span> <i>▾</i></button><div class="ddm gk" id="pf-gkmenu" hidden></div></div></div>
    <div id="pf-chainhd"></div>
    <div class="xcs" id="pf-chips"></div>
    <div class="ocw" id="pf-chain"></div>
    <div class="note">Premiums are Dhan last-traded prices (mid of bid/ask if untraded). Green/red bars under each strike = call/put open interest. Analysis only: nothing here places or stages an order.</div>
    <h3>Market structure</h3><div id="pf-struct"></div>
    <div id="pf-pop" class="pop" hidden></div>`;

  return {
    mount(root) {
      S.root = root;
      root.innerHTML = SHELL;
      bindOnce(root);
      renderAll();
      load();
    },
    underlyingId: () => UND[S.und].id,
    hasOpen: () => S.legs.some((l) => !fin(l.exit)),
    /** Called every feed cycle (~1 s): fold the live index quote into spot, P&L, chart and greeks. */
    tick() {
      const u = UND[S.und], q = getQuote(u.seg, u.id);
      if (q?.ltp) S.live = { v: q.ltp, t: Date.now() };
      if (!S.root?.isConnected || !S.chain) return;
      renderSpot();
      renderResults();
    },
    /** One P&L sample for the minute log, or null when there is nothing live to measure. Works with the tab closed. */
    sample() {
      if (!S.sid || !S.chain || Date.now() - S.chainAt > 20000) return null;
      const c = ctx();
      if (!c || !c.legs.length) return null;
      return { sid: S.sid, total: c.total, realized: c.realized, mark: c.mark, meta: sessionMeta() };
    },
    /** Keeps the chain fresh (3 s lane limit) whether or not the tab is visible, so P&L logging works in the background. */
    async refresh() {
      if (S.busy || !hasCreds() || Date.now() - S.chainAt < 2900) return;
      return load();
    },
  };
}
