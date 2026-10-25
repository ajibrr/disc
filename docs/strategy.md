# Strategy — HTF Pattern Confirmation + LTF Condition Chain

> **Status: IMPLEMENTED as a simulation.** Signals (HTF patterns A / B, then LTF conditions C1 → C5), the entry and exit rules and the
> statistics (hit ratio, profit and loss, drawdown …) are built, tested and shown on the page. There is **no live trading and no order
> logic** — it replays the recorded sessions. Results are **points for 1 unit** and come from a handful of sessions, so they illustrate the
> rules; they are **not evidence of profitability**.

> **Strategies are now a registry.** `config/strategies.json` lists every strategy with an `enabled` switch and its own `trade` rules.
> This document describes **SB_Bhanusali**.
> Pick one in the page's **Strategy** drop-down or with `node scripts/run-backtest.js --strategy SB_Bhanusali`.
> How to add a strategy: [strategies.md](strategies.md).

Related documents: [analysis.md](analysis.md) (findings and next steps) · [htf-pattern.md](htf-pattern.md) · [ltf-pattern.md](ltf-pattern.md) ·
[ltf.md](design/ltf-conditions-plan.md) (per-condition specs) · [ltf-condition5.md](ltf-condition5.md) · [README.md](../README.md).

---

## 1. Idea in one paragraph

Watch two timeframes locked at **5 : 1** (for example 1m LTF with 5m HTF). The **HTF** chart looks for a **Pattern A** or **Pattern B**
candle structure that also passes a slope filter and an RSI filter. Each Matched HTF candle highlights a **zone** of 5 LTF candles.
Inside and after that zone the **LTF** chart looks for a candle that passes a chain of six conditions (**C1 → C5**). The candle that
passes all six (C1 → C6) is the **signal candle** (the *E candle*). **Pattern A is the bullish-structure side, Pattern B the mirror image.**

```
 HTF: Pattern A / B  ──►  zone on LTF  ──►  C1 ──► C2 ──► C3 ──► C4 ──► C5  ──►  signal candle (E candle)  ──►  ENTRY  ──►  EXIT
 (3 layers, section 2)    (5 LTF candles)    (section 3)                                                    (section 5)  (section 6)
```

---

## 2. Step 1 — HTF Pattern A / Pattern B

A completed HTF candle is **Matched** only if every *enabled* layer passes, each in its own direction.
Full rules: [htf-pattern.md](htf-pattern.md) · settings: [config/htf.json](../config/htf.json).

| Layer | Pattern A | Pattern B |
|---|---|---|
| 1. Five-candle shape | two red candles in a row, the second lower on both high and low, after a recent high (rules 1–4 + 5A or 5B) | two green candles in a row, the second higher on both high and low, after a recent low |
| 2. SMA 9 slope (ATR-normalized, lookback 3) | slope **>** `minimum_slope` (rising) | slope **<** −`minimum_slope` (falling) |
| 3. SMA 14 of RSI 14 | **<** 65 | **>** 35 |
| 4. Option-chain OI change (candle −1) | **PE** change **>** **CE** change | **CE** change **>** **PE** change |

Current `minimum_slope` is 0.25 (read it from `config/htf.json`; it changes). **Layer 4 is currently switched off** (`oi_change_filter.enabled: false`, see [analysis.md](analysis.md) §2), so in practice a candle needs layers 1–3. A Matched candle shades its 5 LTF candles (the **zone**),
revealed at the HTF close and never earlier.

---

## 3. Step 2 — LTF condition chain (C1 → C6)

Each condition only **filters** the previous one. Full rules, worked examples and settings: [ltf-pattern.md](ltf-pattern.md).
Settings: [config/ltf.json](../config/ltf.json).

| # | Condition | Pattern A | Pattern B |
|---|---|---|---|
| **C1** | **RSI 50 cross** — on any candle in the search span (the zone's 5 candles included), RSI 14 crosses 50 in the pattern's direction | previous RSI **< 50**, current RSI **> 50** | previous RSI **> 50**, current RSI **< 50** |
| **C2** | **SMA trend** — SMA 9 vs SMA 44 on that candle | SMA 9 **>** SMA 44 | SMA 9 **<** SMA 44 |
| **C3** | **Spread band** — (SMA 9 − SMA 44) ÷ SMA 44 × 100, in percent | **0 < spread ≤ +0.020** | **−0.020 ≤ spread < 0** |
| **C4** | **SMA-of-RSI extreme** — SMA 14 of RSI 14, **any one** of the candles 1 … 20 before the arrow (`lookback_min_candles` … `lookback_max_candles`) | **> 67.50** (and ≤ `pattern_a_max`, 100) | **< 32.50** (and ≥ `pattern_b_min`, 0) |
| **C5** | **Distance ratio** — room to the recent extreme vs the size of the candle's own move | back candle distance **>** 2 × E candle distance, using the **highest high** of the previous 20 candles | back candle distance **>** 2 × E candle distance, using the **lowest low** of the previous 20 candles |
| **C6** | **Risk range** — the E candle distance (the trade's risk, i.e. the stop distance) must lie in a range | **3.5 ≤** E distance **< 8** points | **3.5 ≤** E distance **< 8** points |

- **Search span:** crossings at positions `scan_min_candles` … `scan_max_candles` (1 … 20) counted from the zone's first candle; a newer zone ends an older zone's search.
- **Distances (C5):** Pattern A — E candle distance = E high − E−1 low, back candle distance = back high − E high.
  Pattern B — E candle distance = E−1 high − E low, back candle distance = E low − back low.
- **All comparisons are strict**; RSI exactly 50, a spread exactly on a limit, equal averages etc. are handled as written in the per-condition specs.
- **One arrow per candle**, showing the highest level reached: `C1`, `C1+C2`, `C1+C2+C3`, `C1+C2+C3+C4`, or `C1+C2+C3+C4+C5`.
  **Only the last active level is a full signal candle: `C1+C2+C3+C4+C5+C6` (or `C1+C2+C3+C4+C5` when C6 is switched off in `config/ltf.json`).** With C6 on, a `C1…C5`-only arrow (shown in muted purple) is a candle whose risk was outside the range (under 3.5 or 8 and over) — it is not traded.
- Every number above (RSI level, SMA periods, spread limits, thresholds, lookbacks, multiplier) is configurable in the two config files.

**Signal candle (E candle)** = the candle carrying the pink `C1+C2+C3+C4+C5` arrow (⬆ for Pattern A, ⬇ for Pattern B).

---

## 4. Direction

| | Pattern A | Pattern B |
|---|---|---|
| Signal candle (E candle) | pink ⬆ `C1+C2+C3+C4+C5 A` | pink ⬇ `C1+C2+C3+C4+C5 B` |
| **Trade direction** | **LONG** | **SHORT** (the exact opposite) |

---

## 5. Entry — as built

| Rule | Long (Pattern A) | Short (Pattern B) |
|---|---|---|
| Trigger | the E candle with the full `C1+C2+C3+C4+C5 A` arrow | the E candle with the full `C1+C2+C3+C4+C5 B` arrow |
| Direction | buy | sell |
| **Entry time** | the **next candle after the E candle** … | … same |
| **Entry price** | the **open of that candle** | the **open of that candle** |
| Lower levels (`C1` … `C1+C2+C3+C4`) | never trade | never trade |
| Positions | **one at a time** — a signal whose entry falls inside an open trade is skipped | same |
| No next candle (E candle is the last of the session) | no trade | no trade |
| **No entry from 15:10 IST** | a candle that would open at or after **15:10:00** is never entered | same |

**No look-ahead rule.** Because C1 counts crossings on the HTF zone's own candles, an E candle can sit *inside* a zone whose HTF candle has
not closed yet — the pattern is only known at the zone's close. The entry therefore waits for the first candle that opens at or after **both**
the E candle's close **and** the zone's close. Usually that is simply the next candle; the simulation records any delay.

---

## 6. Exit — as built

The **stop** is measured in points from the entry price, using the signal's **E candle distance** as the risk unit
(Pattern A = E high − E−1 low, Pattern B = E−1 high − E low). The **target** depends on `target_mode` (shipped: `previous_extreme`).

| | Long (Pattern A) | Short (Pattern B) |
|---|---|---|
| **Stop loss** | entry **−** `stop_multiple` × E candle distance | entry **+** `stop_multiple` × E candle distance |
| **Target** — `target_mode: "previous_extreme"` *(shipped)* | the **highest high** of the previous 20 candles before the E candle (the C5 *back high*) | the **lowest low** of those 20 candles (the C5 *back low*) |
| Target — `target_mode: "multiple"` | entry **+** `target_multiple` × E candle distance | entry **−** `target_multiple` × E candle distance |
| Shipped values | `stop_multiple` = 1, `target_mode` = `previous_extreme` (`target_multiple` 2 is only used in `multiple` mode) | same |

With `previous_extreme` the reward is whatever distance the market left to that high / low, so the reward : risk **varies per trade** (C5 guarantees the back distance is above 2 × the E distance, measured from the E candle). The window is C5's `back_candles` (20) in `config/ltf.json`. If the back high / low is not beyond the entry price when the trade would enter (price has already passed it) the signal is skipped (`target-behind-entry`).
Hit ratio goes down and the average win goes up: in the first back-test with it (8.1-1) the hit ratio fell from 38.6 % to 31.8 % while total P&L rose from +40.20 to +80.95 pts.

| Rule | Behaviour |
|---|---|
| Which is hit first | the **second-by-second ticks are replayed** after the entry; whichever level a tick reaches first ends the trade (so a stop and a target inside the same candle are never guessed from the candle's high / low) |
| Fill | exactly at the stop / target price (a gap through a level still fills at the level); optional fixed `round_trip_cost_points` (0 by default) |
| **Hard exit 15:19 IST** | whatever the trade is doing, if it is still open at **15:19:00** it is closed at the price of the first tick at or after that time (`HARD`) — at a profit or a loss. A stop or target is only taken if it is reached **before** 15:19 |
| Neither level reached and no hard exit time set | closed at the **last price of the session** (`EOD`) |
| Other exits | none (no opposite-signal, RSI or trailing exit) |
| Size | 1 unit; results in points; **R** = pnl ÷ E candle distance |

*Example (Pattern A, NIFTY 22-10-2026, E candle 12:58:48): E candle distance 15.40, next candle opens at 12:59:00 at 22716.55 → stop 22701.15,
target 22747.35. Price reached the stop at 13:02:05 → −15.40 points (−1 R).*

Settings: [config/strategies.json](../config/strategies.json) → `SB_Bhanusali.trade` — `stop_multiple`, `target_multiple`, `round_trip_cost_points`, and the session rules
`no_entry_from` ("15:10") and `hard_exit_at` ("15:19") — clock times in **IST**, either one can be `null` to switch that rule off
(`node scripts/build-config.js` and reload after editing; invalid settings fail closed). Because of the hard exit, the 15:30 close is never reached by a trade.

---

## 7. Statistics reported

| Measure | Meaning |
|---|---|
| Trades · wins · losses · flat | counted by the sign of the P&L |
| **Hit ratio (win rate)** | wins ÷ trades |
| Exits | how many ended at the target, at the stop, at the **hard exit (15:19)**, at the end of the session |
| **Total P&L** · average per trade · average **R** | in points / in multiples of the risk |
| Average win · average loss · best · worst | points |
| **Profit factor** | gross profit ÷ gross loss (∞ if there are no losses) |
| **Max drawdown** | largest fall of the running total from its highest point, in points |
| Longest losing streak | consecutive losing trades |
| LONG / SHORT split | the same measures for Pattern A and Pattern B separately |

**Where to see them**
- **On the page:** the toolbar badge `Strategy: 2 trades · hit 50% · P&L +10.70 pts` for the session and LTF on screen (green / red by P&L;
  hover for the full breakdown). On the LTF chart each trade shows a white **LONG @ / SHORT @** square at the entry and a **TP / SL / EOD** circle
  at the exit (green for profit, red for loss; **HARD** marks a 15:19 hard exit).
- **Browser console** (F12, or Cmd+Option+J on a Mac): each time the LTF chart is evaluated a `[strategy] NIFTY 2026-10-23 12s — 2 trades, 1 wins / 1 losses …`
  group appears with a trade-by-trade table and the statistics line (expand the group).
- **All recorded sessions at once (terminal):** `node scripts/run-backtest.js` (add `--trades` for every trade, `--ltf 12,36` to pick timeframes,
  `--json` for machine-readable output, `--out backtest.log` to also save the report to a log file).
- **What-if without editing any file:** `node scripts/run-backtest.js --set ltf.condition_5_distance_ratio.distance_multiplier=2 --set strategy.target_mode=multiple --set strategy.target_multiple=3` (`strategy.` changes the `trade` rules of every strategy selected for that run).

---

## 8. Results on the recorded data

> Always re-run `node scripts/run-backtest.js` for the current files. The numbers below are snapshots; 8.0000 is the latest (risk range 3.5–8), 8.000 the same with 3.5–6, other ranges untuned, 8.00 an earlier C1 / C3 / C4 tuning experiment, 8.0 the risk range 3–6, 8.1 the earlier risk range 2–6 with the previous-extreme target, 8.1-1 the earlier risk-below-5 runs, 8.1b the run without C6, 8.2 and 8.3 are earlier runs kept for comparison.
> Points, 1 unit, no costs, exact fills. **A small sample, not evidence of profitability.**
> **Timeframes:** the page and the back-test now run only **12s (HTF 1m) and 36s (HTF 3m)**. The tables below were made when five pairs were tested; the 60s / 180s / 300s pairs contributed 1 trade out of 44, so the totals barely change (with the 2–6 risk range: 39 trades, +111.65 pts, profit factor 2.60 on 12s + 36s).

### 8.0000 Latest run — as configured now: C6 risk 3.5–8 (C1 1–20, C3 0–0.02, C4 1–20 untuned; 12s + 36s, no costs)

The only change from 8.000 is C6's maximum risk, 6 → 8. It admits a few larger-risk signals (for example 23-10, 13:36:12: E distance 7.35, long, target hit, +19.15).

| | Risk 3.5–6 (8.000) | **Risk 3.5–8 (shipped now)** |
|---|---|---|
| Trades (wins / losses) | 17 (11 / 6) | **21 (14 / 7)** |
| **Win rate** | 64.7 % | **66.7 %** |
| Total P&L | +112.40 pts | **+157.50 pts** |
| Average win · average loss | +12.47 · −4.13 | **+13.49 · −4.49** |
| Best · worst | +16.40 · −5.00 | **+19.15 · −6.65** |
| Profit factor | 5.54 | **6.02** |
| Max drawdown · longest losing streak | 9.35 · 2 | **14.30 · 3** |
| LONG (A) · SHORT (B) | 5 trades 60.0 % · 12 trades 66.7 % | **6 trades 66.7 % · 15 trades 66.7 %** |
| Older half · newer half | 6 trades 67 % · 11 trades 64 % | **6 trades 67 % · 15 trades 67 %** |

All the extra trades fall in the newer half. **Held-out check** ([optimization.md](optimization.md) §10b): letting the search tune C6's maximum risk on part of the data and trade the rest gave a held-out win rate of 56 % / 63 % / 59 % (6 folds / 10 folds / one day at a time) against 64.7 % for the fixed 3.5–6 — the search picked 8 in 5 of 6, 9 of 10 and 27 of 29 folds, so 8 is a stable choice, but it **did not beat the untuned 6** on unseen days: more trades, about the same win rate, similar points. Treat 6 and 8 as equivalent.

### 8.000 Latest run — as configured now: C1 1–20, C3 0–0.02, C4 1–20 (untuned) and C6 risk 3.5–6 (12s + 36s, no costs)

Chosen with the cross-validation in [optimization.md](optimization.md) §10: the held-out evidence supported **one** change (a higher minimum risk) and none of the other tuned ranges.

| | Risk 3–6 (8.0) | **Risk 3.5–6 (shipped now)** |
|---|---|---|
| Trades (wins / losses) | 23 (14 / 9) | **17 (11 / 6)** |
| **Win rate** | 60.9 % | **64.7 %** |
| Total P&L | +129.95 pts | **+112.40 pts** |
| Average win · average loss | +11.77 · −3.87 | **+12.47 · −4.13** |
| Profit factor | 4.73 | **5.54** |
| Max drawdown · longest losing streak | 12.80 · 3 | **9.35 · 2** |
| LONG (A) · SHORT (B) | 9 trades 66.7 % · 14 trades 57.1 % | **5 trades 60.0 % · 12 trades 66.7 %** |
| By LTF | 12s 21 trades · 36s 2 | **12s 15 trades 66.7 % (+104.40) · 36s 2 trades 50.0 % (+8.00)** |
| Older half · newer half | 10 trades 50 % · 13 trades 69 % | **6 trades 67 % · 11 trades 64 %** |

17 trades on 12 days; every trade's risk lies between 3.50 and 5.75 points. In-sample, like the rest of this section — on unseen days the cross-validation points to about **50–60 %**, not 65 %.

### 8.00 Earlier experiment — C1 7–31, C3 max 0.017, C4 14–19 on top of the 3–6 risk range (no longer shipped)

Result: 12 trades (9 wins, 75.0 %), +99.25 pts, PF 10.15. It was **replaced** because the cross-validation ([optimization.md](optimization.md) §10) showed that stacking tuned ranges like these did not hold up on unseen days (held-out win rate fell to 23–54 % with 2 or more tuned changes). Kept here for reference.

### 8.0 Latest run — risk range 3 to 6 points (C6), aiming for a high win rate; 12s + 36s only (config as shipped, no costs)

Same 29 NIFTY sessions; the page and back-test now run only 12s (HTF 1m) and 36s (HTF 3m). The change from 8.1: C6's minimum risk is **3** instead of 2. C5 (distance ratio) was deliberately left untouched.

| | Risk 2–6 (8.1, same 2 timeframes) | **Risk 3–6 (shipped now)** |
|---|---|---|
| Trades (wins / losses) | 39 (16 / 23) | **23 (14 / 9)** |
| **Win rate** | 41.0 % | **60.9 %** |
| Total P&L | +111.65 pts | **+129.95 pts** |
| Average win · average loss | +11.34 · −3.0 | **+11.77 · −3.87** |
| Profit factor | 2.60 | **4.73** |
| Max drawdown · longest losing streak | 12.60 · 4 | **12.80 · 3** |
| LONG (A) | — | **9 trades, 66.7 %, +52.65** |
| SHORT (B) | — | **14 trades, 57.1 %, +77.30** |
| Older half (09-09 … 30-09) · newer half (from 01-10) | 21 trades · 33 % · newer 19 · 47 % | **10 trades · 50 % · newer 13 trades · 69 %** |

Every trade's risk lies between 3.15 and 5.75 points. **How much to trust the 60.9 %:** the jump from 41 % to 61 % is the in-sample number — the minimum was chosen using these same trades. When the same kind of choice was made on one half of the sessions and judged on the other, the win rate on the unseen half was about **50 %** (see [optimization.md](optimization.md) §7). Expect something between the two on new days. 23 trades is also a small sample.

### 8.1 Earlier: risk range 2 to 6 points (C6) and the previous-extreme target, config as shipped (slope 0.25, C5 multiplier 2, OI layer off, no costs)

Same 29 NIFTY sessions and five timeframes as below. C6 now keeps only signals whose E candle distance (the stop distance) is **at least 2 and below 6 points**, long and short alike; the target is the previous high (long) / low (short) of the 20 back candles.

| | **Range 2–6 + previous-extreme target** |
|---|---|
| Trades (wins / losses) | **40 (16 / 24)** |
| Hit ratio | **40.0 %** |
| Total P&L | **+106.15 pts** |
| Average win · average loss | **+11.34 · −3.14** |
| Best · worst | **+16.40 · −5.50** |
| Profit factor | **2.41** |
| Max drawdown · longest losing streak | **14.40 · 4** |
| LONG (A) | 13 trades, 46.2 %, +39.50, PF 2.63 |
| SHORT (B) | 27 trades, 37.0 %, +66.65, PF 2.31 |
| By LTF | 12s 37 trades, 40.5 %, +103.65 · 36s 2 trades, +8.00 · 60s 1 trade, −5.50 |

Every trade's risk lies between 2.00 and 5.75 points. **Read this carefully:** the range was chosen *after* [analysis.md](analysis.md) §3b showed that signals with a risk under 3 points almost never won (2 of 24) — the lower edge (2) is therefore tuned to the same 44 trades and flatters this result. Check it on sessions not used here.

### 8.1-1 Earlier: risk below 5 points only (C6 as first added), 2 × E distance target vs previous-extreme target

Same sessions; the only change is the first version of LTF Condition 6 (every trade's risk below 5 points, long and short, no minimum).

| | Without C6 (8.1b) | **With C6** |
|---|---|---|
| Trades (wins / losses) | 55 (22 / 33) | **44 (17 / 27)** |
| Hit ratio | 40.0 % | **38.6 %** |
| Total P&L | +52.30 pts | **+40.20 pts** |
| Average win · average loss | +7.98 · −3.73 | **+6.65 · −2.70** |
| Worst trade | −15.40 | **−4.35** |
| Profit factor | 1.42 | **1.55** |
| Max drawdown · longest losing streak | 23.10 · 6 | **14.75 · 6** |
| LONG (A) | 17 trades, +20.45, PF 1.47 | **13 trades, 38.5 %, +15.15, PF 1.68** |
| SHORT (B) | 38 trades, +31.85, PF 1.40 | **31 trades, 38.7 %, +25.05, PF 1.50** |
| By LTF | 12s 50 trades +59.50 · 36s 4 · 60s 1 | **12s 42 trades, 35.7 %, +27.50 · 36s 2 trades, +12.70 · 60s and up: 0** |

C6 removes 11 trades (all with a risk of 5 points or more). The total profit is lower, but the risk per trade, the drawdown (−36 %) and the worst loss (−15.40 → −4.35) are all lower and the profit factor is higher. The largest single loss in the old run (−15.40) is gone. Still a small sample, before costs.

**Same run with the target moved to the previous high / low (`target_mode: previous_extreme`, the shipped setting now; C6 on, no costs):**

| | Target = 2 × E distance (8.1 above) | **Target = previous high (long) / low (short) of the 20 back candles** |
|---|---|---|
| Trades (wins / losses) | 44 (17 / 27) | **44 (14 / 30)** |
| Hit ratio | 38.6 % | **31.8 %** |
| Total P&L | +40.20 pts | **+80.95 pts** |
| Average win · average loss | +6.65 · −2.70 | **+11.27 · −2.56** |
| Best · worst | +9.80 · −4.35 | **+16.40 · −4.35** |
| Profit factor | 1.55 | **2.05** |
| Max drawdown · longest losing streak | 14.75 · 6 | **14.75 · 6** |
| LONG (A) · SHORT (B) | 13 trades +15.15 · 31 trades +25.05 | **13 trades 38.5 %, +29.45, PF 2.32 · 31 trades 29.0 %, +51.50, PF 1.95** |

The same 44 signals are traded and the stops are unchanged; only the profit-taking moved further away, so fewer trades win but each win is larger. Before costs, a small sample, and the target was chosen after looking at this data — check it on new sessions.

### 8.1b Run without C6 (config as before, OI layer off, no costs)


**Data:** 29 NIFTY sessions, 09-09-2026 to 23-10-2026, all five LTF/HTF pairs at the time (the page and back-test now offer only 12s/1m and 36s/3m). 145 session/LTF combinations were tested and 115 produced no full signal.

| | All | LONG (A) | SHORT (B) |
|---|---|---|---|
| Trades (wins / losses) | 55 (22 / 33) | 17 (7 / 10) | 38 (15 / 23) |
| **Hit ratio** | **40.0 %** | 41.2 % | 39.5 % |
| **Total P&L** | **+52.30 pts** | +20.45 | +31.85 |
| Average per trade · average R | +0.95 · +0.20 | +1.20 · +0.24 | +0.84 · +0.18 |
| Average win · average loss | +7.98 · −3.73 | +9.10 · −4.33 | +7.45 · −3.48 |
| Profit factor | 1.42 | 1.47 | 1.40 |
| Max drawdown · longest losing streak | 23.10 pts · 6 | 15.40 · 4 | 27.30 · 7 |

By LTF: **12s** 50 trades, 40.0 %, +59.50 · **36s** 4 trades, 50.0 %, −1.70 · **60s** 1 trade, −5.50. Exits: 22 target, 33 stop, none by the hard exit.
7 signals were not traded because a trade was already open; 3 trades entered later than the next candle (the zone had not closed).

**Sensitivity to costs** (same 55 trades): +52.3 pts at 0 per trade · +24.8 at 0.5 · −2.7 at 1.0 · −30.2 at 1.5 · −57.7 at 2.0 — the edge is gone at about 1 point round trip.
Test it yourself: `node scripts/run-backtest.js --set strategy.round_trip_cost_points=1`.

**It is uneven over time:** the first half of the sessions (11-09 to 30-09, 27 trades) lost **−10.6 pts** at a 30 % hit ratio; the second half (from 01-10, 28 trades) made **+62.9 pts** at 50 %.
Most of the profit comes from October. What separates winning from losing trades is analysed in [analysis.md](analysis.md) §3.

### 8.2 Earlier run — effect of the OI-change layer (HTF slope 0.50, C5 multiplier 2)

> Superseded: the OI layer is now off, and its input data has a problem that may explain these numbers — [analysis.md](analysis.md) §2. A re-run at slope 0.25 gave 55 trades / +52.30 (off) vs 27 trades / +11.10 (on).

| | Layer 4 **off** | Layer 4 **on** |
|---|---|---|
| HTF matches (all sessions, all timeframes, the other layers on) | 351 | 196 (155 removed) |
| Trades (wins / losses) | 33 (12 / 21) | 14 (4 / 10) |
| Hit ratio | 36.4 % | 28.6 % |
| Total P&L · profit factor | +27.35 pts · 1.33 | −11.00 pts · 0.78 |
| LONG · SHORT | 11 trades +17.35 · 22 trades +10.00 | 5 trades −19.00 · 9 trades +8.00 |
| September (not used to design the rules) | 21 trades, 23.8 %, −18.45 | 8 trades, 12.5 %, −13.65 |
| October | 12 trades, 58.3 %, +45.80 | 6 trades, 50.0 %, +2.65 |

On these sessions the OI-change layer removes **44 %** of the HTF matches and the back-test came out **worse** (small samples: 14 trades cannot show that the layer is harmful, only that it did
not help here). For a comparison on any config run `node scripts/run-backtest.js --set htf.oi_change_filter.enabled=false`.

### 8.3 Earlier results (before layer 4 existed; HTF `minimum_slope` 0.25, 21 sessions)

**Data:** 21 distinct NIFTY sessions, 11-09-2026 to 23-10-2026 (the `input/` folder no longer holds SENSEX files). Two dates appear in two input files
(`NIFTY_2026-09-11` / `NIFTY_2026-09-14` are byte-identical copies, and 21-10 has two different files); the later file replaces the earlier one, as in `build-data.js`.
All five LTF / HTF pairs are tested, points, 1 unit, no costs, session rules on (no entry from 15:10, hard exit 15:19). The numbers depend on the config files at the
time of the run — here HTF `minimum_slope` **0.25** and the Condition 5 multiplier either **1** (current `config/ltf.json`) or **2**.

| | C5 multiplier = **1** (current files) | C5 multiplier = **2** |
|---|---|---|
| Trades (wins / losses) | 59 (27 / 32) | 39 (15 / 24) |
| **Hit ratio** | **45.8 %** | **38.5 %** |
| **Total P&L** | **+99.60 pts** | **+35.05 pts** |
| Average per trade · average R | +1.69 · +0.37 R | +0.90 · +0.15 R |
| Average win · average loss | +8.60 · −4.14 | +8.53 · −3.87 |
| Profit factor | 1.75 | 1.38 |
| Max drawdown · longest losing streak | 28.80 pts · 6 | 20.50 pts · 6 |
| LONG (Pattern A) | 21 trades, 52.4 %, +42.15, PF 1.83 | 11 trades, 45.5 %, +17.35, PF 1.56 |
| SHORT (Pattern B) | 38 trades, 42.1 %, +57.45, PF 1.70 | 28 trades, 35.7 %, +17.70, PF 1.29 |
| By LTF | 12s: 53 trades, 47.2 %, +114.10 · 36s: 4 trades, −2.20 · 1m: 2 trades, −12.30 | 12s: 35 trades, 40.0 %, +51.55 · 36s: 3 trades, −11.00 · 1m: 1 trade, −5.50 |
| Sessions with trades · winning / losing days | 20 · 15 / 5 | 18 · 9 / 9 |
| Exits | 27 target, 32 stop, 0 hard exit | 15 target, 24 stop, 0 hard exit |
| Signals not traded | 4 (a trade was already open) | 3 (a trade was already open) |

**Where the result comes from (multiplier 1)** — the same 59 trades split by period:

| Period | Trades | Hit ratio | P&L | Profit factor |
|---|---|---|---|---|
| September 11–30 (12 sessions) — **not used to design the conditions** | 40 | 40.0 % | +21.60 pts | 1.26 |
| October 1–14 (3 sessions) | 6 | 50.0 % | +28.50 pts | 4.31 |
| October 15–23 (5 sessions) — the sessions the conditions were shaped on | 13 | 61.5 % | +49.50 pts | 2.24 |

**The session rules changed nothing on this data.** The latest entry is at 15:05 and every trade ended at its target or stop; none was still open at 15:19. They are covered by
tests (a synthetic day and the real 15:09 / 15:10 / 15:19 IST clock), not by these sessions.

**How to read this honestly**
- **The strong early figures did not hold up on the larger sample.** On the first eight sessions (mostly the October ones) the hit ratio was about 64 % and the profit factor about
  2; with the September sessions added it is 45.8 % and 1.75. The September sessions — the ones not used to design the rules — give 40 % and a profit factor of 1.26: **positive, but thin**.
- **Why 40 % can still be positive:** with a 2 : 1 reward-to-risk the break-even hit ratio is 33 %, so 40 % earns a small profit. A little worse in hit ratio (or any trading cost) removes it.
  Test it: `node scripts/run-backtest.js --set strategy.round_trip_cost_points=1`.
- **Still a small sample:** 59 trades, most from one timeframe (12s). The result also moves a lot with one setting — the C5 multiplier 1 → 2 cuts the profit from +99.60 to +35.05 points.
- **Idealised fills:** exact fills at stop / target, no spread, slippage or brokerage.
- **Tuned on part of the data:** the thresholds (the RSI levels, spread band, SMA-of-RSI extremes, distance multiplier) were chosen while looking at the October sessions, so the October
  numbers flatter the strategy; the September figures are the closest thing to an out-of-sample check.

---

## 9. What is deliberately **not** claimed

- No performance claim: the conditions are verified for **correctness** (tests and real-data cross-checks, including a tick-by-tick re-check of
  every simulated trade), **not** for profitability.
- No live trading, order handling, position sizing in money, margin, or risk management beyond the fixed stop, target, entry cutoff and hard exit.

---

## 10. Next steps (suggestions)

1. Keep adding sessions (days not used to tune the rules) and re-run `node scripts/run-backtest.js` — the September result above is the thing to improve or confirm.
2. Try the what-if switches (`--set …`) to see how stable the result is: target 1.5 / 2 / 3 × risk, stop 1 × vs 1.5 ×, with a realistic cost.
3. Decide whether other exits (opposite signal, trailing stop) or limits (time window, trades per day) are wanted.
4. Work through the prioritised list in [analysis.md](analysis.md) §6 — costs first, then a single, reasoned volatility rule tested on a holdout.
