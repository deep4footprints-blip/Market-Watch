// Payoff terminal UI. Analysis only: it reads the Dhan option chain and never places or prepares orders.
import { analyze, bsPrice, expiryPnl, impliedVol, legGreeks, portfolioGreeks, scenarioPnl, TEMPLATES } from "./payoff.js";

const UND = {
  nifty50: { name: "Nifty", key: "NIFTY", id: 13, seg: "IDX_I", lot: 65 },
  sensex: { name: "Sensex", key: "SENSEX", id: 51, seg: "IDX_I", lot: 20 },
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fin = (n) => n != null && Number.isFinite(n);
const num = (n, d = 2) => (fin(n) ? Number(n).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—");
const money = (n) => {
  if (n === Infinity) return "Unlimited";
  if (n === -Infinity) return "Unlimited";
  if (!fin(n)) return "—";
  const a = Math.abs(n), s = n < 0 ? "−" : "+";
  return a >= 1e7 ? `${s}₹${(a / 1e7).toFixed(2)} Cr` : a >= 1e5 ? `${s}₹${(a / 1e5).toFixed(2)} L` : `${s}₹${Math.round(a).toLocaleString("en-IN")}`;
};
const axis = (n) => (Math.abs(n) >= 1e5 ? `${(n / 1e5).toFixed(1)}L` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : n.toFixed(0));
const cls = (n) => (!fin(n) || n === 0 ? "flat" : n > 0 ? "up" : "dn");
const todayIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const tYears = (exp) => {
  const t = exp ? Date.parse(`${exp}T15:30:00+05:30`) : NaN;
  return Number.isFinite(t) ? Math.max((t - Date.now()) / (365 * 864e5), 0) : 0;
};
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

export function createPayoff({ client, LS, getInst, friendly, hasCreds }) {
  const saved = LS.get("pf", {});
  const S = {
    und: UND[saved.und] ? saved.und : "nifty50",
    expiry: saved.expiry || null,
    legs: Array.isArray(saved.legs) ? saved.legs : [],
    width: saved.width || 2,
    depth: [15, 20, 25, 30, 35, 40].includes(saved.depth) ? saved.depth : 15, // strikes shown each side of ATM
    lot: saved.lot || {},
    tap: "B", days: 0, ivShift: 0, move: 0,
    expiries: {}, chain: null, busy: false, again: false, msg: "",
    strategies: LS.get("pfSaved", []),
    geom: null, root: null, instLots: null,
  };
  const persist = () => LS.set("pf", { und: S.und, expiry: S.expiry, legs: S.legs, width: S.width, depth: S.depth, lot: S.lot });
  const lotSize = () => S.lot[S.und] || S.instLots?.[UND[S.und].key] || UND[S.und].lot;
  const $ = (id) => S.root?.querySelector(id);

  // ---------- pricing helpers on top of the chain ----------
  const side = (row, type) => (type === "CE" ? row?.ce : row?.pe);
  function premium(row, type) {
    const o = side(row, type);
    if (!o) return null;
    if (o.ltp > 0) return o.ltp;
    if (o.bid > 0 && o.ask > 0) return (o.bid + o.ask) / 2;
    return null;
  }
  function legIv(row, type, K) {
    const ch = S.chain, o = side(row, type);
    if (o?.iv > 0) return o.iv > 3 ? o.iv / 100 : o.iv;
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
      if (l.entry == null) l.entry = priceLeg(l.type, l.strike);
    }
    persist();
  }

  function ctx() {
    const ch = S.chain;
    if (!ch || !fin(ch.spot)) return null;
    const Tn = tYears(S.expiry);
    const legs = S.legs.filter((l) => fin(l.entry) && fin(l.iv));
    return { ch, spot: ch.spot, Tn, Ts: Math.max(Tn - S.days / 365, 0), lot: lotSize(), legs, scn: ch.spot * (1 + S.move / 100), atmIv: ch.atmIv || (legs.length ? legs.reduce((a, l) => a + l.iv, 0) / legs.length : 0.15) };
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
        S.chain = chain;
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
    S.legs.push({ type, strike: K, side: sd, lots, entry: priceLeg(type, K), iv: legIv(S.chain.byStrike.get(K), type, K) });
    persist(); renderLegs(); renderResults();
  }
  function applyTemplate(id) {
    const ch = S.chain;
    if (!ch?.atm || !ch.step) return;
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    S.legs = [];
    for (const l of t.legs(S.width)) {
      const want = ch.atm + l.off * ch.step;
      const K = ch.strikes.reduce((b, k) => (Math.abs(k - want) < Math.abs(b - want) ? k : b), ch.strikes[0]);
      S.legs.push({ type: l.type, strike: K, side: l.side, lots: l.lots, entry: priceLeg(l.type, K), iv: legIv(ch.byStrike.get(K), l.type, K) });
    }
    persist(); renderLegs(); renderResults();
  }
  function moveStrike(i, dir) {
    const l = S.legs[i], ch = S.chain;
    if (!l || !ch) return;
    const idx = ch.strikes.indexOf(l.strike) + dir;
    if (idx < 0 || idx >= ch.strikes.length) return;
    l.strike = ch.strikes[idx];
    l.entry = priceLeg(l.type, l.strike);
    l.iv = legIv(ch.byStrike.get(l.strike), l.type, l.strike);
    persist(); renderLegs(); renderResults();
  }

  // ---------- rendering ----------
  function renderTop() {
    const list = S.expiries[S.und]?.list || (S.expiry ? [S.expiry] : []);
    const ch = S.chain;
    $("#pf-und").innerHTML = Object.entries(UND).map(([k, u]) => `<button data-u="${k}" class="${k === S.und ? "on" : ""}">${u.name}</button>`).join("");
    const opts = list.map((e) => `<option value="${e}" ${e === S.expiry ? "selected" : ""}>${e}</option>`).join("");
    if ($("#pf-exp").dataset.sig !== opts) { $("#pf-exp").innerHTML = opts; $("#pf-exp").dataset.sig = opts; } // avoid closing an open dropdown on refresh
    $("#pf-spot").innerHTML = ch ? `<b>${num(ch.spot)}</b> <small class="flat">${S.expiry ? `· ${(tYears(S.expiry) * 365).toFixed(1)}d to expiry` : ""}${ch.atmIv ? ` · ATM IV ${(ch.atmIv * 100).toFixed(1)}%` : ""}</small>` : "";
    $("#pf-msg").textContent = S.msg || (S.busy && !ch ? "Loading option chain…" : "");
    $("#pf-msg").hidden = !$("#pf-msg").textContent;
    if (!$("#pf-tpl").children.length) $("#pf-tpl").innerHTML = TEMPLATES.map((t) => `<button class="chip" data-t="${t.id}">${t.name}</button>`).join("");
    const setVal = (sel, v) => { const el = $(sel); if (el && document.activeElement !== el) el.value = String(v); };
    setVal("#pf-w", S.width);
    setVal("#pf-lot", lotSize());
    const maxDays = Math.floor(tYears(S.expiry) * 365);
    const dayRow = $("#pf-days-row");
    dayRow.hidden = maxDays < 1;
    $("#pf-days").max = String(Math.max(maxDays, 0));
    S.days = Number.isFinite(S.days) ? Math.min(S.days, Math.max(maxDays, 0)) : 0;
    setVal("#pf-days", S.days);
    setVal("#pf-ivs", S.ivShift);
    setVal("#pf-mv", S.move);
    renderSliderLabels();
  }
  function renderSliderLabels() {
    $("#v-days").textContent = S.days === 0 ? "now" : `+${S.days}d`;
    $("#v-iv").textContent = `${S.ivShift > 0 ? "+" : ""}${S.ivShift} pts`;
    const c = ctx();
    $("#v-mv").textContent = `${S.move > 0 ? "+" : ""}${S.move.toFixed(1)}%${c ? ` → ${num(c.scn, 0)}` : ""}`;
  }

  function renderLegs() {
    const box = $("#pf-legs");
    if (!S.legs.length) { box.innerHTML = `<div class="empty">No legs yet. Pick a template, or tap a price in the chain below.</div>`; return; }
    box.innerHTML = S.legs.map((l, i) => `<div class="leg" data-i="${i}">
      <div class="lh">
        <button class="bs ${l.side > 0 ? "b" : "s"}" data-a="flip" aria-label="Flip buy/sell">${l.side > 0 ? "BUY" : "SELL"}</button>
        <b class="ty">${l.type}</b>
        <span class="st"><button data-a="k-" aria-label="Lower strike">‹</button><span>${num(l.strike, 0)}</span><button data-a="k+" aria-label="Higher strike">›</button></span>
        <span class="st"><button data-a="l-" aria-label="Fewer lots">−</button><span>${l.lots}</span><button data-a="l+" aria-label="More lots">+</button></span>
        <input class="en" data-a="entry" type="number" step="0.05" inputmode="decimal" value="${fin(l.entry) ? +l.entry.toFixed(2) : ""}" aria-label="Entry premium">
        <button class="x-btn" data-a="rm" aria-label="Remove leg">✕</button>
      </div>
      <div class="lg"></div></div>`).join("");
  }

  function updateLegCells(c) {
    S.root?.querySelectorAll(".leg").forEach((el) => {
      const l = S.legs[+el.dataset.i], cell = el.querySelector(".lg");
      if (!l || !cell) return;
      if (!c || !fin(l.entry) || !fin(l.iv)) { cell.textContent = "—"; return; }
      const row = c.ch.byStrike.get(l.strike);
      const ltp = premium(row, l.type);
      const g = legGreeks(l, c.lot, c.scn, c.Ts, S.ivShift);
      const now = scenarioPnl([l], c.lot, c.scn, c.Ts, S.ivShift);
      cell.innerHTML = `LTP <b>${num(ltp)}</b> · IV <b>${(l.iv * 100).toFixed(1)}%</b> · Δ <b>${num(g.delta, 1)}</b> · Γ <b>${num(g.gamma, 3)}</b> · Θ <b class="${cls(g.theta)}">${num(g.theta, 0)}</b> · ν <b class="${cls(g.vega)}">${num(g.vega, 0)}</b> · P&amp;L <b class="${cls(now)}">${money(now)}</b>`;
    });
  }

  function chartHtml(c, an) {
    if (!c.legs.length) return `<div class="empty">Add legs to see the payoff.</div>`;
    const W = 360, H = 250, Lm = 46, Rm = 8, Tm = 10, Bm = 22;
    const sd = an?.sd || c.spot * 0.01;
    const ks = c.legs.map((l) => l.strike);
    const lo = Math.max(Math.min(c.spot - 2.5 * sd, ...ks.map((k) => k - sd)), c.spot * 0.5);
    const hi = Math.max(c.spot + 2.5 * sd, ...ks.map((k) => k + sd));
    const N = 160, xs = Array.from({ length: N + 1 }, (_, i) => lo + ((hi - lo) * i) / N);
    const ye = xs.map((x) => expiryPnl(c.legs, c.lot, x));
    const ys = xs.map((x) => scenarioPnl(c.legs, c.lot, x, c.Ts, S.ivShift));
    let mn = Math.min(0, ...ye, ...ys), mx = Math.max(0, ...ye, ...ys);
    const pad = (mx - mn || 1) * 0.08; mn -= pad; mx += pad;
    const X = (v) => Lm + ((v - lo) / (hi - lo)) * (W - Lm - Rm);
    const Y = (v) => Tm + ((mx - v) / (mx - mn)) * (H - Tm - Bm);
    const y0 = Y(0);
    const line = (arr) => arr.map((v, i) => `${i ? "L" : "M"}${X(xs[i]).toFixed(1)},${Y(v).toFixed(1)}`).join("");
    const area = `${line(ye)}L${X(hi).toFixed(1)},${y0.toFixed(1)}L${X(lo).toFixed(1)},${y0.toFixed(1)}Z`;
    S.geom = { lo, hi, W, Lm, Rm };
    const yt = [mn + pad, 0, mx - pad].map((v) => `<text x="${Lm - 4}" y="${Y(v) + 3}" text-anchor="end">${axis(v)}</text>`).join("");
    const xt = [0, 0.25, 0.5, 0.75, 1].map((f) => { const v = lo + (hi - lo) * f; return `<text x="${X(v)}" y="${H - 6}" text-anchor="${f === 0 ? "start" : f === 1 ? "end" : "middle"}">${num(v, 0)}</text>`; }).join("");
    const band = an?.sd ? `<rect x="${X(c.spot - an.sd)}" y="${Tm}" width="${X(c.spot + an.sd) - X(c.spot - an.sd)}" height="${H - Tm - Bm}" fill="#d9c9a3" opacity=".07"/>` : "";
    const bes = (an?.breakevens || []).filter((b) => b > lo && b < hi).map((b) => `<circle cx="${X(b)}" cy="${y0}" r="3.5" fill="#000" stroke="#d9c9a3" stroke-width="1.5"/>`).join("");
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Payoff chart" style="touch-action:pan-y;display:block">
      <defs><clipPath id="cu"><rect x="0" y="0" width="${W}" height="${y0}"/></clipPath><clipPath id="cd"><rect x="0" y="${y0}" width="${W}" height="${H}"/></clipPath></defs>
      <g font-size="9" fill="#8a8a90" font-family="ui-monospace,monospace">${yt}${xt}</g>
      ${band}
      <line x1="${Lm}" x2="${W - Rm}" y1="${y0}" y2="${y0}" stroke="#2a2a2e"/>
      <path d="${area}" fill="#2ecc8f" opacity=".16" clip-path="url(#cu)"/><path d="${area}" fill="#ff5c5c" opacity=".16" clip-path="url(#cd)"/>
      <path d="${line(ye)}" fill="none" stroke="#f2f2f0" stroke-width="1.8"/>
      <path d="${line(ys)}" fill="none" stroke="#d9c9a3" stroke-width="1.6" stroke-dasharray="4 3"/>
      <line x1="${X(c.spot)}" x2="${X(c.spot)}" y1="${Tm}" y2="${H - Bm}" stroke="#8a8a90" stroke-dasharray="2 3"/>
      ${S.move ? `<line x1="${X(clamp(c.scn, lo, hi))}" x2="${X(clamp(c.scn, lo, hi))}" y1="${Tm}" y2="${H - Bm}" stroke="#d9c9a3" stroke-width="1"/>` : ""}
      ${bes}
      <line id="pf-xl" x1="0" x2="0" y1="${Tm}" y2="${H - Bm}" stroke="#fff" stroke-width=".8" opacity="0"/>
    </svg>
    <div class="note lgd"><i style="background:#f2f2f0"></i>At expiry <i style="background:#d9c9a3"></i>${S.days ? `T+${S.days}d` : "Today (T+0)"} <i style="background:#8a8a90"></i>Spot ${S.move ? "<i style='background:#d9c9a3'></i>Scenario spot" : ""} <b>○</b> breakeven · shaded = ±1σ</div>`;
  }

  function statsHtml(c, an) {
    if (!an) return "";
    const rr = fin(an.maxProfit) && fin(an.maxLoss) && an.maxLoss < 0 ? `${(an.maxProfit / -an.maxLoss).toFixed(2)} : 1` : "—";
    const card = (n, v, k = "") => `<div class="card"><div class="n">${n}</div><div class="v sm ${k}">${v}</div></div>`;
    const pe = expiryPnl(c.legs, c.lot, c.scn), ps = scenarioPnl(c.legs, c.lot, c.scn, c.Ts, S.ivShift);
    return `<div class="stats">
      ${card(an.netPremium >= 0 ? "Net credit" : "Net debit", money(Math.abs(an.netPremium)).replace("+", ""), an.netPremium >= 0 ? "up" : "dn")}
      ${card("Max profit", an.unlimitedProfit ? "Unlimited" : money(an.maxProfit), "up")}
      ${card("Max loss", an.unlimitedLoss ? "Unlimited" : money(an.maxLoss), "dn")}
      ${card("Reward : risk", rr)}
      ${card("Prob. of profit", fin(an.pop) ? `${(an.pop * 100).toFixed(0)}%` : "—")}
      ${card("Expected P&amp;L", money(an.expected), cls(an.expected))}
      ${card("Breakeven" + (an.breakevens.length === 1 ? "" : "s"), an.breakevens.length ? an.breakevens.map((b) => num(b, 0)).join(" · ") : "none")}
      ${card("1σ range", fin(an.sd) ? `${num(c.spot - an.sd, 0)} – ${num(c.spot + an.sd, 0)}` : "—")}
    </div>
    <div class="note">At ${num(c.scn, 0)}: expiry <b class="${cls(pe)}">${money(pe)}</b> · ${S.days ? `T+${S.days}d` : "today"} <b class="${cls(ps)}">${money(ps)}</b>. POP and expected P&amp;L are model values (lognormal at ATM IV, risk-neutral), not forecasts.</div>`;
  }

  function greeksHtml(c) {
    if (!c.legs.length) return `<div class="empty">—</div>`;
    const g = portfolioGreeks(c.legs, c.lot, c.scn, c.Ts, S.ivShift);
    const card = (n, v, sub, k) => `<div class="card"><div class="n">${n}</div><div class="v sm ${k || ""}">${v}</div><div class="note">${sub}</div></div>`;
    return `<div class="stats">
      ${card("Delta Δ", num(g.delta, 1), `${num(g.delta / c.lot, 2)} lots · ${money(g.delta * c.scn * 0.01)} per 1% move`, cls(g.delta))}
      ${card("Gamma Γ", num(g.gamma, 3), `Δ change per index point`, cls(g.gamma))}
      ${card("Theta Θ / day", money(g.theta), "time decay per calendar day", cls(g.theta))}
      ${card("Vega ν / vol pt", money(g.vega), "per 1 pt change in IV", cls(g.vega))}
    </div>
    <div class="note">Greeks use Black-Scholes at the scenario (days, IV shift, spot) using each leg's live IV; at defaults they track the chain's own greeks closely but are not identical.</div>`;
  }

  function chainHtml() {
    const ch = S.chain;
    if (!ch?.rows.length) return `<div class="empty">No chain loaded.</div>`;
    const i0 = Math.max(ch.strikes.indexOf(ch.atm), 0);
    const rows = ch.rows.slice(Math.max(i0 - S.depth, 0), i0 + S.depth + 1);
    const maxAvail = Math.min(i0, ch.rows.length - 1 - i0); // strikes actually available on the thinner side
    const mx = Math.max(1, ...rows.map((r) => Math.max(r.ce?.oi || 0, r.pe?.oi || 0)));
    const oi = (o, tone) => `<td class="oi"><i style="width:${((o?.oi || 0) / mx) * 100}%;background:${tone}"></i><span>${o?.oi ? (o.oi / 1e5).toFixed(1) : ""}</span></td>`;
    const px = (r, t, K) => { const o = side(r, t); const p = premium(r, t); return `<td class="px" data-add="${t}:${K}">${p != null ? num(p) : "—"}</td>`; };
    const iv = (o) => `<td class="iv">${o?.iv > 0 ? (o.iv > 3 ? o.iv : o.iv * 100).toFixed(1) : ""}</td>`;
    const more = S.depth < 40 && S.depth < maxAvail, less = S.depth > 15;
    const ctl = `<div class="occtl"><span class="note">Showing ±${Math.min(S.depth, maxAvail)} strikes around ATM</span>
      ${less ? `<button class="chip" data-depth="-5">Show less</button>` : ""}${more ? `<button class="chip" data-depth="5">Show 5 more each side</button><button class="chip" data-depth="40">Max ±${Math.min(40, maxAvail)}</button>` : ""}</div>`;
    return `${ctl}<table class="oc"><thead><tr><th>OI L</th><th>IV</th><th>CE</th><th>Strike</th><th>PE</th><th>IV</th><th>OI L</th></tr></thead><tbody>${rows.map((r) =>
      `<tr class="${r.strike === ch.atm ? "atm" : ""}">${oi(r.ce, "#2ecc8f33")}${iv(r.ce)}${px(r, "CE", r.strike)}<td class="k">${num(r.strike, 0)}</td>${px(r, "PE", r.strike)}${iv(r.pe)}${oi(r.pe, "#ff5c5c33")}</tr>`).join("")}</tbody></table>`;
  }

  function renderSaved() {
    $("#pf-saved").innerHTML = S.strategies.length
      ? S.strategies.map((s, i) => `<div class="row"><div class="s">${esc(s.name)}<small>${esc(UND[s.und]?.name || "")} · ${esc(s.expiry)} · ${s.legs.length} legs</small></div><button class="btn ghost" data-ld="${i}">Load</button><button class="x-btn" data-dl="${i}" aria-label="Delete">✕</button></div>`).join("")
      : `<div class="note">Nothing saved yet.</div>`;
  }

  function renderResults() {
    if (!S.root || !S.root.isConnected) return;
    const c = ctx();
    renderSliderLabels();
    if (!c) { $("#pf-chart").innerHTML = ""; $("#pf-stats").innerHTML = ""; $("#pf-greeks").innerHTML = ""; updateLegCells(null); return; }
    const an = c.legs.length ? analyze(c.legs, c.lot, { spot: c.spot, T: c.Tn, atmIv: c.atmIv }) : null;
    $("#pf-chart").innerHTML = chartHtml(c, an);
    $("#pf-stats").innerHTML = statsHtml(c, an);
    $("#pf-greeks").innerHTML = greeksHtml(c);
    updateLegCells(c);
  }

  function renderAll(fromLoad) {
    if (!S.root || !S.root.isConnected) return;
    renderTop();
    if (!fromLoad || S.root.querySelectorAll(".leg").length !== S.legs.length) renderLegs();
    $("#pf-chain").innerHTML = chainHtml();
    renderSaved();
    renderResults();
  }

  // ---------- events ----------
  function bindOnce(root) {
    root.addEventListener("click", (e) => {
      const t = e.target.closest("button, td[data-add]");
      if (!t) return;
      if (t.dataset.u) { if (t.dataset.u !== S.und) { S.und = t.dataset.u; S.expiry = null; S.legs = []; S.chain = null; persist(); renderAll(); load(); } return; }
      if (t.dataset.t) return applyTemplate(t.dataset.t);
      if (t.dataset.add) { const [ty, k] = t.dataset.add.split(":"); return addLeg(ty, parseFloat(k), S.tap === "B" ? 1 : -1); }
      if (t.dataset.depth) {
        const d = +t.dataset.depth;
        S.depth = d === 40 ? 40 : clamp(S.depth + d, 15, 40);
        persist(); $("#pf-chain").innerHTML = chainHtml(); return;
      }
      if (t.dataset.tap) { S.tap = t.dataset.tap; root.querySelectorAll("[data-tap]").forEach((b) => b.classList.toggle("on", b.dataset.tap === S.tap)); return; }
      if (t.dataset.ld != null) return loadStrategy(+t.dataset.ld);
      if (t.dataset.dl != null) { S.strategies.splice(+t.dataset.dl, 1); LS.set("pfSaved", S.strategies); return renderSaved(); }
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
        persist(); renderLegs(); renderResults();
        return;
      }
      if (t.id === "pf-clear") { S.legs = []; persist(); renderLegs(); renderResults(); }
      if (t.id === "pf-reset") { S.days = 0; S.ivShift = 0; S.move = 0; renderTop(); renderResults(); }
      if (t.id === "pf-save") {
        const name = $("#pf-name").value.trim() || `${UND[S.und].name} ${new Date().toLocaleDateString("en-IN")}`;
        if (!S.legs.length) return;
        S.strategies.unshift({ name, und: S.und, expiry: S.expiry, lot: lotSize(), legs: S.legs.map(({ type, strike, side, lots, entry }) => ({ type, strike, side, lots, entry })) });
        S.strategies = S.strategies.slice(0, 30); LS.set("pfSaved", S.strategies); $("#pf-name").value = ""; renderSaved();
      }
    });
    root.addEventListener("change", (e) => {
      const t = e.target;
      if (t.id === "pf-exp") { S.expiry = t.value; S.chain = null; S.legs.forEach((l) => (l.entry = null)); persist(); renderAll(); load(); }
      else if (t.id === "pf-w") { S.width = +t.value; persist(); }
      else if (t.id === "pf-lot") { const v = Math.round(+t.value); if (v > 0) { S.lot[S.und] = v; persist(); renderResults(); } }
      else if (t.dataset.a === "entry") {
        const i = +t.closest(".leg").dataset.i, v = parseFloat(t.value);
        if (fin(v) && v >= 0) { S.legs[i].entry = v; persist(); renderResults(); }
      }
    });
    root.addEventListener("input", (e) => {
      const t = e.target;
      if (t.id === "pf-days") S.days = +t.value;
      else if (t.id === "pf-ivs") S.ivShift = +t.value;
      else if (t.id === "pf-mv") S.move = +t.value;
      else return;
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
      const pe = expiryPnl(c.legs, c.lot, x), ps = scenarioPnl(c.legs, c.lot, x, c.Ts, S.ivShift);
      readout().innerHTML = `${UND[S.und].name} <b>${num(x, 0)}</b> (${(((x / c.spot) - 1) * 100).toFixed(2)}%) · expiry <b class="${cls(pe)}">${money(pe)}</b> · ${S.days ? `T+${S.days}d` : "today"} <b class="${cls(ps)}">${money(ps)}</b>`;
    };
    root.querySelector("#pf-chart").addEventListener("pointermove", scrub);
    root.querySelector("#pf-chart").addEventListener("pointerdown", scrub);
  }

  function loadStrategy(i) {
    const s = S.strategies[i];
    if (!s) return;
    S.und = s.und; S.expiry = s.expiry; S.lot[s.und] = s.lot || S.lot[s.und];
    S.legs = s.legs.map((l) => ({ ...l, iv: null }));
    S.chain = null; persist(); renderAll(); load();
  }

  const SHELL = `
    <h2>Payoff terminal</h2>
    <div class="pf-top"><div class="seg" id="pf-und"></div><select id="pf-exp" aria-label="Expiry"></select></div>
    <div id="pf-spot" class="pf-spot"></div>
    <div id="pf-msg" class="banner-inline" hidden></div>
    <h3>Templates <span class="flat">· width</span>
      <select id="pf-w" class="mini" aria-label="Strike width in steps">${[1, 2, 3, 4, 5, 6, 8, 10].map((n) => `<option value="${n}">${n} step${n > 1 ? "s" : ""}</option>`).join("")}</select></h3>
    <div class="chips" id="pf-tpl"></div>
    <h3>Legs <span class="flat">· lot size</span> <input id="pf-lot" class="mini num" type="number" inputmode="numeric" aria-label="Lot size"> <button class="chip" id="pf-clear">Clear</button></h3>
    <div id="pf-legs"></div>
    <h3>Payoff</h3>
    <div id="pf-chart"></div><div id="pf-read" class="note">Drag across the chart to read P&amp;L at any index level.</div>
    <h3>Scenario <button class="chip" id="pf-reset">Reset</button></h3>
    <div class="sl" id="pf-days-row"><label>Time passed <b id="v-days"></b></label><input type="range" id="pf-days" min="0" max="0" step="1" value="0"></div>
    <div class="sl"><label>IV shift <b id="v-iv"></b></label><input type="range" id="pf-ivs" min="-10" max="10" step="0.5" value="0"></div>
    <div class="sl"><label>Spot move <b id="v-mv"></b></label><input type="range" id="pf-mv" min="-6" max="6" step="0.1" value="0"></div>
    <h3>Outcome</h3><div id="pf-stats"></div>
    <h3>Portfolio greeks</h3><div id="pf-greeks"></div>
    <h3>Option chain <span class="flat">· tap a price to</span>
      <span class="seg sm"><button data-tap="B" class="on">Buy</button><button data-tap="S">Sell</button></span></h3>
    <div class="ocw" id="pf-chain"></div>
    <div class="note">Premiums are Dhan last-traded prices (mid of bid/ask if untraded). Analysis only: nothing here places or stages an order.</div>
    <h3>Saved strategies</h3>
    <div class="pf-save"><input id="pf-name" placeholder="Name this strategy"><button class="btn" id="pf-save">Save</button></div>
    <div id="pf-saved"></div>`;

  return {
    mount(root) {
      S.root = root;
      root.innerHTML = SHELL;
      root.querySelectorAll("[data-tap]").forEach((b) => b.classList.toggle("on", b.dataset.tap === S.tap));
      bindOnce(root);
      renderAll();
      load();
    },
    /** Called by the app's refresh timer while this tab is open. Never rebuilds inputs, so dragging/typing is safe. */
    async refresh() {
      if (!S.root || S.busy) return;
      return load();
    },
  };
}
