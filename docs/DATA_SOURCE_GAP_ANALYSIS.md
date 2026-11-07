# Data source gap analysis

"Candidate" entries are leads to evaluate, **not** integrations. Licence/terms must be reviewed before any use; no scraping.
Dhan facts below are from this app's code; items marked ? need confirmation against current Dhan documentation or a live call.

| Dataset | Needed by | Dhan supplies? | Status | Candidate / action | Refresh |
|---|---|---|---|---|---|
| Live quotes, index levels | Home, Markets | Yes (`/marketfeed/quote`, REST, 1/s, ≤1000 instruments) | In V1 | WebSocket feed exists at Dhan; not used (?) | ~1 s |
| Daily OHLCV history | RS, Stage, breadth, charts | Yes (`/charts/historical`) | **Used now** (Research) | Adjusted vs unadjusted behaviour **unverified** (?) | EOD |
| Intraday candles ≤90 d | Charts, P&L backfill | Yes | In V1 | | on demand |
| Option chain live + Greeks + OI | Options | Yes (`/optionchain`, 1/3 s) | In V1 (Nifty, Sensex) | Add stock options (lane limit applies) | 3 s |
| Historical option chains | Options backtests | Not in V1 (expired-options endpoint ?) | Blocked — data provider | Evaluate Dhan expired-options data; else licensed vendor | EOD/intraday |
| Instrument master, lot sizes | Everything | Yes (scrip master CSV) | In V1 (build time) | Lot-size *history* not stored | daily |
| Holdings/positions | Portfolio | Yes | In V1 | Trade history/ledger endpoint not used (?) | 15 s |
| Fundamentals, statements | Screener, company pages | No | **Blocked — provider** | Licensed vendor or exchange XBRL | quarterly |
| Shareholding, pledges, bulk/block | Ownership | No | Blocked — provider | NSE/BSE disclosures | quarterly/daily |
| Announcements, results calendar, corporate actions | Events | No | Blocked — provider | NSE/BSE feeds | intraday |
| Adjusted price history (verified) | Backtests | Unknown | Blocked — verification | Test a known split; else corp-actions provider | EOD |
| Historical index constituents/weights | Point-in-time universes, backtests | No | Blocked — provider | NiftyIndices factsheets | monthly/semi-annual |
| Sector/industry classification (effective-dated) | Sectors | No | Blocked — provider | | quarterly |
| FII/DII flows, participant OI | Flows | No | Blocked — provider | NSE/SEBI/NSDL reports | daily |
| MF/ETF NAV, AUM, holdings | Funds | No | Blocked — provider | AMFI | daily/monthly |
| Macro India + global | Macro | No | Blocked — provider | RBI, MoSPI, FRED | varies |
| News, economic calendar | Events | No | Blocked — licence | | |

## Highest-risk dependencies (in order)
1. **Point-in-time constituents + adjusted prices + fundamentals**: without them an equity backtest is survivorship-biased. Backtesting is therefore *not built*; the Screener says it is current-universe only.
2. **Historical option chains**: option backtests are impossible without contract-level history.
3. **Fundamentals/ownership/filings**: every fundamental screen filter is blocked.
4. **Participant OI/FII-DII**: needs a scheduled ingest, therefore a backend.
