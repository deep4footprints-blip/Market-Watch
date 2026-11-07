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
