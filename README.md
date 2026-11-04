# Dhan Pulse

Read-only intraday market overview on the Dhan Data API: indices, sectors, F&O movers + breadth, holdings/positions, watchlist.
No backend. The app runs in your browser/phone and talks straight to `api.dhan.co`. You paste your Dhan client id + access token in **Settings**; they are stored only on that device (localStorage) and sent only to Dhan.

```
GitHub Actions: tests → build instruments.json (Dhan scrip master) → GitHub Pages
Browser PWA ──access-token──▶ api.dhan.co/v2   (quote, holdings, positions, profile, RenewToken only)
```

## Setup
1. Repo → Settings → Pages → Source: **GitHub Actions**. Push to `main` (or run the workflow).
2. On your phone open `https://<user>.github.io/<repo>/dhan-pulse.apk`, install it (allow "install unknown apps" for your browser once).
3. Open the app → ⚙ → Dhan client id + token (web.dhan.co → Profile → Access DhanHQ APIs) → Validate & save.

Every push rebuilds the APK with the same signing key, so reinstalling updates in place and keeps your saved token. The same page also works as a web app/PWA at the Pages URL (needs Dhan to allow browser CORS; the APK does not).

The token lasts 24h. On open, if it is >8h old and still valid, the app calls `RenewToken` and stores the new one. Open the app at least once a day; if it lapses, paste a new one. Settings shows the real expiry.

## Payoff terminal (Nifty + Sensex, analysis only)
Build multi-leg option strategies from the live Dhan option chain: 14 templates (straddles, strangles, vertical spreads, iron condor/butterfly, butterflies, 1x2 ratios), editable legs, expiry + "today" payoff curves, breakevens, max profit/loss, probability of profit, per-leg and portfolio greeks, scenario sliders (time passed, IV shift, spot move), saved strategies. It never places or stages orders.
- Pricing is Black-Scholes at 6.5% rate, no dividends, each leg's live IV. POP / expected P&L are model values, not forecasts.
- Lot sizes come from the scrip master at build time (editable in the tab if NSE/BSE revise them).
- Dhan limits the option chain to 1 request / 3 s, so the first load takes ~3-6 s.

## Live feed, charts, updates
- Quotes poll about once a second while the market is open (Dhan caps the quote endpoint at 1 request/second, so this is the REST ceiling; the option chain is capped at 1 per 3 s). Outside market hours it polls every 15 s.
- Tap any ticker (index, sector, stock, holding, watchlist, Payoff spot) for an OHLC chart: 1m to 1h presets, D/W/M, or any custom minutes, with SMA, volume, pan/zoom and a live last candle.
- Payoff legs take an Entry and optional Exit price. Exited leg P&L = exit - entry; open leg P&L = LTP - entry. Realised P&L is folded into the curve, max/min, POP and expected value.
- The APK is signed with a fixed committed key and a rising versionCode (the Actions run number), so new builds install over the old one. The signature fingerprint is printed in each run's summary. If your installed copy was signed with a different key, uninstall it once; after that updates are in place.

## Payoff terminal v2
- Layout follows the Quintal Mind terminal: stat grid, chart with BE/spot lines and an At-expiry / Today toggle, Buy-Sell pills with strike and lot steppers, saved Portfolios menu, option chain with a Greeks picker, IV under LTP, OI bars and an ATM badge, and a B/S popover with lots.
- No strategy templates: you build legs from the chain.
- Order log: every entry and exit is time-stamped (IST); edit the date/time or delete an order.
- "Your risk, in plain English" translates portfolio greeks into rupee outcomes, plus a spot x time x IV stress table.
- "Next step": ranks close / add / roll adjustments from the live chain by expected P&L + 0.5 x worst-5% average (model ranking, not advice). Apply edits only the simulator.
- Log tab: one P&L sample per minute while the market is open and the app runs, kept separately for the Dhan portfolio and for each Payoff strategy.

## Notes
- The APK is signed with a debug key committed in `android-shell/debug.keystore` (so updates install over each other). Fine for a personal sideloaded app; do not publish it to a store.
- Public repo is fine: no secrets are in it. The page is public but useless without your token.
- Anyone with your unlocked device can read the saved token. Use a device lock; no PIN/TOTP secret is ever stored.
- To verify on first live run: `net_change` is treated as absolute change vs previous close (falls back to `ohlc.close`); index names are matched by alias, and the build fails loudly if fewer than 8 match (`instruments.json` then lists `_allIndexNames`).

## Dev
`npm test` · `python3 test/instruments.test.py` · `npm run serve` (needs a locally built `public/instruments.json`: `npm run instruments`)
