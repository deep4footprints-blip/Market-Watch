// Pattern / setup detectors on daily bars. Each returns null or { id, state, date, pivot, stop, score, notes[] }.
// Every rule is a published, measurable threshold (see docs/METHODOLOGY.md). States: forming | near_trigger | breakout | failed.
// Detection is on COMPLETED daily bars only; it says "the rule conditions are met", never that a pattern is "real" or will work.
import { smaS, rsiS, atrS, relVol, emaS } from "./indicators.js";
import { smaAt, hiLo } from "./analytics.js";

const fin = (n) => n != null && Number.isFinite(n);
const mx = (a) => Math.max(...a), mn = (a) => Math.min(...a);
const sma = (cl, n, back = 0) => smaAt(cl, n, back);
const mk = (id, state, bars, pivot, stop, checks, notes = []) => ({
  id, state, date: bars[bars.length - 1].t, pivot, stop,
  score: Math.round((checks.filter(Boolean).length / checks.length) * 100), notes,
});
const upTrend = (cl) => { const s50 = sma(cl, 50), s200 = sma(cl, 200); return fin(s50) && fin(s200) && cl[cl.length - 1] > s50 && s50 > s200; };

/** Swing highs/lows: pivot if extreme within +/- w bars. Returns [{i, p, type}] alternating-ish, oldest first. */
export function swings(bars, w = 3) {
  const out = [];
  for (let i = w; i < bars.length - w; i++) {
    const win = bars.slice(i - w, i + w + 1);
    if (bars[i].h === mx(win.map((b) => b.h))) out.push({ i, p: bars[i].h, type: "H" });
    else if (bars[i].l === mn(win.map((b) => b.l))) out.push({ i, p: bars[i].l, type: "L" });
  }
  return out;
}

export const PATTERNS = {
  breakout52: {
    name: "52-week high breakout", group: "Base & breakout",
    rule: "Close ≥ highest prior 252-day close (breakout) or within 2% below it (near trigger). Score checks: volume ≥ 1.5× 50d avg, price above 50 and 200 DMA, close in top 30% of day range.",
    detect(bars) {
      const cl = bars.map((b) => b.c); if (cl.length < 260) return null;
      const prior = mx(cl.slice(-253, -1)), c = cl[cl.length - 1], b = bars[bars.length - 1];
      const state = c >= prior ? "breakout" : c >= prior * 0.98 ? "near_trigger" : null; if (!state) return null;
      const rv = relVol(bars), rng = b.h - b.l;
      return mk("breakout52", state, bars, prior, mn(bars.slice(-10).map((x) => x.l)), [rv >= 1.5, c > sma(cl, 50), c > sma(cl, 200), rng > 0 && (c - b.l) / rng >= 0.7], [`prior high ${prior.toFixed(2)}`, `relvol ${rv?.toFixed(2) ?? "n/a"}`]);
    },
  },
  flatBase: {
    name: "Flat base", group: "Base & breakout",
    rule: "Last 25 sessions: (high−low)/high ≤ 12%, net drift over the window ≤ 5% (sideways, not a ramp), close within 10% of 52w high, close above 50 DMA and 200 DMA. Pivot = base high; breakout when close > pivot.",
    detect(bars) {
      if (bars.length < 210) return null;
      const cl = bars.map((b) => b.c), w = bars.slice(-25), hi = mx(w.map((b) => b.h)), lo = mn(w.map((b) => b.l)), c = cl[cl.length - 1];
      const prior = bars.slice(-26, -1), pHi = mx(prior.map((b) => b.h));
      const depth = (hi - lo) / hi, h52 = hiLo(cl).hi;
      if (!(depth <= 0.12 && Math.abs(w[w.length - 2].c / w[0].c - 1) <= 0.05 && 1 - c / h52 <= 0.1 && c > sma(cl, 50) && c > sma(cl, 200))) return null;
      const state = c > pHi ? "breakout" : c >= pHi * 0.98 ? "near_trigger" : "forming";
      return mk("flatBase", state, bars, pHi, lo, [depth <= 0.08, relVol(bars, 20) < 1, 1 - c / h52 <= 0.05, upTrend(cl)], [`depth ${(depth * 100).toFixed(1)}%`]);
    },
  },
  vcp: {
    name: "Volatility contraction (VCP)", group: "Base & breakout",
    rule: "In the last 90 sessions, ≥ 2 successive pullbacks (swing high → next swing low) each shallower than the previous, last depth ≤ 10%, close above 50 and 200 DMA, 10-day avg volume < 50-day avg. Pivot = latest swing high.",
    detect(bars) {
      if (bars.length < 210) return null;
      const cl = bars.map((b) => b.c), base = bars.slice(-90), off = bars.length - 90;
      const sw = swings(base, 3).map((s) => ({ ...s, i: s.i + off }));
      const depths = [];
      for (let k = 0; k + 1 < sw.length; k++) if (sw[k].type === "H" && sw[k + 1].type === "L") depths.push({ d: 1 - sw[k + 1].p / sw[k].p, hi: sw[k].p, lo: sw[k + 1].p });
      const tail = depths.slice(-3);
      if (tail.length < 2) return null;
      const shrinking = tail.every((x, i) => i === 0 || x.d < tail[i - 1].d);
      const hs = sw.filter((s) => s.type === "H"), pivot = hs[hs.length - 1]?.p, c = cl[cl.length - 1];
      if (!(shrinking && tail[tail.length - 1].d <= 0.10 && c > sma(cl, 50) && c > sma(cl, 200) && pivot)) return null;
      const dry = bars.slice(-10).reduce((a, b) => a + b.v, 0) / 10 < bars.slice(-50).reduce((a, b) => a + b.v, 0) / 50;
      if (!dry) return null;
      const state = c > pivot ? "breakout" : c >= pivot * 0.97 ? "near_trigger" : "forming";
      return mk("vcp", state, bars, pivot, tail[tail.length - 1].lo, [tail.length >= 3, tail[tail.length - 1].d <= 0.06, relVol(bars, 50) < 0.8, upTrend(cl)], [`contractions ${tail.map((x) => (x.d * 100).toFixed(1) + "%").join(" → ")}`]);
    },
  },
  highTightFlag: {
    name: "High tight flag", group: "Base & breakout",
    rule: "Gain ≥ 90% (low to high) within 40 sessions, then a 10–25 session consolidation no deeper than 25% from that high. Breakout when close > flag high.",
    detect(bars) {
      if (bars.length < 90) return null;
      for (const flagLen of [10, 15, 20, 25]) {
        const flag = bars.slice(-flagLen), run = bars.slice(-flagLen - 40, -flagLen);
        if (run.length < 40) continue;
        const rLo = mn(run.map((b) => b.l)), rHi = mx(run.map((b) => b.h)), fHi = mx(flag.map((b) => b.h)), fLo = mn(flag.map((b) => b.l));
        if (rHi / rLo - 1 < 0.9 || 1 - fLo / Math.max(rHi, fHi) > 0.25) continue;
        const c = bars[bars.length - 1].c, pv = mx(flag.slice(0, -1).map((b) => b.h));
        return mk("highTightFlag", c > pv ? "breakout" : "forming", bars, pv, fLo, [rHi / rLo - 1 >= 1.2, 1 - fLo / fHi <= 0.15, relVol(bars, 20) < 1], [`run +${((rHi / rLo - 1) * 100).toFixed(0)}%`, `flag ${flagLen}d`]);
      }
      return null;
    },
  },
  cupHandle: {
    name: "Cup and handle", group: "Base & breakout",
    rule: "Cup 35–120 sessions: depth 12–35% from left rim, right rim within 10% of left rim, low in the middle third. Handle 5–15 sessions: pullback ≤ 12% from the right rim, ending in the upper half of the cup. Pivot = handle/rim high.",
    detect(bars) {
      if (bars.length < 140) return null;
      for (const handle of [5, 8, 12, 15]) for (const cup of [40, 60, 80, 100, 120]) {
        const seg = bars.slice(-(cup + handle), -handle); if (seg.length < cup) continue;
        const hnd = bars.slice(-handle), left = seg[0].h, lowI = seg.reduce((bi, b, i) => (b.l < seg[bi].l ? i : bi), 0), low = seg[lowI].l;
        const rim = mx(seg.slice(Math.floor(seg.length * 0.6)).map((b) => b.h)), depth = 1 - low / left;
        const hLow = mn(hnd.map((b) => b.l)), hHigh = mx(hnd.map((b) => b.h));
        if (depth < 0.12 || depth > 0.35 || Math.abs(1 - rim / left) > 0.10 || lowI < cup / 3 || lowI > (2 * cup) / 3) continue;
        if (1 - hLow / rim > 0.12 || hLow < low + (rim - low) / 2) continue;
        const c = bars[bars.length - 1].c, pivot = Math.max(rim, hHigh);
        return mk("cupHandle", c > pivot ? "breakout" : c >= pivot * 0.97 ? "near_trigger" : "forming", bars, pivot, hLow, [depth <= 0.30, Math.abs(1 - rim / left) <= 0.05, relVol(bars, 20) < 1, upTrend(bars.map((b) => b.c))], [`cup ${cup}d depth ${(depth * 100).toFixed(0)}%`, `handle ${handle}d`]);
      }
      return null;
    },
  },
  doubleBottom: {
    name: "Double bottom", group: "Base & breakout",
    rule: "Two swing lows within 3% of each other, 15–60 sessions apart, with a swing high ≥ 8% above the lows between them; latest close above the mid-peak = breakout, within 3% = near trigger.",
    detect(bars) {
      if (bars.length < 80) return null;
      const off = bars.length - 100, base = bars.slice(-100), sw = swings(base, 3).map((s) => ({ ...s, i: s.i + off }));
      const lows = sw.filter((s) => s.type === "L");
      for (let b = lows.length - 1; b >= 1; b--) for (let a = b - 1; a >= 0; a--) {
        const gap = lows[b].i - lows[a].i; if (gap < 15 || gap > 60) continue;
        if (Math.abs(lows[a].p / lows[b].p - 1) > 0.03) continue;
        const mid = sw.filter((s) => s.type === "H" && s.i > lows[a].i && s.i < lows[b].i); if (!mid.length) continue;
        const peak = mx(mid.map((s) => s.p)); if (peak / Math.max(lows[a].p, lows[b].p) - 1 < 0.08) continue;
        const c = bars[bars.length - 1].c; if (c < lows[b].p) continue;
        return mk("doubleBottom", c > peak ? "breakout" : c >= peak * 0.97 ? "near_trigger" : "forming", bars, peak, Math.min(lows[a].p, lows[b].p), [lows[b].p >= lows[a].p * 0.99, relVol(bars, 20) >= 1, c > sma(bars.map((x) => x.c), 50)], [`lows ${lows[a].p.toFixed(1)} / ${lows[b].p.toFixed(1)}`]);
      }
      return null;
    },
  },
  darvas: {
    name: "Darvas box", group: "Base & breakout",
    rule: "A box: highest high of the last 20 sessions unchanged for ≥ 3 sessions and a low floor that held for ≥ 3 sessions, box height ≤ 15% of price, in an uptrend (above 50 DMA). Breakout when close > box top.",
    detect(bars) {
      if (bars.length < 60) return null;
      const w = bars.slice(-21, -1), top = mx(w.map((b) => b.h)), ti = w.findIndex((b) => b.h === top), bottom = mn(w.slice(ti + 1).map((b) => b.l));
      if (!fin(bottom) || w.length - 1 - ti < 3 || (top - bottom) / top > 0.15) return null;
      const cl = bars.map((b) => b.c), c = cl[cl.length - 1];
      if (c <= sma(cl, 50) || c < bottom) return null;
      return mk("darvas", c > top ? "breakout" : "forming", bars, top, bottom, [relVol(bars) >= 1.5, c > sma(cl, 200) && c > top * 0.97], [`box ${bottom.toFixed(1)}–${top.toFixed(1)}`]);
    },
  },
  tightWeeks: {
    name: "Tight weekly closes", group: "Continuation",
    rule: "Last 3 weekly closes (every 5th session back) within 1.5% of each other, close above 50 DMA.",
    detect(bars) {
      if (bars.length < 60) return null;
      const cl = bars.map((b) => b.c), w = [cl[cl.length - 1], cl[cl.length - 6], cl[cl.length - 11]];
      if ((mx(w) - mn(w)) / mn(w) > 0.015 || cl[cl.length - 1] < sma(cl, 50)) return null;
      return mk("tightWeeks", "forming", bars, mx(bars.slice(-15).map((b) => b.h)), mn(bars.slice(-15).map((b) => b.l)), [(mx(w) - mn(w)) / mn(w) <= 0.008, upTrend(cl)]);
    },
  },
  pullback: {
    name: "Pullback to 20/50 DMA", group: "Continuation",
    rule: "Uptrend (close > 200 DMA, 50 > 200 DMA); within the last 3 sessions the low came within 1% of the 20 DMA (or 50 DMA) while the close holds at least 99% of it; prior 20-day return > 0.",
    detect(bars) {
      if (bars.length < 230) return null;
      const cl = bars.map((b) => b.c), c = cl[cl.length - 1];
      if (!(c > sma(cl, 200) && sma(cl, 50) > sma(cl, 200)) || cl[cl.length - 21] >= c * 1.5) return null;
      for (const n of [20, 50]) {
        const s = sma(cl, n); if (!fin(s)) continue;
        const touch = bars.slice(-3).some((b) => b.l <= s * 1.01);
        if (touch && c >= s * 0.99 && cl[cl.length - 21] < mx(cl.slice(-20))) return mk("pullback", "near_trigger", bars, mx(bars.slice(-5).map((b) => b.h)), mn(bars.slice(-3).map((b) => b.l)), [n === 50, relVol(bars, 20) < 1, rsiS(cl)[cl.length - 1] > 40], [`at ${n} DMA ${s.toFixed(2)}`]);
      }
      return null;
    },
  },
  pocketPivot: {
    name: "Pocket pivot", group: "Volume",
    rule: "Up day (close > prior close and close > open) with volume greater than the largest down-day volume of the prior 10 sessions, close above 50 DMA and within 10% of 52w high.",
    detect(bars) {
      if (bars.length < 60) return null;
      const b = bars[bars.length - 1], p = bars[bars.length - 2], cl = bars.map((x) => x.c);
      const downV = bars.slice(-11, -1).filter((x, i, a) => x.c < (bars[bars.length - 11 + i - 1]?.c ?? x.o)).map((x) => x.v);
      if (!(b.c > p.c && b.c > b.o && downV.length && b.v > mx(downV) && b.c > sma(cl, 50) && 1 - b.c / hiLo(cl).hi <= 0.1)) return null;
      return mk("pocketPivot", "breakout", bars, b.h, b.l, [b.v > 1.5 * (bars.slice(-51, -1).reduce((a, x) => a + x.v, 0) / 50), b.c > sma(cl, 200)], [`vol ${b.v} > max down vol ${mx(downV)}`]);
    },
  },
  rvolBreakout: {
    name: "Relative-volume breakout", group: "Volume",
    rule: "Relative volume ≥ 2 (vs prior 50 sessions) and close above the prior 20-session high.",
    detect(bars) {
      if (bars.length < 60) return null;
      const c = bars[bars.length - 1].c, rv = relVol(bars), hi = mx(bars.slice(-21, -1).map((b) => b.h));
      if (!(rv >= 2 && c > hi)) return null;
      return mk("rvolBreakout", "breakout", bars, hi, mn(bars.slice(-5).map((b) => b.l)), [rv >= 3, c > sma(bars.map((b) => b.c), 50)], [`relvol ${rv.toFixed(1)}`]);
    },
  },
  volClimax: {
    name: "Volume climax", group: "Volume",
    rule: "Volume ≥ 3× 50-day average and the largest of the last 120 sessions; direction by close vs open (up = possible exhaustion at highs, down = capitulation). Informational.",
    detect(bars) {
      if (bars.length < 130) return null;
      const b = bars[bars.length - 1], rv = relVol(bars);
      if (!(rv >= 3 && b.v >= mx(bars.slice(-121, -1).map((x) => x.v)))) return null;
      return mk("volClimax", b.c >= b.o ? "breakout" : "failed", bars, b.h, b.l, [rv >= 4], [b.c >= b.o ? "up-day climax" : "down-day climax"]);
    },
  },
  nr7: {
    name: "NR7 / inside bar", group: "Continuation",
    rule: "NR7: today's range (high−low) is the smallest of the last 7 sessions. Inside bar: high < prior high and low > prior low.",
    detect(bars) {
      if (bars.length < 8) return null;
      const r = bars.slice(-7).map((b) => b.h - b.l), b = bars[bars.length - 1], p = bars[bars.length - 2];
      const nr7 = r[6] === mn(r) && r[6] < mn(r.slice(0, 6)), inside = b.h < p.h && b.l > p.l;
      if (!nr7 && !inside) return null;
      return mk("nr7", "forming", bars, b.h, b.l, [nr7, inside], [nr7 ? "NR7" : "", inside ? "inside bar" : ""].filter(Boolean));
    },
  },
  goldenCross: {
    name: "50/200 DMA cross up", group: "Trend & momentum",
    rule: "50 DMA crossed above the 200 DMA within the last 5 sessions.",
    detect(bars) {
      const cl = bars.map((b) => b.c); if (cl.length < 210) return null;
      const now = sma(cl, 50) > sma(cl, 200);
      let crossed = false; for (let k = 1; k <= 5; k++) if (sma(cl, 50, k) <= sma(cl, 200, k) && sma(cl, 50, k - 1) > sma(cl, 200, k - 1)) crossed = true;
      return now && crossed ? mk("goldenCross", "breakout", bars, null, sma(cl, 200), [cl[cl.length - 1] > sma(cl, 50)]) : null;
    },
  },
  emaCross: {
    name: "20/50 EMA cross up", group: "Trend & momentum",
    rule: "20 EMA crossed above the 50 EMA within the last 3 sessions and close is above the 50 EMA.",
    detect(bars) {
      const cl = bars.map((b) => b.c); if (cl.length < 80) return null;
      const a = emaS(cl, 20), b = emaS(cl, 50), n = cl.length - 1;
      let crossed = false; for (let k = 0; k < 3; k++) if (a[n - k] > b[n - k] && a[n - k - 1] <= b[n - k - 1]) crossed = true;
      return crossed && cl[n] > b[n] ? mk("emaCross", "breakout", bars, null, b[n], [cl[n] > sma(cl, 200)]) : null;
    },
  },
  rsiRecovery: {
    name: "RSI(14) breakout / oversold recovery", group: "Trend & momentum",
    rule: "RSI crossed above 60 within 3 sessions (momentum), or crossed back above 30 from below within 3 sessions (oversold recovery).",
    detect(bars) {
      const r = rsiS(bars.map((b) => b.c)), n = r.length - 1; if (!fin(r[n]) || !fin(r[n - 4])) return null;
      let up60 = false, rec30 = false;
      for (let k = 0; k < 3; k++) { if (r[n - k] > 60 && r[n - k - 1] <= 60) up60 = true; if (r[n - k] > 30 && r[n - k - 1] <= 30) rec30 = true; }
      return up60 || rec30 ? mk("rsiRecovery", "breakout", bars, null, mn(bars.slice(-5).map((b) => b.l)), [up60, rec30], [up60 ? "RSI>60" : "RSI back above 30"]) : null;
    },
  },
};

export const PATTERN_IDS = Object.keys(PATTERNS);
export function scanBars(bars, ids = PATTERN_IDS) {
  const out = [];
  for (const id of ids) { try { const r = PATTERNS[id].detect(bars); if (r) out.push(r); } catch { /* a detector never takes the scan down */ } }
  return out;
}
/** Failure/invalidation check: did price close below the recorded stop since the signal? */
export const invalidated = (sig, bars) => sig.stop != null && bars.slice(-1)[0].c < sig.stop;
