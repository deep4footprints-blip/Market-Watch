import { createDhanClient, buildSnapshot, loadPortfolio, loadWatch } from "./dhan.js";
import { createPayoff } from "./payoff-ui.js";

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

let tab = LS.get("tab", "overview");
let data = { snap: null, port: null, watch: null, inst: null };
let timer = null, busy = false;

const creds = () => LS.get("dhan", { token: "", clientId: "" });
const client = createDhanClient({ fetchFn: (...a) => fetch(...a), getCreds: async () => creds() });
const pf = createPayoff({ client, LS, getInst: () => loadInst(), friendly: (e) => friendly(e), hasCreds: () => !!creds().token });
const err = (message, code) => Object.assign(new Error(message), { code });

// Decode the JWT expiry (Dhan access tokens are JWTs). Returns ms epoch or null.
function tokenExpiry(t) {
  try {
    const p = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return p.exp ? p.exp * 1000 : null;
  } catch { return null; }
}

// Everything runs in the browser, straight against api.dhan.co. Nothing is sent anywhere else.
async function api(path, opts = {}) {
  if (!creds().token) throw err("Add your Dhan client id and token in Settings", "NOKEY");
  try {
    if (path === "/api/snapshot") {
      const inst = await loadInst();
      if (!inst.indices) throw err("instruments.json missing - the deploy build did not produce it", "NO_INSTRUMENTS");
      const q = await client.quotes({ IDX_I: inst.indices.map((i) => i.id), NSE_EQ: inst.fno.map((x) => x.id) });
      return buildSnapshot(inst, q);
    }
    if (path === "/api/portfolio") return await loadPortfolio(client);
    if (path === "/api/watch") return await loadWatch(client, JSON.parse(opts.body).items);
    throw err("Unknown call", "NOT_FOUND");
  } catch (e) {
    if (e instanceof TypeError) throw err("Could not reach Dhan from the browser: offline, or Dhan blocks browser (CORS) calls. If it is CORS, use the Android app build (see README).", "NETWORK");
    throw e;
  }
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

function banner(msg) {
  const b = $("#banner");
  b.hidden = !msg;
  b.textContent = msg || "";
}

function friendly(e) {
  if (e.code === "NOKEY") return "Open Settings (⚙) and add your Dhan client id + token.";
  if (/^(DH-901|80\d|NO_TOKEN)/.test(String(e.code))) return `Dhan token problem (${e.code}): paste a fresh token in Settings.`;
  return `${e.message}${e.code ? ` (${e.code})` : ""}`;
}

async function refresh() {
  if (tab === "payoff") { pf.refresh(); return; }
  if (busy || tab === "settings") return;
  busy = true;
  try {
    if (["overview", "sectors", "movers"].includes(tab)) data.snap = await api("/api/snapshot");
    if (tab === "overview" || tab === "portfolio") data.port = await api("/api/portfolio").catch((e) => { if (tab === "portfolio") throw e; return data.port; });
    if (tab === "watch") data.watch = await api("/api/watch", { method: "POST", body: JSON.stringify({ items: LS.get("watch", []) }) });
    banner("");
  } catch (e) { banner(friendly(e)); }
  busy = false;
  render();
}

function schedule() {
  clearInterval(timer);
  const open = marketState();
  timer = setInterval(() => { if (!document.hidden) refresh(); }, open ? 6000 : 60000);
}

function chip(q) {
  return `<span class="${sgn(q.pct)}">${pct(q.pct)}</span>`;
}

function idxCard(i) {
  return `<div class="card"><div class="n">${esc(i.name)}</div><div class="v">${inr(i.ltp)}</div>
  <div class="c ${sgn(i.chg)}">${i.chg == null ? "—" : (i.chg > 0 ? "+" : "") + inr(i.chg)} · ${pct(i.pct)}</div></div>`;
}

function breadthBar(b) {
  if (!b || !b.total) return "";
  const a = (b.adv / b.total) * 100, d = (b.dec / b.total) * 100;
  return `<h3>Breadth · ${esc(b.universe)} (${b.total})</h3>
  <div class="bar"><i style="width:${a}%;background:var(--up)"></i><i style="width:${100 - a - d}%;background:#333"></i><i style="width:${d}%;background:var(--dn)"></i></div>
  <div class="note"><span class="up">${b.adv} up</span> · <span class="dn">${b.dec} down</span> · ${b.unch} flat</div>`;
}

function moverRows(list) {
  return list.length ? list.map((s) => `<div class="row"><div class="s">${esc(s.sym)}<small>${esc(s.name || "")}</small></div><div class="p">${inr(s.ltp)}</div><div class="x ${sgn(s.pct)}">${pct(s.pct)}</div></div>`).join("")
    : `<div class="empty">None</div>`;
}

const views = {
  overview() {
    const s = data.snap;
    if (!s) return skeleton();
    const by = (k) => s.indices.find((i) => i.key === k);
    const heroes = ["nifty50", "sensex", "banknifty", "vix"].map(by).filter((i) => i && i.ltp != null);
    const p = data.port?.summary;
    const sectors = s.indices.filter((i) => i.group === "sector" && i.pct != null).sort((a, b) => b.pct - a.pct);
    return `<div class="hero">${heroes.map(idxCard).join("")}</div>
    ${breadthBar(s.breadth)}
    ${p ? `<h3>Your day</h3><div class="card"><div class="n">Holdings · day P&amp;L</div><div class="v ${sgn(p.dayPnl)}">${cr(p.dayPnl)}</div>
      <div class="c flat">Total ${cr(p.pnl)} (${pct(p.pnlPct)}) on ${cr(p.invested)}</div></div>` : ""}
    <div class="two"><div><h3>Leading sectors</h3>${sectors.slice(0, 3).map((i) => `<div class="row"><div class="s">${esc(i.name)}</div><div></div><div class="x ${sgn(i.pct)}">${pct(i.pct)}</div></div>`).join("") || '<div class="empty">—</div>'}</div>
    <div><h3>Lagging sectors</h3>${sectors.slice(-3).reverse().map((i) => `<div class="row"><div class="s">${esc(i.name)}</div><div></div><div class="x ${sgn(i.pct)}">${pct(i.pct)}</div></div>`).join("") || '<div class="empty">—</div>'}</div></div>
    <div class="two"><div><h3>Top gainers</h3>${moverRows(s.movers.gainers.slice(0, 5))}</div><div><h3>Top losers</h3>${moverRows(s.movers.losers.slice(0, 5))}</div></div>`;
  },
  sectors() {
    const s = data.snap;
    if (!s) return skeleton();
    const tile = (i) => {
      const a = Math.min(Math.abs(i.pct ?? 0) / 2.5, 1) * 0.55;
      const bg = i.pct == null ? "#0b0b0c" : i.pct >= 0 ? `rgba(46,204,143,${a})` : `rgba(255,92,92,${a})`;
      return `<div class="tile" style="background:${bg}"><b>${esc(i.name.replace("Nifty ", ""))}</b><span class="${sgn(i.pct)}">${pct(i.pct)}</span></div>`;
    };
    const sec = s.indices.filter((i) => i.group === "sector").sort((a, b) => (b.pct ?? -99) - (a.pct ?? -99));
    const brd = s.indices.filter((i) => i.group !== "sector");
    return `<h2>Sectors</h2><div class="heat">${sec.map(tile).join("")}</div>
    <h3>Broad market</h3><div class="heat">${brd.map(tile).join("")}</div>`;
  },
  movers() {
    const s = data.snap;
    if (!s) return skeleton();
    return `<h2>Movers</h2><div class="note">Universe: F&amp;O stocks, vs previous close.</div>
    <h3>Gainers</h3>${moverRows(s.movers.gainers)}<h3>Losers</h3>${moverRows(s.movers.losers)}`;
  },
  portfolio() {
    const p = data.port;
    if (!p) return skeleton();
    const s = p.summary;
    const hold = p.holdings.map((h) => `<div class="row"><div class="s">${esc(h.sym)}<small>${h.qty} @ ${inr(h.avg)} · ${pct(h.pnlPct)} overall</small></div>
      <div class="p">${inr(h.ltp)}<small class="${sgn(h.pct)}" style="display:block">${pct(h.pct)}</small></div><div class="x ${sgn(h.dayPnl)}">${h.dayPnl == null ? "—" : cr(h.dayPnl)}</div></div>`).join("");
    const pos = p.positions.map((h) => `<div class="row"><div class="s">${esc(h.sym)}<small>${esc(h.product || "")} · net ${h.netQty}</small></div><div class="p">${inr(h.ltp)}</div><div class="x ${sgn(h.total)}">${cr(h.total)}</div></div>`).join("");
    return `<h2>Portfolio</h2><div class="hero">
      <div class="card"><div class="n">Value</div><div class="v">${cr(s.value)}</div><div class="c flat">Invested ${cr(s.invested)}</div></div>
      <div class="card"><div class="n">Day P&amp;L</div><div class="v ${sgn(s.dayPnl)}">${cr(s.dayPnl)}</div></div>
      <div class="card"><div class="n">Overall</div><div class="v ${sgn(s.pnl)}">${cr(s.pnl)}</div><div class="c ${sgn(s.pnl)}">${pct(s.pnlPct)}</div></div></div>
    <h3>Holdings (by day impact)</h3>${hold || '<div class="empty">No holdings</div>'}
    ${pos ? `<h3>Positions</h3>${pos}` : ""}
    <div class="note">Day P&amp;L = (LTP − prev close) × qty. Holdings in T+1 settlement may differ from your broker's number.</div>`;
  },
  watch() {
    const items = LS.get("watch", []);
    const q = new Map((data.watch?.items || []).map((i) => [i.id, i]));
    const rows = items.map((w) => {
      const x = q.get(Number(w.id)) || {};
      return `<div class="row"><div class="s">${esc(w.s)}<small>${esc(w.n || "")}</small></div><div class="p">${inr(x.ltp)}</div>
      <div class="x ${sgn(x.pct)}">${pct(x.pct)} <button class="x-btn" data-rm="${w.id}" aria-label="Remove">✕</button></div></div>`;
    }).join("");
    return `<h2>Watchlist</h2><input id="q" placeholder="Search NSE symbol…" autocomplete="off" autocapitalize="characters"><div id="sug"></div>
    ${rows || '<div class="empty">Search a symbol to add it.</div>'}`;
  },
  payoff() { return `<div id="pf"></div>`; },
  settings() {
    return `<h2>Settings</h2>
    <h3>Dhan credentials</h3>
    <div class="note">Dhan client id + access token (web.dhan.co → Profile → Access DhanHQ APIs). Saved only in this browser/app and sent only to api.dhan.co. Anyone with access to this device can read it.</div>
    <input id="cid" placeholder="Dhan client id" inputmode="numeric" value="${esc(creds().clientId || "")}">
    <textarea id="tok" rows="3" placeholder="Paste access token (eyJ…)"></textarea>
    <button class="btn" id="saveTok">Validate &amp; save</button> <button class="btn ghost" id="clear">Remove</button>
    <h3>Status</h3><pre id="status" class="note" style="white-space:pre-wrap">Checking…</pre>`;
  },
};

function skeleton() { return `<div class="hero"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>`; }

async function loadInst() {
  if (data.inst) return data.inst;
  try { data.inst = await (await fetch("instruments.json")).json(); } catch { data.inst = { eq: [] }; }
  return data.inst;
}

function bind() {
  if (tab === "watch") {
    const q = $("#q");
    q?.addEventListener("input", async () => {
      const t = q.value.trim().toUpperCase();
      if (t.length < 2) { $("#sug").innerHTML = ""; return; }
      const eq = (await loadInst()).eq || [];
      const hits = eq.filter((e) => e[1].startsWith(t)).slice(0, 6).concat(eq.filter((e) => !e[1].startsWith(t) && e[2].toUpperCase().includes(t)).slice(0, 4)).slice(0, 8);
      $("#sug").innerHTML = hits.length ? `<div class="sug">${hits.map((e) => `<div data-id="${e[0]}" data-s="${esc(e[1])}" data-n="${esc(e[2])}">${esc(e[1])} <small class="flat">${esc(e[2])}</small></div>`).join("")}</div>` : "";
    });
    $("#sug")?.addEventListener("click", (ev) => {
      const d = ev.target.closest("[data-id]");
      if (!d) return;
      const w = LS.get("watch", []);
      if (!w.some((x) => String(x.id) === d.dataset.id) && w.length < 100) w.push({ id: Number(d.dataset.id), s: d.dataset.s, n: d.dataset.n });
      LS.set("watch", w); data.watch = null; refresh(); render();
    });
    document.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => {
      LS.set("watch", LS.get("watch", []).filter((x) => String(x.id) !== b.dataset.rm)); render(); refresh();
    }));
  }
  if (tab === "payoff") pf.mount($("#pf"));
  if (tab === "settings") {
    $("#saveTok").onclick = async () => {
      try { await saveToken($("#tok").value, $("#cid").value); $("#tok").value = ""; banner(""); loadStatus(); }
      catch (e) { banner(friendly(e)); }
    };
    $("#clear").onclick = () => { LS.set("dhan", { token: "", clientId: "" }); data = { snap: null, port: null, watch: null, inst: data.inst }; loadStatus(); };
    loadStatus();
  }
}

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
  } catch (e) { el.textContent += `\nDhan: ${friendly(e)}`; }
}

function render() {
  $("#view").innerHTML = views[tab]();
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === tab));
  const asOf = data.snap?.asOf;
  $("#stamp").textContent = asOf ? new Date(asOf).toLocaleTimeString("en-IN", { hour12: false }) : "—";
  const open = marketState();
  const m = $("#mkt"); m.textContent = open ? "LIVE" : "CLOSED"; m.classList.toggle("open", open);
  bind();
}

$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  tab = b.dataset.t; LS.set("tab", tab); banner(""); maybeRenew().finally(() => { render(); refresh(); schedule(); });
});
$("#refresh").addEventListener("click", refresh);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
maybeRenew().finally(() => { render(); refresh(); schedule(); });
