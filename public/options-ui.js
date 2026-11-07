// "Options" tab: chain analytics (PCR, max pain, ATM straddle, OI levels, smile/skew, GEX estimate) and spread scanners on Dhan's live chain.
import { pcr, maxPain, atmStraddle } from "./analytics.js";
import { scan, oiLevels, smile, gex, gammaFlip, SCANNERS, GEX_SCENARIOS } from "./optionlab.js";
import { expectedMove } from "./calc.js";
import * as V from "./viz.js";
import { esc, fin, pc, num, inr, cls, clsAbs, selectRow, inputRow, metric, note, disclaimer } from "./ui-kit.js";

const UND = { nifty50: { name: "Nifty 50", id: 13, seg: "IDX_I", lotKey: "NIFTY", lot: 65 }, sensex: { name: "Sensex", id: 51, seg: "IDX_I", lotKey: "SENSEX", lot: 20 } };
const GEX_LABEL = { conv: "Calls +, puts − (classic assumption)", allLong: "All long gamma (upper bound)", inverse: "Calls −, puts + (opposite assumption)" };
const tYears = (exp) => Math.max(0, (Date.parse(`${exp}T15:30:00+05:30`) - Date.now()) / (365 * 864e5));

export function createOptions({ client, LS, getInst, hasCreds, friendly }) {
  const S = { root: null, und: LS.get("optUnd", "nifty50"), expiries: [], expiry: null, chain: null, at: 0, busy: false, msg: "", gexSc: LS.get("optGex", "conv"), sc: { kind: "vertical", span: 8, width: 2, ratio: 3, minOi: 0, maxSpreadPct: 100, ...LS.get("optScan", {}) }, scanRes: null, lot: null };
  const U = () => UND[S.und];

  async function loadExpiries() {
    if (!hasCreds()) { S.msg = friendly({ code: "NOKEY" }); return paint(); }
    S.busy = true; S.msg = "Loading expiries (Dhan limits the option chain to 1 request / 3 s)…"; paint();
    try { S.expiries = await client.expiryList(U().id, U().seg); S.expiry = S.expiries.find((e) => e >= new Date().toISOString().slice(0, 10)) || S.expiries[0] || null; S.msg = S.expiry ? "" : "No expiries returned."; }
    catch (e) { S.msg = friendly(e); }
    S.busy = false; paint(); if (S.expiry) return loadChain();
  }
  async function loadChain() {
    S.busy = true; S.msg = "Loading option chain…"; paint();
    try { const inst = await getInst(); S.lot = inst.lots?.[U().lotKey] || U().lot; S.chain = await client.optionChain(U().id, U().seg, S.expiry); S.at = Date.now(); S.scanRes = null; S.msg = S.chain.rows.length ? "" : "Empty chain returned."; }
    catch (e) { S.msg = friendly(e); }
    S.busy = false; paint();
  }
  function runScan() { if (S.chain) { S.scanRes = scan(S.chain, S.lot, S.sc); paint(); } }

  function summary() {
    const c = S.chain, T = tYears(S.expiry), days = T * 365;
    const p = pcr(c), mp = maxPain(c), st = atmStraddle(c), lv = oiLevels(c, 3), sm = smile(c);
    const ivAtm = c.atmIv, em = ivAtm ? expectedMove(c.spot, ivAtm, days) : null;
    const near = c.rows.filter((r) => Math.abs(r.strike - c.atm) <= (c.step || 50) * 14);
    const oiChart = V.pairBars(near.map((r) => ({ x: r.strike, a: r.ce?.oi || 0, b: r.pe?.oi || 0 })), { w: 340, h: 120, mark: c.atm, fmtX: (x) => x });
    const dOi = [...c.rows.flatMap((r) => [{ s: r.strike, t: "CE", d: (r.ce?.oi || 0) - (r.ce?.prevOi || 0) }, { s: r.strike, t: "PE", d: (r.pe?.oi || 0) - (r.pe?.prevOi || 0) }])].filter((x) => x.d);
    const up = [...dOi].sort((a, b) => b.d - a.d).slice(0, 4), dn = [...dOi].sort((a, b) => a.d - b.d).slice(0, 4);
    return `<div class="hero">
      <div class="card"><div class="n">${U().name} · ${esc(S.expiry)} · ${days.toFixed(1)}d</div><div class="v">${num(c.spot)}</div><div class="note">ATM ${c.atm} · ATM IV ${fin(ivAtm) ? (ivAtm * 100).toFixed(1) + "%" : "—"} · lot ${S.lot}</div></div>
      <div class="card"><div class="n">ATM straddle</div><div class="v">${st ? num(st.prem) : "—"}</div><div class="note">${st ? `${pc(st.movePct)} of spot · range ${num(st.lo, 0)}–${num(st.hi, 0)} · ₹${num(st.prem * S.lot, 0)}/lot` : "no ATM quotes"}. IV-based 1σ move: ${em ? "±" + num(em, 0) : "—"}. Rough, distribution-free estimates.</div></div>
      <div class="card"><div class="n">PCR</div><div class="v">${fin(p.oi) ? p.oi.toFixed(2) : "—"} <small class="flat" style="font-size:13px">OI</small></div><div class="note">Volume PCR ${fin(p.vol) ? p.vol.toFixed(2) : "—"} · put OI ${num(p.putOi, 0)} / call OI ${num(p.callOi, 0)} · all listed strikes, this expiry only</div></div>
      <div class="card"><div class="n">Max pain</div><div class="v">${mp ? mp.strike : "—"}</div><div class="note">${mp ? `${pc(mp.strike / c.spot - 1)} from spot. ` : ""}Strike minimising aggregate payout to option buyers by OI. Descriptive; it does not predict settlement.</div></div></div>
      <h3>Open interest by strike (calls <span class="up">■</span> puts <span class="dn">■</span>)</h3><div class="card">${oiChart}
        <div class="note">Largest call OI (resistance-like): ${lv.calls.map((x) => `${x.strike} (${num(x.oi, 0)})`).join(", ")} · Largest put OI (support-like): ${lv.puts.map((x) => `${x.strike} (${num(x.oi, 0)})`).join(", ")}. Positions are exchange OI; who is long or short is not observable here.</div>
        <div class="note">Biggest OI added: ${up.map((x) => `${x.s}${x.t} +${num(x.d, 0)}`).join(", ") || "—"} · biggest OI cut: ${dn.map((x) => `${x.s}${x.t} ${num(x.d, 0)}`).join(", ") || "—"} (vs previous close per Dhan)</div></div>
      <h3>IV smile (OTM options)</h3><div class="card">${V.line(sm.pts.map((q) => ({ x: q.strike, y: q.iv * 100 })), { mark: c.spot, xfmt: (x) => x })}<div class="note">${fin(sm.skew5) ? `5% wing skew (put IV − call IV): ${sm.skew5.toFixed(1)} vol pts` : "Skew needs IV on both wings."} Surface/term-structure views need several expiries; the chain loads one at a time, so only a single-expiry smile is shown.</div></div>`;
  }
  function gexView() {
    const c = S.chain, T = tYears(S.expiry), g = gex(c, S.lot, T, S.gexSc), flip = gammaFlip(c, S.lot, T, S.gexSc);
    const near = g.rows.filter((r) => Math.abs(r.strike - c.atm) <= (c.step || 50) * 12);
    const sc = (v) => v / 1e7;
    return `<h3>Gamma exposure (estimate)</h3><div class="card">
      ${selectRow("Sign scenario", "ox-gex", Object.entries(GEX_LABEL), S.gexSc)}
      <div class="mtrs">${metric("Net GEX / 1% move", `₹${num(sc(g.net), 1)} Cr`, clsAbs(g.net))}${metric("Call GEX", `₹${num(sc(g.callTotal), 1)} Cr`)}${metric("Put GEX", `₹${num(sc(g.putTotal), 1)} Cr`)}${metric("Gamma flip (est.)", flip ? num(flip, 0) : "none within ±10%")}</div>
      ${V.pairBars(near.map((r) => ({ x: r.strike, a: Math.max(r.net, 0), b: Math.max(-r.net, 0) })), { w: 340, h: 110, mark: c.atm })}
      <div class="note"><b>This is a model estimate, not observed dealer inventory.</b> Indian exchange data shows open interest, not who holds each side, so the sign of each strike's gamma is an assumption (pick a scenario above and compare). gex = gamma × OI × lot × spot² × 1%. Gamma is Dhan's greek where provided, else Black-Scholes from each option's IV. Single expiry only; flip re-prices all options on a ±10% spot grid.</div></div>`;
  }
  function scanner() {
    const s = S.sc;
    const rows = (S.scanRes || []).slice(0, 40).map((r) => `<tr><td style="text-align:left"><b>${esc(r.label)}</b><small>${r.legs.map((l) => `${l.side > 0 ? "B" : "S"} ${l.qty}× ${l.strike}${l.type} @${num(l.px)}${l.src === "ltp" ? "*" : ""}`).join(" · ")}</small></td><td class="${clsAbs(-r.debit)}">${r.debit >= 0 ? "-" : "+"}${inr(Math.abs(r.debit))}</td><td class="up">${r.maxProfit === Infinity ? "∞" : inr(r.maxProfit)}</td><td class="dn">${r.maxLoss === -Infinity ? "unlimited" : inr(r.maxLoss)}</td><td>${fin(r.rr) ? r.rr.toFixed(2) : "—"}</td><td>${r.breakevens.join(", ") || "—"}</td><td>${fin(r.worstSpreadPct) ? r.worstSpreadPct.toFixed(1) + "%" : "—"}</td></tr>`).join("");
    return `<h3>Spread scanner</h3><div class="card"><div class="rs-f">${selectRow("Type", "os-kind", Object.entries(SCANNERS), s.kind)}${inputRow("± strikes", "os-span", s.span, { min: 2, max: 20, step: 1, w: "56px" })}${inputRow("Width (steps)", "os-width", s.width, { min: 1, max: 10, step: 1, w: "56px" })}${inputRow("Max ratio", "os-ratio", s.ratio, { min: 2, max: 5, step: 1, w: "56px" })}${inputRow("Min OI", "os-oi", s.minOi, { min: 0, w: "80px" })}${inputRow("Max bid-ask %", "os-sp", s.maxSpreadPct, { min: 0, w: "60px" })}<button class="btn" data-act="scan">Scan</button></div>
      ${S.scanRes ? `<div class="tw"><table class="rs-t"><thead><tr><th style="text-align:left">Structure (per lot ${S.lot})</th><th>Net</th><th>Max profit</th><th>Max loss</th><th>R:R</th><th>Breakevens</th><th>Worst bid-ask</th></tr></thead><tbody>${rows || `<tr><td colspan="7" class="empty">No structures pass these filters.</td></tr>`}</tbody></table></div>` : ""}
      ${note("Net: − = debit paid, + = credit received, per lot, expiry payoff (premiums included, charges and margin excluded). Buys priced at ask and sells at bid when both sides are quoted; * = LTP fallback. A theoretical spread price is not necessarily executable: check depth, bid-ask and margin at your broker. Ranked by reward:risk; a high ratio on illiquid strikes is usually a data artifact. Cross-contract and commodity spreads are not available (this app only loads Nifty/Sensex chains).")}</div>`;
  }
  function chainTable() {
    const c = S.chain, near = c.rows.filter((r) => Math.abs(r.strike - c.atm) <= (c.step || 50) * 10);
    const side = (o) => (o ? `<td>${num(o.ltp)}</td><td>${fin(o.iv) ? (o.iv > 3 ? o.iv : o.iv * 100).toFixed(1) : "—"}</td><td>${num(o.oi, 0)}</td><td class="${clsAbs((o.oi || 0) - (o.prevOi || 0))}">${num((o.oi || 0) - (o.prevOi || 0), 0)}</td>` : "<td>—</td><td>—</td><td>—</td><td>—</td>");
    return `<h3>Chain (±10 strikes)</h3><div class="tw"><table class="rs-t"><thead><tr><th colspan="4">CALLS</th><th>Strike</th><th colspan="4">PUTS</th></tr><tr><th>LTP</th><th>IV</th><th>OI</th><th>ΔOI</th><th></th><th>LTP</th><th>IV</th><th>OI</th><th>ΔOI</th></tr></thead><tbody>${near.map((r) => `<tr ${r.strike === c.atm ? 'style="background:#15130d"' : ""}>${side(r.ce)}<td><b>${r.strike}</b></td>${side(r.pe)}</tr>`).join("")}</tbody></table></div>`;
  }
  function paint() {
    const u = S.und;
    S.root.innerHTML = `<div class="rs-top"><h2 style="margin:0">Options</h2><div class="seg">${Object.entries(UND).map(([k, v]) => `<button data-und="${k}" class="${u === k ? "on" : ""}">${v.name}</button>`).join("")}</div></div>
      <div class="rs-f">${S.expiries.length ? selectRow("Expiry", "ox-exp", S.expiries.map((e) => [e, e]), S.expiry) : ""}<button class="btn ghost" data-act="${S.expiries.length ? "reload" : "load"}">${S.busy ? "Loading…" : S.chain ? "Refresh" : "Load chain"}</button>${S.chain ? `<span class="note">as of ${new Date(S.at).toLocaleTimeString("en-IN", { hour12: false })} · Dhan live chain (REST, not a stream)</span>` : ""}</div>
      ${S.msg ? `<div class="banner-inline">${esc(S.msg)}</div>` : ""}
      ${S.chain ? summary() + gexView() + scanner() + chainTable() : `<div class="empty">Load the chain to see PCR, max pain, straddle, OI, smile, GEX estimate and spread scanners.</div>`}${disclaimer}`;
  }
  return {
    pcr: () => (S.chain && Date.now() - S.at < 15 * 60000 ? pcr(S.chain).oi : null),
    mount(el) {
      S.root = el; paint();
      el.addEventListener("click", (e) => {
        const u = e.target.closest("[data-und]")?.dataset.und; if (u) { S.und = u; LS.set("optUnd", u); S.expiries = []; S.chain = null; S.scanRes = null; S.msg = ""; return paint(); }
        const a = e.target.closest("[data-act]")?.dataset.act;
        if (a === "load") return loadExpiries(); if (a === "reload") return loadChain(); if (a === "scan") return runScan();
      });
      el.addEventListener("change", (e) => {
        const id = e.target.id;
        if (id === "ox-exp") { S.expiry = e.target.value; return loadChain(); }
        if (id === "ox-gex") { S.gexSc = e.target.value; LS.set("optGex", S.gexSc); return paint(); }
        if (id?.startsWith("os-")) { const n = (k) => +e.target.value; const m = { "os-kind": ["kind", e.target.value], "os-span": ["span", n()], "os-width": ["width", n()], "os-ratio": ["ratio", n()], "os-oi": ["minOi", n()], "os-sp": ["maxSpreadPct", n()] }[id]; if (m) { S.sc[m[0]] = m[1]; LS.set("optScan", S.sc); } }
      });
    },
  };
}
