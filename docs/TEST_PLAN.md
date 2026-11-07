# Test plan

Run: `npm test` (node:test, 111 tests) and `python3 test/instruments.test.py`.

| Area | Coverage | File |
|---|---|---|
| SMA, returns, 52w range, RS score, percentile rank, trend template (incl. n/a handling), Stage (4 regimes + insufficient data), breadth, RS line, regime score (coverage, ordering), realised vol, PCR, max pain (hand-calculated), straddle, OI interpretation | unit | `analytics.test.js` |
| Session logic, partial-bar dropping, cache/refetch, failure collection, auth abort | unit | `history.test.js` |
| Status evaluation for every state, gaps never "healthy" | unit | `providers.test.js` |
| Indicators (incl. Wilder RSI worked example), 16 pattern detectors, backtest (incl. no-look-ahead), calculators/XIRR/SIP/costs, risk, journal, option spreads/GEX/skew, alerts, watchlists, tools defaults | unit | `indicators/patterns/backtest/calc/optionlab/alerts/watchlists/tools.test.js` |
| V1 Dhan client, payoff, candles, log, backfill | unit | existing |
| All new tabs end to end in Chromium with a **mocked** Dhan API (synthetic fixtures): history load → breadth/regime → setups scan → backtest run/save/sensitivity → option chain, condor scan, GEX → portfolio risk → calculators → journal → alert created and fired on EOD → watchlists → data status; zero console errors. The smoke caught one real bug (pattern id overwritten by security id). | manual smoke (script not committed) | — |

## Outstanding
- No live-Dhan verification of historical-bar semantics (adjustment, partial bar).
- No automated browser tests in CI.
- No performance test on a universe > 250 instruments.
- Screener CSV and watchlist-add are untested beyond the smoke run.
- Calculator cost rates and Dhan behaviours (adjusted bars, partial bar, option-chain field units such as IV in percent) are assumptions until checked against live data.
- Backtest results on synthetic data are meaningless; judge only on real history.
