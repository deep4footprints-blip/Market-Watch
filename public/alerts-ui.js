// "Alerts" tab + the engine glue. Live rules run each quote cycle while the app is open; EOD rules run after history/analytics refresh.
// IMPORTANT limits shown to the user: alerts do not fire when the app is closed (no backend yet) and EOD rules are end-of-day signals.
import { KINDS, validate, runAlerts, describe, inQuiet } from "./alerts.js";
import { esc, fin, selectRow, inputRow, note, dstr } from "./ui-kit.js";
import { PATTERN_IDS, PATTERNS } from "./patterns.js";

export function createAlerts({ LS, getInst, getQuote, getResearch, getHits = () => [], getPcr = () => null, onEvents = () => {} }) {
  const S = { root: null, rules: LS.get("alerts", []), log: LS.get("alertlog", []), quiet: LS.get("alertquiet", { on: false, from: 22 * 60, to: 7 * 60 }), kind: "priceAbove", sug: [], pick: null, msg: "" };
  const persist = () => { LS.set("alerts", S.rules); LS.set("alertlog", S.log.slice(0, 200)); };
  const idOf = (r) => String(r.key || "").split(":")[1];

  const ctxLive = (r) => {
    if (r.kind.startsWith("pcr")) return { pcr: getPcr() };
    const q = getQuote(...String(r.key).split(":")); return q ? { ltp: q.ltp, pct: q.pct } : null;
  };
  const ctxEod = (r) => {
    const R = getResearch(); if (!R) return null;
    if (r.kind.startsWith("regime")) return { regime: R.regime };
    const row = R.rows.get(r.sym); if (!row) return null;
    return { stage: row.stage?.stage, prevStage: row.stage5?.stage, rs: row.rs, tt: row.tt?.passed, patterns: getHits().filter((h) => h.sym === r.sym) };
  };
  function run(cls, ctxFor, asOf) {
    const res = runAlerts(S.rules, cls, ctxFor, Date.now(), asOf);
    S.rules = res.rules;
    const ev = res.events.filter(() => true);
    if (ev.length) { S.log = [...ev, ...S.log]; onEvents(ev.filter(() => !inQuiet(Date.now(), S.quiet)), ev); }
    if (ev.length || cls === "eod") persist();
    if (ev.length && S.root) paint();
  }
  const state = (r) => (!r.active ? (r.firedAt && r.repeat === "once" ? "Triggered" : "Paused") : r.expires && Date.now() > r.expires ? "Expired" : "Active");

  function paint() {
    const k = KINDS[S.kind];
    const cond = k.fields.map((f) => f === "pattern" ? selectRow("Pattern", "al-pattern", PATTERN_IDS.map((i) => [i, PATTERNS[i].name]), "vcp") : f === "state" ? selectRow("State", "al-state", [["breakout", "Breakout"], ["near_trigger", "Near trigger"], ["forming", "Forming"]], "breakout") : f === "stage" ? selectRow("Stage", "al-stage", [[1, 1], [2, 2], [3, 3], [4, 4]], 2) : inputRow(f === "pct" ? "Percent" : "Level", `al-${f}`, "", { step: "any", w: "90px" })).join("");
    const needSym = !["regimeBelow", "regimeAbove", "pcrAbove", "pcrBelow"].includes(S.kind);
    S.root.innerHTML = `<h2>Alerts</h2>${note("<b>Limits:</b> there is no server yet, so alerts are checked only while this app is open. <b>Live</b> rules use ~1-second REST quote polling (not a tick stream). <b>EOD</b> rules use completed daily bars and are re-checked after the Research history refresh; they are end-of-day signals, never intraday ones. Push/email delivery needs a backend.")}
      ${S.msg ? `<div class="banner-inline">${esc(S.msg)}</div>` : ""}
      <div class="card"><div class="n">New alert</div><div class="rs-f">${selectRow("Type", "al-kind", Object.entries(KINDS).map(([k, v]) => [k, `${v.label} (${v.cls.toUpperCase()})`]), S.kind)}
        ${needSym ? `<label class="fld">Symbol<input id="al-sym" placeholder="e.g. RELIANCE" value="${esc(S.pick?.s || "")}" autocomplete="off" style="width:140px"></label>` : ""}${cond}
        <label class="fld">Repeat<select id="al-rep"><option value="once">Once</option><option value="recurring">Recurring (cooldown)</option></select></label>${inputRow("Cooldown min", "al-cd", 60, { w: "70px" })}${inputRow("Expires in days", "al-exp", "", { w: "70px" })}
        <button class="btn" data-act="add">Add</button></div><div id="al-sug" class="sug">${S.sug.map((x) => `<div data-id="${x[0]}" data-s="${esc(x[1])}">${esc(x[1])} <small class="flat">${esc(x[2])}</small></div>`).join("")}</div></div>
      <h3>Rules (${S.rules.length})</h3>${S.rules.map((r) => `<div class="row"><div class="s">${esc(describe(r))}<small>${KINDS[r.kind].cls.toUpperCase()} · ${r.repeat}${r.fireCount ? ` · fired ${r.fireCount}×` : ""}${r.expires ? ` · exp ${dstr(r.expires / 1000)}` : ""}</small></div><div class="p">${state(r)}</div><div class="x"><button class="x-btn" data-pause="${r.id}">${r.active ? "⏸" : "▶"}</button><button class="x-btn" data-del="${r.id}">✕</button></div></div>`).join("") || `<div class="empty">No alerts.</div>`}
      <h3>Trigger history</h3>${S.log.slice(0, 40).map((e) => `<div class="row"><div class="s">${esc(e.message)}<small>${e.cls === "eod" ? `EOD signal · data as of ${e.asOf ? dstr(e.asOf) : "—"}` : "Live"} · ${new Date(e.t).toLocaleString("en-IN", { hour12: false })}</small></div></div>`).join("") || `<div class="empty">Nothing has triggered.</div>`}
      <h3>Quiet hours (IST)</h3><div class="rs-f"><label class="fld"><input type="checkbox" id="al-q" ${S.quiet.on ? "checked" : ""}> Mute notifications</label>${inputRow("From (HH)", "al-qf", S.quiet.from / 60, { step: 1, min: 0, max: 24, w: "60px" })}${inputRow("To (HH)", "al-qt", S.quiet.to / 60, { step: 1, min: 0, max: 24, w: "60px" })}<button class="btn ghost" data-act="notif">Enable browser notifications</button></div>${note("Muted alerts are still logged above, just not announced.")}`;
  }
  return {
    mount(el) {
      S.root = el; paint();
      el.addEventListener("change", (e) => {
        if (e.target.id === "al-kind") { S.kind = e.target.value; S.pick = null; S.msg = ""; return paint(); }
        if (e.target.id === "al-q" || e.target.id === "al-qf" || e.target.id === "al-qt") { S.quiet = { on: el.querySelector("#al-q").checked, from: Math.round(+el.querySelector("#al-qf").value * 60), to: Math.round(+el.querySelector("#al-qt").value * 60) }; LS.set("alertquiet", S.quiet); }
      });
      el.addEventListener("input", async (e) => {
        if (e.target.id !== "al-sym") return; const t = e.target.value.trim().toUpperCase(); S.pick = null;
        const eq = (await getInst()).eq || [], hits = t.length >= 2 ? eq.filter((x) => x[1].startsWith(t)).slice(0, 6) : []; S.sug = hits;
        el.querySelector("#al-sug").innerHTML = hits.map((x) => `<div data-id="${x[0]}" data-s="${esc(x[1])}">${esc(x[1])} <small class="flat">${esc(x[2])}</small></div>`).join("");
      });
      el.addEventListener("click", (e) => {
        const sg = e.target.closest("#al-sug [data-id]"); if (sg) { S.pick = { id: sg.dataset.id, s: sg.dataset.s }; S.sug = []; el.querySelector("#al-sym").value = S.pick.s; el.querySelector("#al-sug").innerHTML = ""; return; }
        const p = e.target.closest("[data-pause]")?.dataset.pause, d = e.target.closest("[data-del]")?.dataset.del;
        if (p) { S.rules = S.rules.map((r) => (r.id === p ? { ...r, active: !r.active, firedAt: r.repeat === "once" && !r.active ? null : r.firedAt } : r)); persist(); return paint(); }
        if (d) { S.rules = S.rules.filter((r) => r.id !== d); persist(); return paint(); }
        const a = e.target.closest("[data-act]")?.dataset.act;
        if (a === "notif" && "Notification" in window) return Notification.requestPermission();
        if (a === "add") {
          const k = KINDS[S.kind], v = (id) => el.querySelector(id)?.value ?? "", params = {};
          for (const f of k.fields) params[f] = v(`#al-${f}`);
          const needSym = !["regimeBelow", "regimeAbove", "pcrAbove", "pcrBelow"].includes(S.kind);
          const sym = needSym ? v("#al-sym").trim().toUpperCase() : "";
          const seg = "NSE_EQ", key = needSym ? (S.pick ? `${seg}:${S.pick.id}` : "") : "";
          const rule = { id: `al${Date.now()}`, kind: S.kind, sym: sym || (needSym ? "" : "Market"), key, params, repeat: v("#al-rep"), cooldownMin: +v("#al-cd") || 60, active: true, createdAt: Date.now(), expires: +v("#al-exp") > 0 ? Date.now() + +v("#al-exp") * 864e5 : null };
          const err = validate(rule); if (err) { S.msg = `Cannot add: ${err}.`; return paint(); }
          if (needSym && KINDS[S.kind].cls === "eod" && !getResearch()?.rows.has(rule.sym)) rule.note = "symbol not in the F&O research universe: will not evaluate";
          S.rules = [...S.rules, rule]; persist(); S.msg = rule.note || ""; S.pick = null; paint();
        }
      });
    },
    runLive: () => { if (S.rules.some((r) => r.active && KINDS[r.kind]?.cls === "live")) run("live", ctxLive); },
    runEod: (asOf) => { if (S.rules.some((r) => r.active && KINDS[r.kind]?.cls === "eod")) run("eod", ctxEod, asOf); },
    rules: () => S.rules,
  };
}
