# Master feature checklist

Statuses: NS not started · IP in progress · BD blocked — data provider · BL blocked — licence · IU implemented, unverified live · T tested (unit) · PV production verified · NA not applicable.
Nothing is "PV": no live Dhan session was available. "T" = covered by unit tests with hand-calculated cases.

| # | Module / feature | Status | Evidence / blocker |
|---|---|---|---|
| 1 | Home: index hero, breadth (today), sectors, movers, portfolio day | IU (V1) | `app.js` |
| 1 | Home: customisable widgets / saved layouts | NS | |
| 2 | Markets: live quotes | IU (V1) | REST polling only |
| 3 | Index explorer (returns, DMA state, constituents) | NS | constituents BD |
| 4 | Breadth: % > 20/50/100/150/200 DMA, 52w H/L, near-high, stage mix | T | analytics tests + smoke |
| 4 | Breadth: A/D history, thrust, up/down volume, percentile history | NS | needs stored daily snapshots |
| 4 | Regime score, editable weights, coverage | T | model; not backtested |
| 4 | Regime history / transitions / backtest | NS | |
| 5 | Sector view: return RS, momentum, quadrant | T (basic) | no constituents (BD) |
| 6 | Screener: price/RS/stage/trend filters, sort, search, CSV, add to watchlist | IU | fundamentals/ownership/volume-delivery filters BD |
| 6 | Nested AND/OR/NOT builder, saved screens, schedules | NS | filters are flat; saved screens not built |
| 6 | NL screener (AI) | NS | |
| 7 | RS rating, RS line new-high | T | universe-relative |
| 7 | Trend template (9 visible rules) | T | |
| 8 | Stage (daily approx) | T | heuristic, labelled |
| 8 | Stage history / episode ledger | NS | |
| 9 | Pattern scanners: 16 detectors with published rules, states, pivot/stop, CSV | T (unit) + smoke | no hit-rate/false-positive study; IPO base, gap-and-go NS |
| 10 | Company pages: price/technical profile | NS | financials, ownership, filings BD |
| 11 | Charts: candles, SMA, volume, intraday + D/W/M | IU (V1) | indicators beyond SMA, drawings, layouts NS |
| 12 | Calendar / filings | BD | |
| 13 | Options tab: PCR, max pain, straddle, OI levels/ΔOI, smile + skew, chain table (Nifty, Sensex) | T + smoke | single expiry; OI-vs-price interpretation per strike NS (no option prev close) |
| 13 | Option chain, Greeks, payoff, strategy builder (Nifty/Sensex) | IU (V1) | |
| 13 | GEX estimate with 3 sign scenarios + gamma flip; vertical/butterfly/ratio/condor scanners | T + smoke | 3-D IV surface, term structure, stock options, commodity/cross-contract spreads NS; options scanners by IV/OI across contracts NS |
| 14 | Equity backtest (RS momentum family, costs, filters, 70/30 split, sensitivity, saved runs) | T + smoke | survivorship-biased, price-only; options backtests BD (no historical chains); walk-forward/Monte-Carlo NS |
| 15 | Multiple named watchlists, CSV import/export, breadth of list | T + smoke | tags, notes, RS/Stage heatmap, snapshots NS |
| 15 | Alerts: 13 rule types, live vs EOD classes, cooldown, history, quiet hours | T + smoke | fires only while app is open; push/email BLOCKED on backend |
| 16 | Portfolio view (V1) + risk tab (vol, beta, drawdown, VaR/ES, concentration, correlation) | IU + T | CSV import, XIRR on holdings, sector/cap concentration (BD) NS |
| 17 | Mutual funds / ETFs / SIP / allocation | BD | AMFI etc. |
| 18 | Flows, ownership, participants | BD | |
| 19 | Macro, global | BD | |
| 20 | Trading journal: entry/CSV import, stats, grouping, mistakes tags | T + smoke | Dhan trade import, screenshots, AI summary NS |
| 21 | AI assistant | NS | |
| 22 | 17 calculators (trading, options, investing) | T | cost schedule unverified; margin estimator NS |
| 23 | Data sources/methodology/status page | IU | Data tab + docs/ |
| 24 | Admin / ops / audit / RBAC | NA now | single-user, no backend |
