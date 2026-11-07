# Methodology (implemented in `public/analytics.js`, tested in `test/analytics.test.js`)

All metrics are EOD, price-only (no dividends), computed from Dhan daily bars. A bar for the current session is dropped until 16:00 IST. Holidays are not modelled. Adjustment of Dhan's daily series for splits/bonuses is **unverified**: until confirmed, treat long-horizon returns across corporate actions with caution.

## Returns
`ret(n) = close[t] / close[t-n] - 1`, with n = 21/63/126/189/252 trading days for 1/3/6/9/12 months. Null if fewer bars.

## RS score and rating
Per period p with weight w: `rel_p = (1+r_stock)/(1+r_bench) - 1`; `score = Σ w·rel_p / Σ w`. Default weights 40% 3M, 20% 6M, 20% 9M, 20% 12M (a convention, not the only valid choice). A stock needs **all** weighted periods or gets no score. Benchmark: Nifty 50 (price index).
**Rating** = percentile rank 1–99 of `score` within the loaded universe (F&O stocks, not the whole market). Ties share the average rank. The rating is therefore relative to this universe and changes if the universe changes.
RS line = stock close / Nifty close by date; "new high" = latest value ≥ max of last 252 points.

## Trend template (9 configurable rules)
Price > 50, 150, 200 DMA; 50 > 150; 150 > 200; 200 DMA > its value 21 bars ago; ≥ 30% above 52w low; within 25% of 52w high; RS rating ≥ 70. 52w high/low use **closes** over 252 bars. The brief calls this an "eight-condition" template but lists nine rules; all nine are implemented and each pass/fail is shown. A rule lacking data is "n/a" and excluded from the denominator (marked `*`), never silently failed.

## Stage (daily approximation of Weinstein)
MA = 150-day SMA (≈30 weeks). `slope = MA/MA[-21]-1`, `prior = MA[-21]/MA[-84]-1`, flat band ±1%.
Price>MA & slope>band → 2; Price<MA & slope<−band → 4; otherwise 3 if the MA rose before (`prior>band`) and price is above/flat, 1 if it fell before; ambiguous mixes fall to 1/3/4 by sign. Confidence "low" when price is within 2% of the MA. This is a transparent heuristic, **not** a definitive Weinstein classification, and uses daily rather than weekly data. The MA lags, so Stage 1/3 appear only after the MA has flattened.

## Breadth
Share of stocks above each MA (over stocks that have that many bars; coverage shown). New 52w highs/lows = close at/above/below the 252-bar close extreme. "Near high" = within 5/10/20% of it. Universe = Nifty F&O stocks, **today's list**: survivorship bias applies; there is no point-in-time membership.

## Regime score (model, 0–100)
Components 0–1: **trend** (Nifty: >50DMA, >200DMA, 50>200, 200DMA rising; 25% each), **breadth** (mean of % above 50 and 200 DMA), **momentum** (Nifty 3M return mapped −10%→0, +10%→1), **volatility** (India VIX percentile in its own 1y, inverted), **drawdown** (distance below 52w close-high: 0%→1, ≥20%→0). Default weights 30/30/15/15/10, user-editable and re-normalised over the components that have data. Missing inputs are excluded and reported as lower **coverage**. Bands: ≥80 strong risk-on, ≥60 constructive, ≥40 mixed, ≥20 defensive, else risk-off. Not a forecast; not backtested.

## Sector view
Sector index vs Nifty 50: `rel3 = (1+r3_sector)/(1+r3_nifty)-1`; momentum = `rel3(now) − rel3(21 bars ago)`. Quadrants Leading/Weakening/Lagging/Improving by the signs. Simple return-based rotation; **not** the licensed JdK RS-Ratio/RS-Momentum.

## Options helpers (tested; not yet in the UI)
PCR = Σ put / Σ call (OI or volume, all listed strikes). Max pain = strike minimising Σ OI × intrinsic payout to buyers (descriptive; does not predict settlement). ATM straddle = CE+PE LTP at the strike nearest spot; premium-implied move = straddle/spot (rough, assumes nothing about distribution). OI interpretation: price↑ & OI↑ long buildup; price↓ & OI↑ short buildup; price↑ & OI↓ short covering; price↓ & OI↓ long unwinding.

---
# Release 2 additions

## Indicators (`indicators.js`, tested)
SMA, EMA (seeded with the SMA), RSI(14) (Wilder; matches the StockCharts worked example), MACD(12,26,9), ATR(14) (Wilder), Bollinger(20,2) (population sd) with bandwidth, ADX/DMI(14) (Wilder), Stochastic(14,3), Donchian, relative volume (volume ÷ mean of the previous n sessions, today excluded).

## Pattern detectors (`patterns.js`, rules listed in the Setups tab and in code)
52-week breakout, flat base, VCP, high tight flag, cup-and-handle, double bottom, Darvas box, tight weekly closes, pullback to 20/50 DMA, pocket pivot, relative-volume breakout, volume climax, NR7/inside bar, 50/200 DMA cross, 20/50 EMA cross, RSI breakout/recovery. Each has numeric thresholds, a state (forming / near trigger / breakout / failed), a pivot and an invalidation level (stop). The **score** is the share of optional quality checks passed, not a probability. Detectors are rule-based approximations: they have no measured hit rate here, and no historical pattern-performance or false-positive study has been run. IPO base and gap-and-go are not implemented (need listing dates / intraday history).

## Equity backtest (`backtest.js`, tested incl. a no-look-ahead test)
Long-only, equal-weight slots, Nifty F&O stocks vs Nifty 50. Signals at the close of day i, fills at the open of day i+1 plus slippage; costs bps per side; optional filters (price > 200 DMA, Stage 2, min RS rating, near-high, cash when Nifty < 200 DMA), buffer ranks, stop-loss (exit next open). Reports total return, CAGR, volatility, Sharpe/Sortino (user risk-free rate), max drawdown and its longest duration, Calmar, win rate, profit factor, turnover, exposure, costs, monthly returns, full ledger, a fixed 70/30 stability split, and a parameter-grid spread. **Known biases, shown with every run:** survivorship (today's list), no point-in-time membership/fundamentals, price-only, unverified corporate-action adjustment, flat slippage with no volume constraint, no taxes. Runs are saved with config, data as-of date, universe size and engine version (`bt-1`) and are never overwritten. Options backtests, walk-forward and Monte-Carlo are not implemented (no historical option data).

## Options lab (`optionlab.js`, tested)
Spread scanner on the live chain: verticals, 1:2:1/1:3:2/1:4:3/1:5:4 butterflies, 1:2…1:5 ratio spreads, iron condors/butterflies. Buys at ask, sells at bid (LTP fallback flagged). Expiry payoff is exact (piecewise-linear evaluated at strikes and beyond both ends); breakevens interpolated. IV smile from OTM options and a 5%-wing skew; OI levels. **GEX estimate:** `gamma × OI × lot × spot² × 1%` with three explicit sign scenarios (calls+/puts−, all long, inverse); gamma from Dhan or Black-Scholes from the option's IV; gamma flip by re-pricing on a ±10% spot grid. It is an estimate: dealer positioning is not observable.

## Calculators (`calc.js`, tested)
CAGR, XIRR (bisection), SIP/step-up (monthly rate (1+a)^(1/12)−1, start-of-month), lump vs SIP, real return, compounding, drawdown recovery, FD vs market, rebalancing, overlap, position size (stop or ATR, lot rounding, cap), reward:risk, expected move, futures basis, option breakeven, Black-Scholes value/Greeks/IV, PCR/max pain from pasted chains, itemised order costs. The cost schedule (`CHARGES`) is an **editable, unverified assumption**: STT, exchange, stamp and brokerage rates change by circular and were not checked against current notifications.

## Portfolio risk (`risk.js`, tested)
Current value weights applied to the last ≤252 daily returns: annualised volatility, beta vs Nifty 50, max drawdown, historical-simulation VaR/ES at 95% (≥100 observations), Herfindahl/effective holdings, correlation matrix.

## Alerts (`alerts.js`, tested)
Rules are classed **live** (REST quote polling while the app is open) or **eod** (completed daily bars, re-checked after analytics refresh). States: active, paused, triggered, expired; once/recurring with cooldown; quiet hours (IST) mute announcements but still log. No delivery when the app is closed.

## Journal (`journal.js`, tested)
P&L = side × (exit − entry) × qty − fees; R = P&L ÷ (|entry − stop| × qty); win rate, profit factor, expectancy, max drawdown of the realised curve, grouping by setup/stock/side/mistake tag. Only recorded trades feed any figure.
