# Changelog

## Unreleased — Systematic, derivatives, tools
- Added tabs: Setups (16 pattern scanners), Backtest lab, Options (PCR/max pain/straddle/OI/smile/GEX estimate/spread scanners), Risk, Alerts, Journal, Tools (17 calculators); multiple watchlists; "More" navigation sheet.
- Changed: daily history now requests ~5 years (falls back to ~2 years if Dhan refuses); service-worker cache `dp-v8`.
- New localStorage keys: `labcfg`, `btruns`, `journal`, `alerts`, `alertlog`, `alertquiet`, `calc`, `toolOpen`, `wlists`, `wlActive`, `sufilters`, `optUnd`, `optGex`, `optScan`. The default watchlist still uses V1's `watch`.
- Existing history caches (≈2 years) are used as-is; "Refresh history" with force is not needed: stale instruments refetch automatically, but a 5-year backtest needs a one-off full reload (clear the `dhan-pulse-history` IndexedDB or press Refresh after a day).

## Unreleased — Research foundation
- Added: Research tab (Breadth & regime, Screener, Sectors), Data tab, `analytics.js`, `history.js`, `providers.js`, docs/ set.
- Added: IndexedDB daily-history cache; new localStorage keys `rsub`, `rfilters`, `rweights`.
- Changed: service-worker cache `dp-v7`.
- Unchanged: all V1 screens, Dhan calls, credentials handling. No order functionality.
- Known: Dhan daily-bar adjustment and partial-bar behaviour unverified live.
