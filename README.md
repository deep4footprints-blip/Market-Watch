# Dhan Pulse

Read-only intraday market overview on the Dhan Data API: indices, sectors, F&O movers + breadth, holdings/positions, watchlist.
No backend. The app runs in your browser/phone and talks straight to `api.dhan.co`. You paste your Dhan client id + access token in **Settings**; they are stored only on that device (localStorage) and sent only to Dhan.

```
GitHub Actions: tests → build instruments.json (Dhan scrip master) → GitHub Pages
Browser PWA ──access-token──▶ api.dhan.co/v2   (quote, holdings, positions, profile, RenewToken only)
```

## Setup
1. Push to GitHub (`main`). Repo → Settings → Pages → Source: **GitHub Actions**.
2. Open the Pages URL → ⚙ → client id + token (web.dhan.co → Profile → Access DhanHQ APIs) → Validate & save.
3. Add to home screen.

The token lasts 24h. On open, if it is >8h old and still valid, the app calls `RenewToken` and stores the new one, so opening it at least once a day keeps it alive. If it lapses, paste a new one. Settings shows the real expiry (decoded from the token).

## The one risk: CORS
Browsers only let a page call `api.dhan.co` if Dhan sends CORS headers. I could not test this from the build sandbox. If the app shows "Could not reach Dhan from the browser… CORS", run **Actions → Build Android APK → Run workflow** and install the APK from the artifact: the same UI wrapped in Capacitor with native HTTP, which has no CORS restriction. (Not yet run; first build may need a tweak.)

## Notes
- Public repo is fine: no secrets are in it. The page is public but useless without your token.
- Anyone with your unlocked device can read the saved token. Use a device lock; no PIN/TOTP secret is ever stored.
- To verify on first live run: `net_change` is treated as absolute change vs previous close (falls back to `ohlc.close`); index names are matched by alias, and the build fails loudly if fewer than 8 match (`instruments.json` then lists `_allIndexNames`).

## Dev
`npm test` · `python3 test/instruments.test.py` · `npm run serve` (needs a locally built `public/instruments.json`: `npm run instruments`)
