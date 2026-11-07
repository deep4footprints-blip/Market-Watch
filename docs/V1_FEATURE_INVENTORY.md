# V1 feature inventory (Dhan Pulse)

Audited from source at commit `17606fe`. Status: **Working** (code path complete and unit-tested), **Unverified live** (needs a real Dhan session to confirm), **Not present**.
Nothing below was exercised against the live Dhan API from the build sandbox; "Working" means implemented and covered by unit tests with mocked responses.

| Area | Feature | Source | Status | Notes |
|---|---|---|---|---|
| Shell | PWA + Capacitor Android APK, bottom tab bar, dark editorial UI | `public/index.html`, `style.css`, `sw.js`, `.github/workflows/deploy.yml` | Working | Signed with committed debug key |
| Auth | Client id + token in Settings, validated via `/profile`, localStorage only, auto `RenewToken` when >8h old | `app.js` | Unverified live | `net_change` semantics flagged in README as to-verify |
| Overview | Hero indices (Nifty, Sensex, Bank Nifty, VIX) with sparklines, F&O breadth donut, sector pulse, gainers/losers, portfolio day P&L | `app.js`, `viz.js` | Working | Breadth is F&O stocks, **today only** |
| Sectors | Sector heat-map + ranked bars + broad indices | `app.js` | Working | Day change only |
| Movers | Gainers / losers / most active (F&O universe) | `dhan.js buildSnapshot` | Working | |
| Portfolio | Holdings + positions, allocation donut, day/overall P&L | `dhan.js`, `app.js` | Working | Read-only |
| Watchlist | Single list, NSE symbol search, 100 max, localStorage | `app.js` | Working | No alerts, tags, multiple lists |
| Charts | Candles 1m–1h + D/W/M, custom minutes, SMA, volume, pan/zoom, live last candle | `chart-ui.js`, `candles.js` | Working | |
| Payoff | Option chain (Nifty, Sensex), leg builder, expiry/today payoff, Greeks, scenarios, saved strategies, adjustment ranking | `payoff.js`, `payoff-ui.js` | Working | Black-Scholes at fixed 6.5% rate; analysis only |
| Log | Per-minute P&L log with backfill from Dhan 1-min candles | `pnllog.js`, `log-ui.js`, `backfill.js` | Working | |
| Rate limiting | 1 quote req/s, 1 option-chain req/3 s, chart lane 350 ms | `dhan.js` | Working | |
| Orders | None. App is explicitly read-only | | Not present (by design) | Keep it so |
| Backend, DB, accounts, alerts, screener, RS/Stage, fundamentals, filings, macro, funds | | | Not present | See gap analysis |

Added in this release: Research tab (Breadth, Screener, Sectors), Data tab. See `CHANGELOG.md`.
