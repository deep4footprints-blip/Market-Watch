# Implementation roadmap

Re-scoped to what the real V1 (client-only, Dhan-only) can honestly deliver. Status reflects this repository today.

| Release | Scope | Status | Acceptance |
|---|---|---|---|
| 0 Audit & foundations | Docs; provider catalogue + data-status page; daily-history store; pure analytics with tests | **Done** | `npm test` green; Data tab lists every dataset with honest status |
| 1 Market workstation | Breadth (% > DMA, 52w H/L, stage mix), regime score with editable weights, sector relative strength; V1 already has indices/sectors/movers/watchlist | **Core done**, partial | Needs: multiple watchlists, alerts, index explorer, saved dashboard layouts |
| 2 Equity research | Screener on RS / Stage / trend template (done). Blocked: fundamentals, ownership, filings, patterns not started | **Partial** | Pattern scanners (VCP, flags) next: pure functions on daily bars; no new data needed |
| 3 Systematic + AI | Backtests, journal done; saved screens, NL screener, AI assistant not built | **Partial** | Backtests blocked by point-in-time data (see gap analysis). Journal feasible client-side |
| 4 Derivatives | Options tab, GEX estimate, spread scanners shipped; Payoff lab in V1 | **Mostly done** | Next: Options tab (chain summary, OI, PCR, max pain, IV skew), GEX with explicit sign assumptions |
| 5 Portfolio & funds | Risk tab, calculators shipped; funds/ETF/allocation backtests need AMFI (provider-blocked, skipped per owner decision) | **Partial** | Portfolio risk (correlation, beta, concentration) is feasible from daily bars |
| 6 Macro/flows | All blocked on providers and a backend for scheduled ingest | Not started | |
| 7 Hardening | In-app alerts shipped; backend alerts, ops, security review pending | Partial | Needs backend |

## Decisions that need the owner
1. Add a backend (alerts, scheduled ingest, sync) — yes/no, and where it runs.
2. Which licensed provider(s) for fundamentals/constituents/corporate actions.
3. Whether to keep the F&O stock list (~200) as the research universe or fund a broader NSE universe (needs ~1,500 history calls per refresh; slow at Dhan's chart pacing, so a backend ingest is better).

## Owner decisions recorded
- Backend: **yes** (not yet built: needs a hosting choice, an auth scheme and a decision on storing the Dhan token server-side; see CURRENT_ARCHITECTURE).
- Data: use only what Dhan provides; skip modules that need other providers (fundamentals, ownership, filings, flows, macro, funds). These stay 'Not connected'.
- Scope: build everything the Dhan data can honestly support.
