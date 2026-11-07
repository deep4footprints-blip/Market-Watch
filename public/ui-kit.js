// Shared UI helpers for the research tabs. Strings in, strings out (plus a tiny CSV download).
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const fin = (n) => n != null && Number.isFinite(n);
export const pc = (n, d = 1) => { if (!fin(n)) return "—"; const t = (n * 100).toFixed(d); return Number(t) === 0 ? `${(0).toFixed(d)}%` : `${n > 0 ? "+" : ""}${t}%`; };
/** unsigned percent (for rates/shares such as win rate, volatility, drawdown, weights) */
export const pp = (n, d = 1) => (fin(n) ? `${(n * 100).toFixed(d)}%` : "—");
export const num = (n, d = 2) => (fin(n) ? n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—");
export const inr = (n) => { if (!fin(n)) return "—"; const a = Math.abs(n), s = n < 0 ? "−" : ""; return a >= 1e7 ? `${s}₹${(a / 1e7).toFixed(2)} Cr` : a >= 1e5 ? `${s}₹${(a / 1e5).toFixed(2)} L` : `${s}₹${Math.round(a).toLocaleString("en-IN")}`; };
export const cls = (n) => (!fin(n) || Math.abs(n) < 0.0005 ? "flat" : n > 0 ? "up" : "dn");
export const clsAbs = (n) => (!fin(n) || n === 0 ? "flat" : n > 0 ? "up" : "dn");
export const dstr = (t) => (t ? new Date(t * 1000).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—");
export const dms = (ms) => (ms ? new Date(ms).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—");
export const chartAttr = (seg, id, ins, sym, name = "") => `data-c="${esc([seg, id, ins, sym, name].join("|"))}"`;
export const inputRow = (label, id, val, { type = "number", step = "any", min = "", max = "", w = "" } = {}) => `<label class="fld">${label}<input id="${id}" type="${type}" step="${step}" ${min !== "" ? `min="${min}"` : ""} ${max !== "" ? `max="${max}"` : ""} value="${esc(val)}" ${w ? `style="width:${w}"` : ""}></label>`;
export const selectRow = (label, id, opts, val) => `<label class="fld">${label}<select id="${id}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
export const metric = (label, v, c = "") => `<div class="mtr"><span>${label}</span><b class="${c}">${v}</b></div>`;
export function downloadCsv(name, lines) {
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export const csvCell = (x) => (x == null ? "" : typeof x === "number" ? (Number.isFinite(x) ? +x.toFixed(6) : "") : /[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : String(x));
export const note = (t) => `<div class="note">${t}</div>`;
export const disclaimer = `<div class="note">Informational and educational use only. Derived from delayed/EOD Dhan data; not investment advice. Nothing here places an order.</div>`;
/** Line chart of one or two equal-length series. */
export function twoLines(a, b, { w = 340, h = 120, ca = "#d9c9a3", cb = "#6b6b72", fmt = (x) => x.toFixed(0) } = {}) {
  const all = [...a, ...(b || [])].filter(fin); if (a.length < 2 || !all.length) return "";
  const lo = Math.min(...all), hi = Math.max(...all), sp = hi - lo || 1, X = (i) => 4 + (i / (a.length - 1)) * (w - 8), Y = (v) => 6 + (1 - (v - lo) / sp) * (h - 20);
  const p = (s) => s.map((v, i) => (fin(v) ? `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}` : "")).join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" aria-hidden="true">${b ? `<path d="${p(b)}" fill="none" stroke="${cb}" stroke-width="1.4"/>` : ""}<path d="${p(a)}" fill="none" stroke="${ca}" stroke-width="1.8"/><g font-family="ui-monospace,monospace" font-size="9" fill="#8a8a90"><text x="6" y="${h - 4}">${fmt(lo)}</text><text x="${w - 6}" y="10" text-anchor="end">${fmt(hi)}</text></g></svg>`;
}
export function drawdownArea(eq, { w = 340, h = 70 } = {}) {
  let peak = -Infinity; const dd = eq.map((v) => { peak = Math.max(peak, v); return 1 - v / peak; }); const mx = Math.max(0.001, ...dd);
  const X = (i) => 4 + (i / (eq.length - 1)) * (w - 8), Y = (d) => 4 + (d / mx) * (h - 8);
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" aria-hidden="true"><path d="M4,4 ${dd.map((d, i) => `L${X(i).toFixed(1)},${Y(d).toFixed(1)}`).join("")} L${w - 4},4Z" fill="#ff5c5c" opacity=".35"/><text x="${w - 6}" y="${h - 4}" text-anchor="end" font-family="ui-monospace,monospace" font-size="9" fill="#8a8a90">max −${(mx * 100).toFixed(1)}%</text></svg>`;
}
