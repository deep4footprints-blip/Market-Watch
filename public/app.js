import { createDhanClient, buildSnapshot, buildPortfolio, buildWatch, fetchBook, bookInstruments } from "./dhan.js";
import { createPayoff } from "./payoff-ui.js";
import { createChart } from "./chart-ui.js";
import { fetchSpark } from "./candles.js";
import { morph } from "./dom.js";
import * as V from "./viz.js";

const $ = (s) => document.querySelector(s);
const LS = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = (n, d = 2) => (n == null ? "—" : Number(n).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }));
const sgn = (n) => (n == null ? "flat" : n > 0 ? "up" : n < 0 ? "dn" : "flat");
const pct = (n) => (n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`);
const cr = (n) => {
  if (n == null) return "—";
  const a = Math.abs(n), s = n < 0 ? "−" : "";
  return a >= 1e7 ? `${s}₹${(a / 1e7).toFixed(2)} Cr` : a >= 1e5 ? `${s}₹${(a / 1e5).toFixed(2)} L` : `${s}₹${inr(a, 0)}`;
};
const crS = (n) => (n == null ? "—" : `${n > 0 ? "+" : ""}${cr(n)}`);
const turn = (n) => (n == null ? "—" : n >= 1e7 ? `₹${(n / 1e7).toFixed(1)} Cr` : `₹${(n / 1e5).toFixed(1)} L`);

let tab = LS.get("tab", "overview");
const data = { snap: null, port: null, watch: null, inst: null };
const feed = { quotes: new Map(), book: null, bookAt: 0, at: 0 };
const sparks = new Map();
let wlSug = "", renderedTab = null;

const creds = () => LS.get("dhan", { token: "", clientId: "" });
// Dhan caps /marketfeed/quote at 1 request per second, so one request per cycle is the real-time ceiling of the REST API.
const client = createDhanClient({ fetchFn: (...a) => fetch(...a), getCreds: async () => creds(), minGapMs: 1050 });
const getQuote = (seg, id) => feed.quotes.get(`${seg}:${id}`);
const err = (message, code) => Object.assign(new Error(message), { code });

const chart = createChart({ client, LS, friendly: (e) => friendly(e), getQuote });
const openChart = (inst) => chart.open(inst);
const pf = createPayoff({ client, LS, getInst: () => loadInst(), friendly: (e) => friendly(e), hasCreds: () => !!creds().token, getQuote, openChart });

// ---------- credentials ----------
function tokenExpiry(t) {
  try {
    const p = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return p.exp ? p.exp * 1000 : null;
  } catch { return null; }
}
async function saveToken(token, clientId) {
  token = token.trim(); clientId = clientId.trim();
  if (token.length < 20 || !clientId) throw err("Need both client id and token", "BAD_INPUT");
  const probe = createDhanClient({ fetchFn: (...a) => fetch(...a), getCreds: async () => ({ token, clientId }) });
  try { await probe.profile(); } catch (e) { if (e instanceof TypeError) throw err("Could not reach Dhan (offline or CORS)", "NETWORK"); throw e; }
  LS.set("dhan", { token, clientId, setAt: Date.now() });
}
// Dhan tokens last 24h. Renew opportunistically on open if the token is >8h old and still valid.
async function maybeRenew() {
  const c = creds(), exp = tokenExpiry(c.token);
  if (!c.token || (exp && exp < Date.now()) || Date.now() - (c.setAt || 0) < 8 * 3600e3) return;
  try {
    const r = await client.renewToken();
    if (r?.accessToken) LS.set("dhan", { ...c, token: r.accessToken, setAt: Date.now() });
    LS.set("renew", { ok: !!r?.accessToken, at: Date.now() });
  } catch (e) { LS.set("renew", { ok: false, at: Date.now(), message: e.message }); }
}

function marketState(d = new Date()) {
  const ist = new Date(d.getTime() + (d.getTimezoneOffset() + 330) * 60000);
  const m = ist.getHours() * 60 + ist.getMinutes(), day = ist.getDay();
  return day > 0 && day < 6 && m >= 555 && m <= 930; // 09:15–15:30 IST (holidays not modelled)
}
function banner(msg) { const b = $("#banner"); b.hidden = !msg; b.textContent = msg || ""; }
function friendly(e) {
  if (e.code === "NOKEY") return "Open Settings (⚙) and add your Dhan client id + token.";
  if (/^(DH-901|80\d|NO_TOKEN)/.test(String(e.code))) return `Dhan token problem (${e.code}): paste a fresh token in Settings.`;
  return `${e.message}${e.code ? ` (${e.code})` : ""}`;
}

async function loadInst() {
  if (data.inst) return data.inst;
  try { data.inst = await (await fetch("instruments.json")).json(); } catch { data.inst = { eq: [] }; }
  return data.inst;
}

// ---------- sparklines (intraday closes of the latest session, refreshed each minute) ----------
function sparkVals(seg, id, instrument) {
  const key = `${seg}:${id}`;
  let e = sparks.get(key);
  if (!e) { e = { vals: [], at: 0, busy: false }; sparks.set(key, e); }
  if (!e.busy && Date.now() - e.at > 60000 && creds().token) {
    e.busy = true;
    fetchSpark(client, { seg, id, instrument })
      .then((c) => { e.vals = c.map((k) => k.c); })
      .catch(() => {})
      .finally(() => { e.at = Date.now(); e.busy = false; });
  }
  return e.vals;
}

// ---------- views ----------
const cAttr = (seg, id, ins, sym, name = "") => `data-c="${esc([seg, id, ins, sym, name].join("|"))}"`;
const skeleton = () => `<div class="hero"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>`;
const sec = (title, inner, right = "") => `<h3>${title}${right ? `<span class="h3r">${right}</span>` : ""}</h3>${inner}`;
const empty = (m) => `<div class="empty">${m}</div>`;

function heroCard(i) {
  const sp = sparkVals("IDX_I", i.id, "INDEX");
  return `<div class="card hc" ${cAttr("IDX_I", i.id, "INDEX", i.name)}>
    <div class="n">${esc(i.name)}</div>
    <div class="hrow"><div><div class="v">${inr(i.ltp)}</div><div class="c ${sgn(i.chg)}">${i.chg == null ? "—" : (i.chg > 0 ? "+" : "") + inr(i.chg)} · ${pct(i.pct)}</div></div>${V.spark(sp, { w: 110, h: 46, ref: i.prev, live: i.ltp })}</div>
    ${V.rangeBar(i.low, i.high, i.ltp, i.prev)}<div class="rl"><span>${inr(i.low, 0)}</span><span>day range</span><span>${inr(i.high, 0)}</span></div></div>`;
}

function stockRow(s) {
  return `<div class="row sr" ${cAttr("NSE_EQ", s.id, "EQUITY", s.sym, s.name || "")}><div class="s">${esc(s.sym)}<small>${esc(s.name || "")}</small></div><div class="mid">${V.rangeBar(s.low, s.high, s.ltp, s.prev)}</div><div class="p">${inr(s.ltp)}</div><div class="x ${sgn(s.pct)}">${pct(s.pct)}</div></div>`;
}

const moverBars = (list) => V.divBars(list.map((s) => ({ label: esc(s.sym), sub: inr(s.ltp), value: s.pct, attrs: cAttr("NSE_EQ", s.id, "EQUITY", s.sym, s.name || "") })));

const sectorsOf = (s) => s.indices.filter((i) => i.group === "sector" && i.pct != null).sort((a, b) => b.pct - a.pct);
const sectorBars = (list) => V.divBars(list.map((i) => ({ label: esc(i.name.replace("Nifty ", "")), value: i.pct, attrs: cAttr("IDX_I", i.id, "INDEX", i.name) })));

function allocation(p, n = 6) {
  const rows = p.holdings.filter((h) => (h.value || 0) > 0).sort((a, b) => b.value - a.value);
  const head = rows.slice(0, n), rest = rows.slice(n).reduce((a, h) => a + h.value, 0);
  const parts = head.map((h, i) => ({ v: h.value, color: V.C.cat[i], label: h.sym }));
  if (rest > 0) parts.push({ v: rest, color: V.C.cat[8], label: "Others" });
  const tot = parts.reduce((a, x) => a + x.v, 0) || 1;
  return { parts, tot };
}

function allocationCard(p) {
  const { parts, tot } = allocation(p);
  if (!parts.length) return "";
  return `<div class="card alloc">${V.donut(parts, { size: 132, thick: 18, center: [{ text: cr(p.summary.value).replace("₹", "") }, { text: "value" }] })}
    <div class="legend">${parts.map((x) => `<div><i style="background:${x.color}"></i><span>${esc(x.label)}</span><b>${((x.v / tot) * 100).toFixed(1)}%</b></div>`).join("")}</div></div>`;
}

const views = {
  overview() {
    const s = data.snap;
    if (!s) return skeleton();
    if (!s.indices.length) return empty("Index list not built yet: run the deploy workflow so instruments.json exists.");
    const by = (k) => s.indices.find((i) => i.key === k);
    const heroes = ["nifty50", "sensex", "banknifty", "vix"].map(by).filter((i) => i && i.ltp != null);
    const b = s.breadth, ratio = b.dec ? (b.adv / b.dec).toFixed(2) : "∞";
    const p = data.port?.summary;
    const sectors = sectorsOf(s);
    const breadth = b.total ? `<div class="card breadth">${V.donut([{ v: b.adv, color: V.C.up }, { v: b.unch, color: "#3a3a40" }, { v: b.dec, color: V.C.dn }], { size: 112, thick: 15, center: [{ text: ratio }, { text: "A/D" }] })}
      <div class="legend"><div><i style="background:${V.C.up}"></i><span>Advancing</span><b>${b.adv}</b></div><div><i style="background:#3a3a40"></i><span>Unchanged</span><b>${b.unch}</b></div><div><i style="background:${V.C.dn}"></i><span>Declining</span><b>${b.dec}</b></div><div class="note">${esc(b.universe)} · ${b.total}</div></div></div>` : "";
    const day = p && data.port.holdings.length ? `<div class="card day"><div class="n">Your day</div><div class="v ${sgn(p.dayPnl)}">${crS(p.dayPnl)}</div><div class="c ${sgn(p.pnl)}">Overall ${crS(p.pnl)} · ${pct(p.pnlPct)}</div>
      ${V.divBars(data.port.holdings.filter((h) => h.dayPnl != null).slice(0, 4).map((h) => ({ label: esc(h.sym), value: h.dayPnl, fmt: crS })), { fmt: crS })}</div>` : "";
    return `<div class="hero">${heroes.map(heroCard).join("")}</div>
      <div class="two">${sec("Market breadth", breadth || empty("—"))}${day ? sec("Portfolio today", day) : ""}</div>
      ${sec("Sector pulse", sectors.length ? sectorBars(sectors) : empty("—"), "tap for chart")}
      <div class="two"><div>${sec("Top gainers", moverBars(s.movers.gainers.slice(0, 6)))}</div><div>${sec("Top losers", moverBars(s.movers.losers.slice(0, 6)))}</div></div>`;
  },
  sectors() {
    const s = data.snap;
    if (!s) return skeleton();
    const tile = (i) => {
      const a = Math.min(Math.abs(i.pct ?? 0) / 2.5, 1) * 0.5;
      const bg = i.pct == null ? "#0b0b0c" : i.pct >= 0 ? `rgba(46,204,143,${a.toFixed(2)})` : `rgba(255,92,92,${a.toFixed(2)})`;
      return `<div class="tile" style="background:${bg}" ${cAttr("IDX_I", i.id, "INDEX", i.name)}><b>${esc(i.name.replace("Nifty ", ""))}</b><span class="${sgn(i.pct)}">${pct(i.pct)}</span>${V.spark(sparkVals("IDX_I", i.id, "INDEX"), { w: 100, h: 26, ref: i.prev, live: i.ltp })}</div>`;
    };
    const sec_ = s.indices.filter((i) => i.group === "sector").sort((a, b) => (b.pct ?? -99) - (a.pct ?? -99));
    const brd = s.indices.filter((i) => i.group !== "sector");
    return `<h2>Sectors</h2><div class="heat">${sec_.map(tile).join("")}</div>
      ${sec("Ranked", sectorBars(sectorsOf(s)))}
      ${sec("Broad market", `<div class="heat">${brd.map(tile).join("")}</div>`)}`;
  },
  movers() {
    const s = data.snap;
    if (!s) return skeleton();
    const act = s.movers.active || [];
    return `<h2>Movers</h2><div class="note">Universe: F&amp;O stocks · change vs previous close · bar = day range, marker = last price.</div>
      ${sec("Gainers", moverBars(s.movers.gainers))}${sec("Losers", moverBars(s.movers.losers))}
      ${sec("Most active (turnover)", act.map((x) => `<div class="row sr" ${cAttr("NSE_EQ", x.id, "EQUITY", x.sym, x.name || "")}><div class="s">${esc(x.sym)}<small>${turn(x.turnover)}</small></div><div class="mid">${V.rangeBar(x.low, x.high, x.ltp, x.prev)}</div><div class="p">${inr(x.ltp)}</div><div class="x ${sgn(x.pct)}">${pct(x.pct)}</div></div>`).join("") || empty("—"))}`;
  },
  portfolio() {
    const p = data.port;
    if (!p) return skeleton();
    const s = p.summary;
    const hold = p.holdings.map((h) => `<div class="row hr" ${h.seg === "NSE_EQ" || h.seg === "BSE_EQ" ? cAttr(h.seg, h.id, "EQUITY", h.sym) : ""}><div class="s">${esc(h.sym)}<small>${h.qty} @ ${inr(h.avg)} · ${pct(h.pnlPct)}</small></div><div class="mid">${V.rangeBar(h.low, h.high, h.ltp, h.ltp != null && h.pct != null ? h.ltp / (1 + h.pct / 100) : null)}</div>
      <div class="p">${inr(h.ltp)}<small class="${sgn(h.pct)}" style="display:block">${pct(h.pct)}</small></div><div class="x ${sgn(h.dayPnl)}">${h.dayPnl == null ? "—" : cr(h.dayPnl)}</div></div>`).join("");
    const pos = p.positions.map((h) => `<div class="row"><div class="s">${esc(h.sym)}<small>${esc(h.product || "")} · net ${h.netQty}</small></div><div class="p">${inr(h.ltp)}</div><div class="x ${sgn(h.total)}">${cr(h.total)}</div></div>`).join("");
    const dayBars = V.divBars(p.holdings.filter((h) => h.dayPnl != null).slice(0, 8).map((h) => ({ label: esc(h.sym), value: h.dayPnl })), { fmt: crS });
    const ovBars = V.divBars([...p.holdings].filter((h) => h.pnlPct != null).sort((a, b) => b.pnlPct - a.pnlPct).slice(0, 10).map((h) => ({ label: esc(h.sym), value: h.pnlPct })));
    return `<h2>Portfolio</h2><div class="hero">
      <div class="card"><div class="n">Value</div><div class="v">${cr(s.value)}</div><div class="c flat">Invested ${cr(s.invested)}</div>${V.stack([{ v: Math.max(s.invested, 0), color: "#3a3a40" }, { v: Math.max(s.pnl, 0), color: V.C.up }])}</div>
      <div class="card"><div class="n">Day P&amp;L</div><div class="v ${sgn(s.dayPnl)}">${crS(s.dayPnl)}</div><div class="c ${sgn(s.dayPnl)}">${s.value ? pct((s.dayPnl / s.value) * 100) : ""}</div></div>
      <div class="card"><div class="n">Overall</div><div class="v ${sgn(s.pnl)}">${crS(s.pnl)}</div><div class="c ${sgn(s.pnl)}">${pct(s.pnlPct)}</div></div></div>
      ${p.holdings.length ? sec("Allocation", allocationCard(p)) : ""}
      ${p.holdings.length ? sec("Day P&amp;L by holding", dayBars) : ""}
      ${p.holdings.length ? sec("Overall return by holding", ovBars) : ""}
      ${sec("Holdings (by day impact)", hold || empty("No holdings"))}
      ${pos ? sec("Positions", pos) : ""}
      <div class="note">Day P&amp;L = (LTP − prev close) × qty. Holdings in T+1 settlement may differ from your broker's number.</div>`;
  },
  watch() {
    const items = LS.get("watch", []);
    const q = new Map((data.watch?.items || []).map((i) => [i.id, i]));
    const rows = items.map((w) => {
      const x = q.get(Number(w.id)) || {};
      return `<div class="row sr" ${cAttr("NSE_EQ", w.id, "EQUITY", w.s, w.n || "")}><div class="s">${esc(w.s)}<small>${esc(w.n || "")}</small></div><div class="mid">${V.rangeBar(x.low, x.high, x.ltp, x.prev)}</div><div class="p">${inr(x.ltp)}</div>
        <div class="x ${sgn(x.pct)}">${pct(x.pct)} <button class="x-btn" data-rm="${w.id}" aria-label="Remove">✕</button></div></div>`;
    }).join("");
    return `<h2>Watchlist</h2><input id="q" placeholder="Search NSE symbol…" autocomplete="off" autocapitalize="characters"><div id="sug">${wlSug}</div>
      ${rows || empty("Search a symbol to add it.")}`;
  },
  settings() {
    return `<h2>Settings</h2>
    <h3>Dhan credentials</h3>
    <div class="note">Dhan client id + access token (web.dhan.co → Profile → Access DhanHQ APIs). Saved only in this browser/app and sent only to api.dhan.co. Anyone with access to this device can read it.</div>
    <input id="cid" placeholder="Dhan client id" inputmode="numeric" value="${esc(creds().clientId || "")}">
    <textarea id="tok" rows="3" placeholder="Paste access token (eyJ…)"></textarea>
    <button class="btn" id="saveTok">Validate &amp; save</button> <button class="btn ghost" id="clear">Remove</button>
    <h3>Status</h3><pre id="status" class="note" style="white-space:pre-wrap">Checking…</pre>
    <div class="note">Live data: one Dhan quote request about every second while the market is open (Dhan's limit is 1/s); every 15 s when closed. The option chain can refresh at most every 3 s.</div>`;
  },
};

async function loadStatus() {
  const el = $("#status");
  if (!el) return;
  const c = creds(), exp = tokenExpiry(c.token), ren = LS.get("renew", null);
  const lines = [c.token ? `Token saved · expires ${exp ? new Date(exp).toLocaleString("en-IN") : "unknown"}${exp && exp < Date.now() ? " (EXPIRED - paste a new one)" : ""}` : "No token saved"];
  if (ren) lines.push(`Last auto-renew: ${ren.ok ? "ok" : "failed " + (ren.message || "")} @ ${new Date(ren.at).toLocaleString("en-IN")}`);
  el.textContent = lines.join("\n");
  if (!c.token) return;
  try {
    const p = await client.profile();
    el.textContent += `\nDhan: OK · data plan ${p.dataPlan || "?"} till ${p.dataValidity || "?"}`;
  } catch (e) { el.textContent += `\nDhan: ${e instanceof TypeError ? "unreachable (offline or blocked)" : friendly(e)}`; }
}

// ---------- rendering ----------
function chrome() {
  $("#stamp").textContent = feed.at ? new Date(feed.at).toLocaleTimeString("en-IN", { hour12: false }) : "—";
  const open = marketState(), m = $("#mkt");
  m.textContent = open ? "LIVE" : "CLOSED"; m.classList.toggle("open", open);
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === tab));
}

function render() {
  if (tab === "payoff") {
    if (renderedTab !== "payoff") { $("#view").innerHTML = `<div id="pf"></div>`; renderedTab = "payoff"; pf.mount($("#pf")); }
    return chrome();
  }
  V.resetIds();
  const html = views[tab]();
  if (renderedTab !== tab) { $("#view").innerHTML = html; renderedTab = tab; if (tab === "settings") loadStatus(); }
  else if (tab !== "settings") morph($("#view"), html);
  chrome();
}

// ---------- the live feed: ONE combined quote request per cycle ----------
function wanted() {
  const w = {};
  const add = (seg, ids) => { (w[seg] ||= []).push(...ids); };
  const inst = data.inst;
  if (["overview", "sectors", "movers"].includes(tab) && inst?.indices) { add("IDX_I", inst.indices.map((i) => i.id)); add("NSE_EQ", inst.fno.map((s) => s.id)); }
  if (["overview", "portfolio"].includes(tab) && feed.book) for (const [seg, ids] of Object.entries(bookInstruments(feed.book))) add(seg, ids);
  if (tab === "watch") add("NSE_EQ", LS.get("watch", []).map((x) => x.id));
  if (tab === "payoff") { const u = pf.underlyingId(); if (u) add("IDX_I", [u]); }
  const ct = chart.target();
  if (ct) add(ct.seg, [ct.id]);
  return w;
}

async function ensureBook() {
  if (!["overview", "portfolio"].includes(tab)) return;
  if (feed.book && Date.now() - feed.bookAt < 15000) return;
  try { feed.book = await fetchBook(client); feed.bookAt = Date.now(); }
  catch (e) { if (tab === "portfolio") throw e; feed.bookAt = Date.now(); } // overview still works without the book
}

async function cycle() {
  if (tab === "settings") return;
  if (!creds().token) { banner(friendly(err("", "NOKEY"))); render(); return; }
  if (tab !== "payoff" && !data.inst) await loadInst();
  await ensureBook();
  const w = wanted();
  if (Object.keys(w).length) {
    for (const [k, v] of await client.quotes(w)) feed.quotes.set(k, v);
    feed.at = Date.now();
  }
  if (data.inst?.indices && ["overview", "sectors", "movers"].includes(tab)) data.snap = buildSnapshot(data.inst, feed.quotes);
  if (feed.book && ["overview", "portfolio"].includes(tab)) data.port = buildPortfolio(feed.book, feed.quotes);
  if (tab === "watch") data.watch = buildWatch(LS.get("watch", []), feed.quotes);
  banner("");
  render();
  chart.tick();
  if (tab === "payoff") { pf.tick(); pf.refresh(); }
}

let wake = null;
const sleepMs = (ms) => new Promise((r) => { const t = setTimeout(r, ms); wake = () => { clearTimeout(t); r(); }; });
const kick = () => { if (wake) wake(); };

async function loop() {
  for (;;) {
    if (document.hidden) { await sleepMs(500); continue; }
    const t0 = Date.now();
    let wait = marketState() || chart.target() ? 1000 : 15000;
    try { await cycle(); }
    catch (e) {
      banner(e instanceof TypeError ? "Offline or Dhan unreachable: retrying…" : friendly(e));
      wait = /DH-904|429/.test(String(e.code)) ? 5000 : 3000;
    }
    await sleepMs(Math.max(wait - (Date.now() - t0), 0));
  }
}

// ---------- events (delegated; bound once) ----------
$("#view").addEventListener("click", async (e) => {
  const rm = e.target.closest("[data-rm]");
  if (rm) { LS.set("watch", LS.get("watch", []).filter((x) => String(x.id) !== rm.dataset.rm)); data.watch = buildWatch(LS.get("watch", []), feed.quotes); return render(); }
  const sg = e.target.closest("#sug [data-id]");
  if (sg) {
    const w = LS.get("watch", []);
    if (!w.some((x) => String(x.id) === sg.dataset.id) && w.length < 100) w.push({ id: Number(sg.dataset.id), s: sg.dataset.s, n: sg.dataset.n });
    LS.set("watch", w); wlSug = ""; const q = $("#q"); if (q) q.value = ""; render(); return kick();
  }
  if (e.target.closest("#saveTok")) {
    try { await saveToken($("#tok").value, $("#cid").value); $("#tok").value = ""; banner(""); loadStatus(); kick(); } catch (er) { banner(friendly(er)); }
    return;
  }
  if (e.target.closest("#clear")) { LS.set("dhan", { token: "", clientId: "" }); feed.quotes.clear(); feed.book = null; data.snap = data.port = data.watch = null; loadStatus(); return; }
  const c = e.target.closest("[data-c]");
  if (c) { const [seg, id, instrument, sym, name] = c.dataset.c.split("|"); openChart({ seg, id, instrument, sym, name }); }
});

$("#view").addEventListener("input", async (e) => {
  if (e.target.id !== "q") return;
  const t = e.target.value.trim().toUpperCase();
  if (t.length < 2) { wlSug = ""; return render(); }
  const eq = (await loadInst()).eq || [];
  const hits = eq.filter((x) => x[1].startsWith(t)).slice(0, 6).concat(eq.filter((x) => !x[1].startsWith(t) && x[2].toUpperCase().includes(t)).slice(0, 4)).slice(0, 8);
  wlSug = hits.length ? `<div class="sug">${hits.map((x) => `<div data-id="${x[0]}" data-s="${esc(x[1])}" data-n="${esc(x[2])}">${esc(x[1])} <small class="flat">${esc(x[2])}</small></div>`).join("")}</div>` : "";
  render();
});

$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  tab = b.dataset.t; LS.set("tab", tab); banner(""); render(); kick();
});
$("#refresh").addEventListener("click", kick);
document.addEventListener("visibilitychange", () => { if (!document.hidden) kick(); });

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
maybeRenew().finally(() => { render(); loop(); });
