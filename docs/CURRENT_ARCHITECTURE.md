# Current architecture

```
Browser / Capacitor WebView (no backend, no database)
 ├─ public/*.js (ES modules, no bundler)
 │    dhan.js        Dhan client + response normalisers + rate-limit lanes
 │    candles.js     candle parsing/aggregation
 │    history.js     NEW  daily-bar cache (IndexedDB) + resumable bulk ingest
 │    analytics.js   NEW  pure formulas: RS, trend template, Stage, breadth, regime, PCR, max pain, straddle
 │    providers.js   NEW  dataset catalogue + status evaluation
 │    research-ui.js NEW  Research tab
 │    payoff*.js, chart-ui.js, log-ui.js, pnllog.js, backfill.js, viz.js, dom.js (V1)
 ├─ localStorage: credentials, watchlist, saved strategies, P&L log, UI prefs
 └─ IndexedDB `dhan-pulse-history`: daily bars per instrument (NEW)

GitHub Actions: unit tests → scripts/build_instruments.py (Dhan scrip master → public/instruments.json) → APK build → GitHub Pages
Network: browser/APK ──access-token header──▶ https://api.dhan.co/v2 (the web build needs Dhan CORS; the APK uses native HTTP)
```

## Dhan endpoints in use
`/marketfeed/quote`, `/holdings`, `/positions`, `/profile`, `/RenewToken`, `/optionchain`, `/optionchain/expirylist`, `/charts/intraday`, `/charts/historical`. No order endpoints. No WebSocket feed (REST polling only).

## Constraints that shape every design choice
- **No server**: nothing can run on a schedule, so all heavy computation happens in the browser on demand, from cached data. Alerts that fire while the app is closed are impossible without adding a backend.
- **Credentials live on the device** (localStorage). Anything added must keep them out of logs, exports and any future AI context.
- **Storage**: localStorage (~5 MB) holds small state; large series go to IndexedDB.
- **Single user, single device**: no sync. A backend (see roadmap) is the prerequisite for multi-device saved screens, alerts, journal and scheduled jobs.

## Recommended direction (no rewrite)
Keep the client-only app for everything derivable from Dhan on demand. Add a small backend **only** when one of these is needed: scheduled alerts, third-party providers needing server-side keys or CORS, point-in-time snapshots over time, or multi-device sync. Cloudflare Worker + D1/R2 or a small Postgres service both fit; decide when the first of those features is scheduled.
