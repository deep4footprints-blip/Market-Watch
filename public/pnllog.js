// Minute-by-minute P&L logs, one per series: "port" (Dhan live portfolio) and "st:<id>" (one Payoff strategy session).
// Stored as { port:{ "YYYY-MM-DD":[[tMs, total, a, b], ...] }, st:{ id:{ meta, days:{...} } } } in localStorage.
// Samples are only taken while the app runs (the phone suspends a closed WebView), so gaps = app not open.
const KEEP_DAYS = 30, KEEP_SESSIONS = 25;
const IST = 330 * 60000;
export const dayOf = (t) => new Date(t + IST).toISOString().slice(0, 10);
export const hm = (t) => new Date(t + IST).toISOString().slice(11, 16);

export function createLog(LS) {
  const load = () => LS.get("plog", { port: {}, st: {} });
  const save = (d) => LS.set("plog", d);
  const sk = (series) => (series.startsWith("st:") ? series.slice(3) : series); // strategy ids are stored without the "st:" prefix

  function prune(d) {
    const cut = dayOf(Date.now() - KEEP_DAYS * 864e5);
    for (const k of Object.keys(d.port)) if (k < cut) delete d.port[k];
    for (const [id, s] of Object.entries(d.st)) {
      for (const k of Object.keys(s.days)) if (k < cut) delete s.days[k];
      if (!Object.keys(s.days).length) delete d.st[id];
    }
    const ids = Object.keys(d.st).sort((a, b) => (d.st[b].meta.last || 0) - (d.st[a].meta.last || 0));
    for (const id of ids.slice(KEEP_SESSIONS)) delete d.st[id];
  }

  /** One sample per wall-clock minute: later samples inside the same minute replace the earlier one. */
  function put(arr, t, vals) {
    const row = [t, ...vals], m = Math.floor(t / 60000), last = arr[arr.length - 1];
    if (last && Math.floor(last[0] / 60000) === m) arr[arr.length - 1] = row;
    else arr.push(row);
  }

  return {
    /** total, a, b: portfolio = (total, holdings day P&L, positions P&L); strategy = (total, realised, open). */
    record(series, t, vals, meta) {
      if (!vals.every(Number.isFinite)) return false;
      const d = load(), day = dayOf(t);
      if (series === "port") put((d.port[day] ||= []), t, vals);
      else {
        const id = sk(series), s = (d.st[id] ||= { meta: {}, days: {} });
        Object.assign(s.meta, meta || {}, { last: t });
        put((s.days[day] ||= []), t, vals);
      }
      prune(d); save(d);
      return true;
    },
    days(series) {
      const d = load(), o = series === "port" ? d.port : d.st[sk(series)]?.days || {};
      return Object.keys(o).sort().reverse();
    },
    get(series, day) { const d = load(); return (series === "port" ? d.port[day] : d.st[sk(series)]?.days[day]) || []; },
    sessions() {
      const d = load();
      return Object.entries(d.st).map(([id, s]) => ({ id, ...s.meta })).sort((a, b) => (b.last || 0) - (a.last || 0));
    },
    rename(id, name) { const d = load(), k = sk(id); if (d.st[k]) { d.st[k].meta.name = name; save(d); } },
    clearDay(series, day) {
      const d = load();
      if (series === "port") delete d.port[day];
      else { const k = sk(series); if (d.st[k]) { delete d.st[k].days[day]; if (!Object.keys(d.st[k].days).length) delete d.st[k]; } }
      save(d);
    },
  };
}

/** Summary of one day's samples (column 1 = total). */
export function summarize(pts) {
  if (!pts.length) return null;
  let hi = pts[0], lo = pts[0], ddMax = 0, peak = pts[0];
  for (const p of pts) {
    if (p[1] > hi[1]) hi = p;
    if (p[1] < lo[1]) lo = p;
    if (p[1] > peak[1]) peak = p;
    ddMax = Math.min(ddMax, p[1] - peak[1]);
  }
  const last = pts[pts.length - 1];
  return { first: pts[0], last, hi, lo, drawdown: ddMax, n: pts.length, change: last[1] - pts[0][1] };
}

export function toCsv(pts, cols) {
  return [["time_ist", ...cols].join(","), ...pts.map((p) => [new Date(p[0] + IST).toISOString().slice(0, 16).replace("T", " "), ...p.slice(1).map((v) => +v.toFixed(2))].join(","))].join("\n");
}
