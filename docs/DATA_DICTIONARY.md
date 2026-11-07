# Data dictionary (current)

| Entity | Field | Meaning / unit | Source | Refresh |
|---|---|---|---|---|
| Daily bar | t, o, h, l, c, v | Unix seconds (session start), INR, shares | Dhan `/charts/historical` | once per session (≥6 h cache) |
| History record | fetchedAt, lastT | ms; last bar time (s) | local | per fetch |
| Research row | px | last completed daily close | derived | with history |
| | r1m/r3m/r6m/r12m | price return over 21/63/126/252 trading days | derived | |
| | rsRaw | weighted relative performance vs Nifty 50 (see METHODOLOGY) | derived | |
| | rs | cross-sectional percentile 1–99 in the loaded universe | derived | |
| | sma20…sma200 | simple MAs of closes | derived | |
| | hi, lo, offHigh, aboveLow | 252-bar **close** high/low; fractions | derived | |
| | stage | 1–4, slope, prior, conf | derived (heuristic) | |
| | tt | trend-template rule results, passed/total | derived | |
| Breadth | above20…200 | % of stocks with enough history above that MA | derived | |
| Regime | score 0–100, coverage 0–1, components | model output | model estimate | |
| Dataset status | status, asOf, note | see providers.js | runtime | live |

Every value above is a **derived metric** or **model estimate** from Dhan price history; none is an exchange-reported fact except the raw bars.
