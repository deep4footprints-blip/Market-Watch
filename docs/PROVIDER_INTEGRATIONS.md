# Provider integrations

## Dhan (only connected provider)
- Auth: `access-token` + `client-id` headers; token 24 h; `RenewToken` used opportunistically. Stored in localStorage; sent only to `api.dhan.co`.
- Limits implemented in `dhan.js`: quotes 1 req/s (≤1000 instruments per call), option chain 1 per 3 s, chart lane 350 ms spacing. Bulk history for ~220 instruments therefore takes ≈ 80–90 s on first load; later loads fetch only stale instruments (6 h minimum cache, and only if the newest bar is older than the last completed session).
- Failure handling: auth errors abort a bulk run; network errors abort with cached data still shown; per-instrument failures are collected and shown, older cached bars keep being used.
- Not verified from this environment (no credentials): live response shapes for `/charts/historical` on indices vs equities, whether daily bars are split/bonus-adjusted, whether the in-progress session appears in daily bars (handled defensively: dropped before 16:00 IST).
- No WebSocket, no order endpoints. Do not add order placement to research features.

## Everything else
Not connected. See `DATA_SOURCE_GAP_ANALYSIS.md`. The Data tab shows each as "Not connected" and no screen substitutes values.
