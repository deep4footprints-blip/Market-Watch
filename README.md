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

## Notes
- The APK is signed with a debug key committed in `android-shell/debug.keystore` (so updates install over each other). Fine for a personal sideloaded app; do not publish it to a store.
- Public repo is fine: no secrets are in it. The page is public but useless without your token.
- Anyone with your unlocked device can read the saved token. Use a device lock; no PIN/TOTP secret is ever stored.
- To verify on first live run: `net_change` is treated as absolute change vs previous close (falls back to `ohlc.close`); index names are matched by alias, and the build fails loudly if fewer than 8 match (`instruments.json` then lists `_allIndexNames`).

## Dev
`npm test` · `python3 test/instruments.test.py` · `npm run serve` (needs a locally built `public/instruments.json`: `npm run instruments`)
