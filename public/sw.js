// App-shell cache only. /api/* is never cached (prices must be live, and responses hold portfolio data).
const V = "dp-v8";
const SHELL = ["./", "index.html", "style.css", "app.js", "dhan.js", "payoff.js", "payoff-ui.js", "dom.js", "viz.js", "candles.js", "chart-ui.js", "pnllog.js", "log-ui.js", "backfill.js", "analytics.js", "history.js", "providers.js", "research-ui.js", "indicators.js", "patterns.js", "backtest.js", "calc.js", "risk.js", "journal.js", "optionlab.js", "alerts.js", "watchlists.js", "ui-kit.js", "setups-ui.js", "lab-ui.js", "options-ui.js", "tools-ui.js", "journal-ui.js", "alerts-ui.js", "risk-ui.js", "manifest.json"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/") || u.pathname.endsWith("instruments.json")) return;
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(V).then((x) => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
