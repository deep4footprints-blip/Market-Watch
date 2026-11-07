// Trading-journal analytics. Pure. Trade = { id, sym, side: 1|-1, qty, entry, exit|null, entryT, exitT, fees, stop, setup, tags[], notes, regime }.
const fin = (n) => n != null && Number.isFinite(n);
export const tradePnl = (t) => (fin(t.exit) ? t.side * (t.exit - t.entry) * t.qty - (t.fees || 0) : null);
export const rMultiple = (t) => { const p = tradePnl(t), risk = fin(t.stop) ? Math.abs(t.entry - t.stop) * t.qty : null; return p != null && risk > 0 ? p / risk : null; };
export const holdDays = (t) => (fin(t.exitT) && fin(t.entryT) ? (t.exitT - t.entryT) / 864e5 : null);

export function stats(trades) {
  const closed = trades.filter((t) => fin(tradePnl(t))).sort((a, b) => a.exitT - b.exitT);
  const p = closed.map(tradePnl), wins = p.filter((x) => x > 0), losses = p.filter((x) => x < 0);
  const gw = wins.reduce((a, b) => a + b, 0), gl = -losses.reduce((a, b) => a + b, 0);
  let eq = 0, peak = 0, dd = 0; for (const x of p) { eq += x; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  const R = closed.map(rMultiple).filter(fin);
  const feesTotal = closed.reduce((a, t) => a + (t.fees || 0), 0);
  return {
    n: closed.length, open: trades.length - closed.length, net: p.reduce((a, b) => a + b, 0), winRate: closed.length ? wins.length / closed.length : null,
    avgWin: wins.length ? gw / wins.length : null, avgLoss: losses.length ? -gl / losses.length : null,
    profitFactor: gl > 0 ? gw / gl : gw > 0 ? Infinity : null, expectancy: closed.length ? p.reduce((a, b) => a + b, 0) / closed.length : null,
    avgR: R.length ? R.reduce((a, b) => a + b, 0) / R.length : null, rCount: R.length, maxDrawdown: dd, fees: feesTotal,
    avgHold: (() => { const h = closed.map(holdDays).filter(fin); return h.length ? h.reduce((a, b) => a + b, 0) / h.length : null; })(),
    best: p.length ? Math.max(...p) : null, worst: p.length ? Math.min(...p) : null,
    curve: p.reduce((a, x) => (a.push((a[a.length - 1] || 0) + x), a), []),
  };
}
/** Group stats by a key function (setup, symbol, tag, long/short…). */
export function groupBy(trades, keyFn) {
  const m = new Map();
  for (const t of trades) for (const k of [].concat(keyFn(t) ?? "—")) { if (!m.has(k)) m.set(k, []); m.get(k).push(t); }
  return [...m].map(([k, ts]) => ({ key: k, ...stats(ts) })).sort((a, b) => b.net - a.net);
}
/** CSV import: header row maps by case-insensitive names. Returns { trades, errors }. */
export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean); if (lines.length < 2) return { trades: [], errors: ["no data rows"] };
  const h = lines[0].split(",").map((x) => x.trim().toLowerCase()), idx = (...n) => h.findIndex((x) => n.includes(x));
  const col = { sym: idx("symbol", "sym"), side: idx("side"), qty: idx("qty", "quantity"), entry: idx("entry", "entry_price"), exit: idx("exit", "exit_price"), entryT: idx("entry_date", "entry_time"), exitT: idx("exit_date", "exit_time"), fees: idx("fees", "charges"), stop: idx("stop"), setup: idx("setup", "strategy") };
  const errors = [], trades = [];
  if (col.sym < 0 || col.qty < 0 || col.entry < 0) return { trades, errors: ["need columns: symbol, qty, entry (and optionally side, exit, entry_date, exit_date, fees, stop, setup)"] };
  lines.slice(1).forEach((ln, i) => {
    const c = ln.split(",").map((x) => x.trim()), num = (k) => (col[k] >= 0 && c[col[k]] !== "" ? +c[col[k]] : null), d = (k) => (col[k] >= 0 && c[col[k]] ? Date.parse(c[col[k]]) : null);
    const side = col.side >= 0 && /^(s|short|sell|-1)$/i.test(c[col.side]) ? -1 : 1, qty = num("qty"), entry = num("entry");
    if (!fin(qty) || !fin(entry) || qty <= 0 || entry <= 0) return errors.push(`row ${i + 2}: bad qty/entry`);
    trades.push({ id: `imp${Date.now()}_${i}`, sym: c[col.sym].toUpperCase(), side, qty, entry, exit: num("exit"), entryT: d("entryT"), exitT: d("exitT"), fees: num("fees") || 0, stop: num("stop"), setup: col.setup >= 0 ? c[col.setup] : "", tags: [], notes: "" });
  });
  return { trades, errors };
}
