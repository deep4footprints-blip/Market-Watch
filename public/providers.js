// Dataset catalogue + status evaluation. Every dataset the product needs is listed with its source, cadence and status.
// Nothing here fetches data. Datasets with no connected provider are listed as `not_connected` so the UI never fakes them.
// Status values: healthy | delayed | stale | incomplete | failed | not_configured | not_connected

export const CATALOG = [
  { id: "dhan.auth", name: "Dhan credentials", provider: "Dhan", cadence: "24h token", kind: "source" },
  { id: "dhan.quotes", name: "Live quotes (REST, indices + F&O stocks)", provider: "Dhan /marketfeed/quote", cadence: "~1 s while open, 15 s closed", kind: "source" },
  { id: "dhan.instruments", name: "Instrument master (indices, F&O universe, lot sizes)", provider: "Dhan scrip master (build time)", cadence: "Weekdays 07:00 IST via CI", kind: "source" },
  { id: "dhan.history", name: "Daily history (EOD OHLCV, ~430 bars)", provider: "Dhan /charts/historical", cadence: "Once per session, cached on device", kind: "source" },
  { id: "dhan.intraday", name: "Intraday candles (1–60 min, ≤90 days)", provider: "Dhan /charts/intraday", cadence: "On demand", kind: "source" },
  { id: "dhan.chain", name: "Option chain (Nifty, Sensex)", provider: "Dhan /optionchain", cadence: "On demand, max 1 per 3 s", kind: "source" },
  { id: "dhan.book", name: "Holdings and positions", provider: "Dhan /holdings, /positions", cadence: "~15 s while open", kind: "source" },
  { id: "derived.rs", name: "RS rating, trend template, Stage", provider: "Derived from dhan.history", cadence: "Recomputed after history refresh", kind: "derived" },
  { id: "derived.breadth", name: "Breadth and regime score (F&O universe)", provider: "Derived from dhan.history", cadence: "Recomputed after history refresh", kind: "derived" },
  // ---- Not connected: no provider chosen/licensed yet. Candidate sources are leads to evaluate, not integrations. ----
  { id: "fundamentals", name: "Fundamentals and financial statements (point-in-time)", provider: "Not connected", candidate: "Licensed fundamentals vendor, or exchange XBRL filings (terms to review)", kind: "gap" },
  { id: "shareholding", name: "Shareholding pattern, pledges, bulk/block deals", provider: "Not connected", candidate: "NSE/BSE disclosures (terms to review)", kind: "gap" },
  { id: "filings", name: "Corporate announcements, results calendar, corporate actions", provider: "Not connected", candidate: "NSE/BSE feeds (terms to review)", kind: "gap" },
  { id: "adjusted", name: "Verified corporate-action-adjusted price history", provider: "Not verified", candidate: "Confirm Dhan's adjustment behaviour, else a corporate-actions provider", kind: "gap" },
  { id: "constituents", name: "Historical index constituents and weights (point-in-time)", provider: "Not connected", candidate: "NSE index factsheets/NiftyIndices (terms to review)", kind: "gap" },
  { id: "sectors", name: "Sector/industry classification (effective-dated)", provider: "Not connected", candidate: "Exchange/vendor classification (terms to review)", kind: "gap" },
  { id: "flows", name: "FII/DII cash flows, participant-wise F&O OI", provider: "Not connected", candidate: "NSE/SEBI/NSDL published reports (terms to review)", kind: "gap" },
  { id: "histopt", name: "Historical option chains (contract-level, intraday)", provider: "Not connected", candidate: "Vendor with licensed history; Dhan expired-options endpoint to be evaluated", kind: "gap" },
  { id: "funds", name: "Mutual fund NAV/AUM/holdings, ETF NAV and tracking", provider: "Not connected", candidate: "AMFI published data (terms to review)", kind: "gap" },
  { id: "macro", name: "India macro (GDP, CPI, IIP, RBI, fiscal) and global series", provider: "Not connected", candidate: "RBI, MoSPI, FRED (terms to review)", kind: "gap" },
  { id: "news", name: "News and economic calendar", provider: "Not connected", candidate: "Licensed vendor (terms to review)", kind: "gap" },
];

const ageSec = (t, now) => (t ? Math.max(0, Math.floor((now - t) / 1000)) : null);
export function fmtAge(s) {
  if (s == null) return "—";
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/**
 * ctx: { now, hasToken, tokenExp, marketOpen, quoteAt, quoteErr, instGenerated, instFno, hist:{total,have,fresh,newestBar(sec)}, histErr, chainAt, bookAt, bookErr }
 * Returns rows [{...catalog, status, asOf, note}] with a human `note` explaining the status.
 */
export function evaluate(ctx, now = ctx.now ?? Date.now()) {
  const R = {};
  const set = (id, status, asOf, note) => { R[id] = { status, asOf, note }; };

  if (!ctx.hasToken) set("dhan.auth", "not_configured", null, "No client id/token saved. Add them in Settings.");
  else if (ctx.tokenExp && ctx.tokenExp < now) set("dhan.auth", "failed", ctx.tokenExp, "Token expired. Paste a new one.");
  else set("dhan.auth", "healthy", ctx.tokenExp || null, ctx.tokenExp ? `Valid until ${new Date(ctx.tokenExp).toLocaleString("en-IN")}` : "Token saved (expiry unreadable).");

  const needAuth = ctx.hasToken ? null : "Needs Dhan credentials.";
  if (needAuth) { for (const id of ["dhan.quotes", "dhan.intraday", "dhan.chain", "dhan.book", "dhan.history"]) set(id, "not_configured", null, needAuth); }
  else {
    const qa = ageSec(ctx.quoteAt, now);
    if (ctx.quoteErr) set("dhan.quotes", "failed", ctx.quoteAt, ctx.quoteErr);
    else if (qa == null) set("dhan.quotes", "stale", null, "No quote received yet this session.");
    else if (ctx.marketOpen && qa > 30) set("dhan.quotes", "stale", ctx.quoteAt, `Market open but last quote ${fmtAge(qa)}.`);
    else set("dhan.quotes", "healthy", ctx.quoteAt, ctx.marketOpen ? "Live (REST polling, not tick stream)." : "Market closed; last close.");
    set("dhan.intraday", "healthy", null, "Fetched on demand when a chart opens.");
    set("dhan.chain", ctx.chainAt ? "healthy" : "stale", ctx.chainAt || null, ctx.chainAt ? "Last chain load shown." : "Not loaded this session (open Payoff).");
    if (ctx.bookErr) set("dhan.book", "failed", ctx.bookAt, ctx.bookErr);
    else set("dhan.book", ctx.bookAt ? "healthy" : "stale", ctx.bookAt || null, ctx.bookAt ? "OK." : "Not loaded yet.");
    const h = ctx.hist;
    if (!h || !h.total) set("dhan.history", "not_configured", null, "Universe not built.");
    else if (!h.have) set("dhan.history", "stale", null, "Not loaded. Open Research and press Load history.");
    else {
      const cov = `${h.have}/${h.total} instruments cached, ${h.fresh} current.`;
      const st = h.have < h.total ? "incomplete" : h.fresh < h.total ? "delayed" : "healthy";
      set("dhan.history", ctx.histErr && st !== "healthy" ? "failed" : st, h.newestBar ? h.newestBar * 1000 : null, ctx.histErr ? `${cov} Last error: ${ctx.histErr}` : cov);
    }
  }
  if (!ctx.instGenerated) set("dhan.instruments", "failed", null, "instruments.json missing: run the deploy workflow.");
  else {
    const a = ageSec(ctx.instGenerated, now);
    set("dhan.instruments", a > 4 * 86400 ? "stale" : "healthy", ctx.instGenerated, `${ctx.instFno ?? 0} F&O stocks. Built ${fmtAge(a)}.`);
  }
  const h = ctx.hist;
  const dep = (!h || !h.have) ? "Needs daily history." : h.have < h.total ? `Partial coverage (${h.have}/${h.total}).` : "From cached EOD bars; price-only, adjustment unverified.";
  const dst = !h || !h.have ? "not_configured" : h.have < h.total ? "incomplete" : "healthy";
  set("derived.rs", dst, h?.newestBar ? h.newestBar * 1000 : null, dep);
  set("derived.breadth", dst, h?.newestBar ? h.newestBar * 1000 : null, dep + " Universe: F&O stocks only (not full market).");

  return CATALOG.map((c) => ({ ...c, ...(R[c.id] || { status: "not_connected", asOf: null, note: c.candidate ? `Candidate: ${c.candidate}` : "" }) }));
}

export const STATUS_LABEL = { healthy: "Healthy", delayed: "Delayed", stale: "Stale", incomplete: "Incomplete", failed: "Failed", not_configured: "Not configured", not_connected: "Not connected" };
export const STATUS_ICON = { healthy: "●", delayed: "◐", stale: "◌", incomplete: "◐", failed: "✕", not_configured: "○", not_connected: "–" };
