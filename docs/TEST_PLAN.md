# Test plan

Run: `npm test` (node:test, 58 tests) and `python3 test/instruments.test.py`.

| Area | Coverage | File |
|---|---|---|
| SMA, returns, 52w range, RS score, percentile rank, trend template (incl. n/a handling), Stage (4 regimes + insufficient data), breadth, RS line, regime score (coverage, ordering), realised vol, PCR, max pain (hand-calculated), straddle, OI interpretation | unit | `analytics.test.js` |
| Session logic, partial-bar dropping, cache/refetch, failure collection, auth abort | unit | `history.test.js` |
| Status evaluation for every state, gaps never "healthy" | unit | `providers.test.js` |
| V1 Dhan client, payoff, candles, log, backfill | unit | existing |
| Research/Data tabs end to end in Chromium with a **mocked** Dhan API: load history → breadth/regime → screener search/filter/sort → sectors → data status, no console errors | manual smoke (script not committed; fixtures are synthetic) | — |

## Outstanding
- No live-Dhan verification of historical-bar semantics (adjustment, partial bar).
- No automated browser tests in CI.
- No performance test on a universe > 250 instruments.
- Screener CSV and watchlist-add are untested beyond the smoke run.
