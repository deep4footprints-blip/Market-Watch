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
| 6 | Nested AND/OR/NOT builder, saved screens, schedules | NS | |
| 6 | NL screener (AI) | NS | |
| 7 | RS rating, RS line new-high | T | universe-relative |
| 7 | Trend template (9 visible rules) | T | |
| 8 | Stage (daily approx) | T | heuristic, labelled |
| 8 | Stage history / episode ledger | NS | |
| 9 | Pattern scanners (VCP, cup, flags, pocket pivot…) | NS | feasible from bars |
| 10 | Company pages: price/technical profile | NS | financials, ownership, filings BD |
| 11 | Charts: candles, SMA, volume, intraday + D/W/M | IU (V1) | indicators beyond SMA, drawings, layouts NS |
| 12 | Calendar / filings | BD | |
| 13 | F&O: PCR, max pain, ATM straddle, OI interpretation (functions) | T | not yet in UI |
| 13 | Option chain, Greeks, payoff, strategy builder (Nifty/Sensex) | IU (V1) | |
| 13 | IV surface/skew, GEX, option & spread scanners | NS | GEX needs explicit sign assumptions |
| 14 | Backtesting (equity/options) | BD | point-in-time data |
| 15 | Watchlists (single) | IU (V1) | multiple, alerts, tags NS |
| 15 | Alerts engine | NS | needs backend for off-app alerts |
| 16 | Portfolio view (holdings/positions) | IU (V1) | risk analytics, import, XIRR NS |
| 17 | Mutual funds / ETFs / SIP / allocation | BD | AMFI etc. |
| 18 | Flows, ownership, participants | BD | |
| 19 | Macro, global | BD | |
| 20 | Trading journal | NS | feasible client-side |
| 21 | AI assistant | NS | |
| 22 | Calculators | NS | pure functions, low risk |
| 23 | Data sources/methodology/status page | IU | Data tab + docs/ |
| 24 | Admin / ops / audit / RBAC | NA now | single-user, no backend |
