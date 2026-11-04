// SVG / CSS infographic builders. Pure string functions: no DOM access, so they are cheap to call every second.
export const C = { up: "#2ecc8f", dn: "#ff5c5c", acc: "#d9c9a3", mute: "#8a8a90", line: "#1c1c1f", surf: "#0b0b0c",
  cat: ["#d9c9a3", "#7fb7a4", "#8aa4d6", "#c98fb0", "#e0a66b", "#9a8fd1", "#6fb1c9", "#b5c46a", "#6b6b72"] };
const f = (n, d = 1) => Number(n).toFixed(d);
const fin = (n) => n != null && Number.isFinite(n);
export const tone = (n) => (!fin(n) || n === 0 ? C.mute : n > 0 ? C.up : C.dn);

let uid = 0;
/** Reset gradient ids at the start of each render so ids are stable between frames (keeps morphing quiet). */
export const resetIds = () => { uid = 0; };
/** Area sparkline. `ref` draws a dashed baseline (e.g. previous close). Colour follows last-vs-ref (or first). */
export function spark(vals, { w = 120, h = 36, ref = null, live = null } = {}) {
  const v = vals.filter(fin);
  if (v.length < 2) return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><line x1="0" x2="${w}" y1="${h / 2}" y2="${h / 2}" stroke="${C.line}" stroke-dasharray="2 3"/></svg>`;
  const series = fin(live) ? [...v, live] : v;
  const base = fin(ref) ? ref : series[0];
  const lo = Math.min(...series, base), hi = Math.max(...series, base), span = hi - lo || 1;
  const X = (i) => (i / (series.length - 1)) * w, Y = (x) => 2 + (1 - (x - lo) / span) * (h - 4);
  const col = tone(series[series.length - 1] - base);
  const pts = series.map((x, i) => `${f(X(i))},${f(Y(x))}`);
  const id = `g${uid++}`;
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".35"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    ${fin(ref) ? `<line x1="0" x2="${w}" y1="${f(Y(base))}" y2="${f(Y(base))}" stroke="${C.mute}" stroke-opacity=".5" stroke-dasharray="2 3"/>` : ""}
    <path d="M${pts.join("L")}L${w},${h}L0,${h}Z" fill="url(#${id})"/><path d="M${pts.join("L")}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round"/>
    <circle cx="${f(X(series.length - 1))}" cy="${f(Y(series[series.length - 1]))}" r="2.2" fill="${col}"/></svg>`;
}

/** Donut. parts: [{v, color?, label?}]; center: [{text, cls?}] two optional lines. */
export function donut(parts, { size = 120, thick = 16, center = [] } = {}) {
  const tot = parts.reduce((a, p) => a + Math.max(p.v, 0), 0);
  const r = (size - thick) / 2, cx = size / 2, circ = 2 * Math.PI * r;
  let off = 0;
  const arcs = tot > 0 ? parts.map((p, i) => {
    const len = (Math.max(p.v, 0) / tot) * circ;
    const el = `<circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${p.color || C.cat[i % C.cat.length]}" stroke-width="${thick}" stroke-dasharray="${f(Math.max(len - 1.5, 0), 2)} ${f(circ, 2)}" stroke-dashoffset="${f(-off, 2)}" transform="rotate(-90 ${cx} ${cx})"/>`;
    off += len;
    return el;
  }).join("") : "";
  return `<svg class="donut" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${C.line}" stroke-width="${thick}"/>${arcs}
    ${center.map((c, i) => `<text x="${cx}" y="${cx + (center.length === 1 ? 5 : i ? 14 : -3)}" text-anchor="middle" font-family="ui-monospace,monospace" font-size="${i ? 10 : 15}" fill="${c.color || (i ? C.mute : "#f2f2f0")}">${c.text}</text>`).join("")}</svg>`;
}

/** Semi-circle gauge, pct 0..1 (or null). `mid` marks a reference notch (e.g. 0.5). */
export function gauge(pct, { color = C.acc, label = "", sub = "", w = 150 } = {}) {
  const h = w * 0.62, r = w / 2 - 10, cx = w / 2, cy = h - 10, a = Math.PI;
  const p = fin(pct) ? Math.min(Math.max(pct, 0), 1) : 0;
  const pt = (t) => [cx + r * Math.cos(a - a * t), cy - r * Math.sin(a - a * t)];
  const [x0, y0] = pt(0), [x1, y1] = pt(1), [xp, yp] = pt(p);
  return `<svg class="gauge" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
    <path d="M${f(x0)},${f(y0)}A${r},${r} 0 0 1 ${f(x1)},${f(y1)}" fill="none" stroke="${C.line}" stroke-width="10" stroke-linecap="round"/>
    ${fin(pct) ? `<path d="M${f(x0)},${f(y0)}A${r},${r} 0 0 1 ${f(xp)},${f(yp)}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round"/>` : ""}
    <text x="${cx}" y="${cy - 8}" text-anchor="middle" font-family="ui-monospace,monospace" font-size="20" fill="#f2f2f0">${label}</text>
    <text x="${cx}" y="${cy + 6}" text-anchor="middle" font-family="ui-monospace,monospace" font-size="9" fill="${C.mute}">${sub}</text></svg>`;
}

/** Day-range bar: low ... high with a marker at ltp and a tick at open/prev close. */
export function rangeBar(low, high, ltp, ref = null) {
  if (![low, high, ltp].every(fin) || high <= low) return `<div class="rb"><i class="rb-t"></i></div>`;
  const P = (x) => `${f(Math.min(Math.max((x - low) / (high - low), 0), 1) * 100)}%`;
  return `<div class="rb" title="Day range"><i class="rb-t"></i><i class="rb-f" style="left:0;width:${P(ltp)};background:${tone(fin(ref) ? ltp - ref : 0)}"></i>${fin(ref) ? `<i class="rb-r" style="left:${P(ref)}"></i>` : ""}<i class="rb-m" style="left:${P(ltp)}"></i></div>`;
}

/** Horizontal diverging bars. items: [{label, value, sub?, attrs?}], value in %-like units; scaled to the largest |value|. */
export function divBars(items, { fmt = (v) => `${v > 0 ? "+" : ""}${f(v, 2)}%` } = {}) {
  const mx = Math.max(0.0001, ...items.map((i) => Math.abs(i.value || 0)));
  return `<div class="db">${items.map((i) => {
    const v = i.value, w = fin(v) ? (Math.abs(v) / mx) * 50 : 0;
    return `<div class="dbr" ${i.attrs || ""}><span class="dbl">${i.label}${i.sub ? `<small>${i.sub}</small>` : ""}</span>
      <span class="dbt"><i class="dbz"></i>${fin(v) ? `<i class="dbb" style="${v >= 0 ? `left:50%;` : `right:50%;`}width:${f(w)}%;background:${tone(v)}"></i>` : ""}</span>
      <span class="dbv" style="color:${tone(v)}">${fin(v) ? fmt(v) : "—"}</span></div>`;
  }).join("")}</div>`;
}

/** Stacked proportion bar. parts: [{v,color,label}] */
export function stack(parts) {
  const tot = parts.reduce((a, p) => a + Math.max(p.v, 0), 0) || 1;
  return `<div class="stk">${parts.map((p) => `<i style="width:${f((Math.max(p.v, 0) / tot) * 100, 2)}%;background:${p.color}" title="${p.label || ""}"></i>`).join("")}</div>`;
}

/** Small line chart over x ticks (e.g. IV smile). pts: [{x,y}] */
export function line(pts, { w = 340, h = 90, color = C.acc, mark = null, xfmt = (x) => x } = {}) {
  const p = pts.filter((q) => fin(q.x) && fin(q.y));
  if (p.length < 2) return "";
  const x0 = p[0].x, x1 = p[p.length - 1].x, ys = p.map((q) => q.y);
  const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
  const X = (x) => 8 + ((x - x0) / (x1 - x0 || 1)) * (w - 16), Y = (y) => 6 + (1 - (y - lo) / span) * (h - 24);
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" aria-hidden="true"><path d="M${p.map((q) => `${f(X(q.x))},${f(Y(q.y))}`).join("L")}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round"/>
    ${fin(mark) ? `<line x1="${f(X(mark))}" x2="${f(X(mark))}" y1="4" y2="${h - 16}" stroke="${C.mute}" stroke-dasharray="2 3"/>` : ""}
    <g font-family="ui-monospace,monospace" font-size="9" fill="${C.mute}"><text x="8" y="${h - 3}">${xfmt(x0)}</text><text x="${w - 8}" y="${h - 3}" text-anchor="end">${xfmt(x1)}</text><text x="${w - 8}" y="10" text-anchor="end">${f(hi, 1)}</text><text x="${w - 8}" y="${h - 18}" text-anchor="end">${f(lo, 1)}</text></g></svg>`;
}

/** Paired bars per strike (calls up / puts down mirrored not needed: side-by-side). rows: [{x, a, b}] */
export function pairBars(rows, { w = 340, h = 110, colorA = C.up, colorB = C.dn, mark = null, fmtX = (x) => x } = {}) {
  if (!rows.length) return "";
  const mx = Math.max(1, ...rows.flatMap((r) => [r.a || 0, r.b || 0]));
  const bw = (w - 8) / rows.length;
  const bars = rows.map((r, i) => {
    const ha = ((r.a || 0) / mx) * (h - 22), hb = ((r.b || 0) / mx) * (h - 22), x = 4 + i * bw;
    return `<rect x="${f(x + bw * 0.08)}" y="${f(h - 14 - ha)}" width="${f(bw * 0.4)}" height="${f(ha)}" fill="${colorA}" opacity=".8"/><rect x="${f(x + bw * 0.5)}" y="${f(h - 14 - hb)}" width="${f(bw * 0.4)}" height="${f(hb)}" fill="${colorB}" opacity=".8"/>`;
  }).join("");
  const mi = fin(mark) ? rows.findIndex((r) => r.x === mark) : -1;
  const lab = [0, Math.floor(rows.length / 2), rows.length - 1].map((i) => `<text x="${f(4 + i * bw + bw / 2)}" y="${h - 2}" text-anchor="middle">${fmtX(rows[i].x)}</text>`).join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" aria-hidden="true">${bars}${mi >= 0 ? `<line x1="${f(4 + mi * bw + bw / 2)}" x2="${f(4 + mi * bw + bw / 2)}" y1="2" y2="${h - 14}" stroke="${C.acc}" stroke-dasharray="2 3"/>` : ""}<g font-family="ui-monospace,monospace" font-size="9" fill="${C.mute}">${lab}</g></svg>`;
}

/** Strip coloured green/red by the sign of `vals` across a price range; `mark` (0..1) is the spot position. */
export function zoneStrip(vals, mark = null) {
  if (!vals.length) return "";
  const w = 100 / vals.length;
  return `<div class="zs">${vals.map((x, i) => `<i style="left:${(i * w).toFixed(2)}%;width:${(w + 0.2).toFixed(2)}%;background:${x > 0 ? C.up : x < 0 ? C.dn : C.mute};opacity:${x === 0 ? 0.5 : 0.85}"></i>`).join("")}${fin(mark) ? `<b class="zm" style="left:${(Math.min(Math.max(mark, 0), 1) * 100).toFixed(1)}%"></b>` : ""}</div>`;
}
