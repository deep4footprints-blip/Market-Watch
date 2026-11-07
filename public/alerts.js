// Alert rules + evaluation. Pure. Each rule declares its DATA CLASS so an end-of-day signal is never presented as intraday:
//   live  : evaluated against polled quotes while the app is open (REST polling, ~1 s; not tick-level, not delivered when the app is closed)
//   eod   : evaluated after daily history refresh, on completed daily bars
// Rule = { id, kind, sym, key (seg:id), params, repeat: "once"|"recurring", cooldownMin, active, createdAt, firedAt, expires }
const fin = (n) => n != null && Number.isFinite(n);

export const KINDS = {
  priceAbove: { cls: "live", label: "Price above", fields: ["level"], test: (c, p) => fin(c.ltp) && c.ltp >= p.level, msg: (c, p) => `${c.sym} ${c.ltp} ≥ ${p.level}` },
  priceBelow: { cls: "live", label: "Price below", fields: ["level"], test: (c, p) => fin(c.ltp) && c.ltp <= p.level, msg: (c, p) => `${c.sym} ${c.ltp} ≤ ${p.level}` },
  pctMove: { cls: "live", label: "Day move ≥ % (abs)", fields: ["pct"], test: (c, p) => fin(c.pct) && Math.abs(c.pct) >= p.pct, msg: (c, p) => `${c.sym} ${c.pct.toFixed(2)}% today` },
  rsAbove: { cls: "eod", label: "RS rating ≥", fields: ["level"], test: (c, p) => fin(c.rs) && c.rs >= p.level, msg: (c, p) => `${c.sym} RS ${c.rs} ≥ ${p.level}` },
  rsBelow: { cls: "eod", label: "RS rating ≤", fields: ["level"], test: (c, p) => fin(c.rs) && c.rs <= p.level, msg: (c, p) => `${c.sym} RS ${c.rs} ≤ ${p.level}` },
  stageIs: { cls: "eod", label: "Stage equals", fields: ["stage"], test: (c, p) => c.stage === +p.stage, msg: (c, p) => `${c.sym} in Stage ${c.stage}` },
  stageChange: { cls: "eod", label: "Stage changed", fields: [], test: (c) => fin(c.stage) && fin(c.prevStage) && c.stage !== c.prevStage, msg: (c) => `${c.sym} Stage ${c.prevStage} → ${c.stage}` },
  trendScore: { cls: "eod", label: "Trend template passed ≥", fields: ["level"], test: (c, p) => fin(c.tt) && c.tt >= p.level, msg: (c, p) => `${c.sym} trend ${c.tt} ≥ ${p.level}` },
  pattern: { cls: "eod", label: "Pattern state", fields: ["pattern", "state"], test: (c, p) => (c.patterns || []).some((x) => x.id === p.pattern && (!p.state || x.state === p.state)), msg: (c, p) => `${c.sym} ${p.pattern} ${p.state || ""}` },
  regimeBelow: { cls: "eod", label: "Regime score ≤", fields: ["level"], test: (c, p) => fin(c.regime) && c.regime <= p.level, msg: (c, p) => `Regime ${c.regime?.toFixed(0)} ≤ ${p.level}` },
  regimeAbove: { cls: "eod", label: "Regime score ≥", fields: ["level"], test: (c, p) => fin(c.regime) && c.regime >= p.level, msg: (c, p) => `Regime ${c.regime?.toFixed(0)} ≥ ${p.level}` },
  pcrAbove: { cls: "live", label: "PCR (OI) ≥", fields: ["level"], test: (c, p) => fin(c.pcr) && c.pcr >= p.level, msg: (c, p) => `PCR ${c.pcr?.toFixed(2)} ≥ ${p.level}` },
  pcrBelow: { cls: "live", label: "PCR (OI) ≤", fields: ["level"], test: (c, p) => fin(c.pcr) && c.pcr <= p.level, msg: (c, p) => `PCR ${c.pcr?.toFixed(2)} ≤ ${p.level}` },
};

export function validate(rule) {
  const k = KINDS[rule.kind]; if (!k) return "unknown rule type";
  for (const f of k.fields) { const v = rule.params?.[f]; if (v == null || v === "" || (["level", "pct", "stage"].includes(f) && !fin(+v))) return `missing ${f}`; }
  if (!["regimeBelow", "regimeAbove", "pcrAbove", "pcrBelow"].includes(rule.kind) && !rule.key) return "pick an instrument";
  return null;
}

/**
 * Evaluate one rule against a context for its instrument. Returns { fire, message, reason } where reason explains non-firing states
 * (inactive / expired / cooldown / no data / not met). Does not mutate the rule.
 */
export function evaluate(rule, ctx, now = Date.now()) {
  const k = KINDS[rule.kind];
  if (!k) return { fire: false, reason: "unknown" };
  if (!rule.active) return { fire: false, reason: "paused" };
  if (rule.expires && now > rule.expires) return { fire: false, reason: "expired" };
  if (rule.repeat === "once" && rule.firedAt) return { fire: false, reason: "done" };
  if (rule.firedAt && now - rule.firedAt < (rule.cooldownMin ?? 60) * 60000) return { fire: false, reason: "cooldown" };
  if (!ctx) return { fire: false, reason: "no data" };
  const p = { ...rule.params, level: +rule.params?.level, pct: +rule.params?.pct };
  let ok = false; try { ok = !!k.test({ sym: rule.sym, ...ctx }, p); } catch { ok = false; }
  return ok ? { fire: true, message: k.msg({ sym: rule.sym, ...ctx }, p), cls: k.cls } : { fire: false, reason: "not met" };
}

/**
 * Run all rules of one data class. ctxFor(rule) -> context or null. Returns { rules (updated copies), events }.
 * Events carry the data class and timestamp so the UI can say "EOD signal as of …" and never "live".
 */
export function runAlerts(rules, cls, ctxFor, now = Date.now(), asOf = null) {
  const events = [];
  const out = rules.map((r) => {
    if (KINDS[r.kind]?.cls !== cls) return r;
    const res = evaluate(r, ctxFor(r), now);
    if (!res.fire) return r;
    events.push({ id: `${r.id}:${now}`, ruleId: r.id, t: now, cls, message: res.message, asOf: cls === "eod" ? asOf : now, sym: r.sym });
    return { ...r, firedAt: now, fireCount: (r.fireCount || 0) + 1, active: r.repeat === "once" ? false : r.active };
  });
  return { rules: out, events };
}
export const describe = (r) => { const k = KINDS[r.kind]; return `${r.sym || "Market"} · ${k.label}${k.fields.length ? " " + k.fields.map((f) => r.params[f]).join(" ") : ""}`; };
export const inQuiet = (now, q) => { if (!q?.on) return false; const d = new Date(now + 19800 * 1000), m = d.getUTCHours() * 60 + d.getUTCMinutes(); return q.from <= q.to ? m >= q.from && m < q.to : m >= q.from || m < q.to; };
