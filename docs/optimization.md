# Optimizing the LTF conditions (C1–C6) without overfitting

> **Status:** study of 25-10-2026 on the 29 recorded NIFTY sessions (LTF 12s / 36s / 60s at the time; the project now runs only 12s and 36s), strategy SB_Bhanusali, stop 1× the E distance, target = previous high / low, no costs.
> Start config for §2–§6: `config/ltf.json` with **C6 risk range 2–6** (`--base` file); the study itself writes nothing to the config. §7 led to one config change (C6 minimum risk 3).
> Tool: [research/optimize/optimize.js](../research/optimize/optimize.js). Related: [analysis.md](analysis.md) (what separates winners from losers), [strategy.md](strategy.md).

## 1. The idea, and the trap

The idea (yours): look at what a condition **removes**. Setting C6 to `0–3` kept only the small-risk trades — 24 trades with 2 wins — so the trades it *removes* (risk ≥ 3) are the ones worth keeping: the rule should be "risk ≥ 3". Doing the same for every parameter of C1–C6 is a good way to find which settings matter.

The trap: with 40–60 trades, trying many settings and keeping the best always finds something that looks great and then fails on new days. So the study **does not trust any number computed on all the trades**. Everything is shown for the older half (14 sessions, 09-09 … 29-09) and the newer half (15 sessions, 01-10 … 23-10), and the search is tuned on one half and **judged on the other, both ways round**.

## 2. One parameter at a time (everything else unchanged)

Full tables for every parameter: `node research/optimize/optimize.js sweep`. Settings that **beat the start config in both halves** (P&L and win rate; more trades = looser rule):

| Condition | Setting (start → better) | Trades | Win | P&L | Older half | Newer half | Remarks |
|---|---|---|---|---|---|---|---|
| **C6** | `min_risk_points` 2 → **3** | 40 → 24 | 40 → **58 %** | 106 → 124 | 11 tr · 45 % · +30.9 | 13 tr · 69 % · +93.6 | profit factor 2.41 → **4.09**; has a reason (tiny stops sit inside the noise) |
| **C1** | `level` 50 → **55** | 40 → 38 | 40 → 47 % | 106 → **160** | 22 tr · 45 % · +68.8 | 16 tr · 50 % · +91.3 | best total P&L of the single changes |
| C1 | `rsi_period` 14 → 21 | 40 → 47 | 45 % | 176 | +47.8 | +128.7 | more trades; overlaps with `level` |
| C4 | `pattern_a_above` 67.5 → 60, `pattern_b_below` 32.5 → 40 | 40 → 59 / 52 | 39 % / 38 % | 138 / 124 | both up | both up | looser rule: more trades, lower profit factor |
| C5 | `distance_multiplier` 2 → 1.5 (or 1) | 40 → 58 (61) | 47 % (46 %) | 157 (154) | +60.5 (+57.1) | +97.0 (+96.8) | looser rule: more trades |

No clear gain (the start value was already about as good): C1 `scan_candles`, C2 `fast_period` / `slow_period`, C3 `min_pct`, C4 `lookback_candles` / `sma_period`, C5 `back_candles`, C6 `max_risk_points` (8 helps only the newer half). C3 `max_pct` 0.01 raises the profit factor (2.4 → 3.9) but halves the trades and loses P&L in the newer half.

Two kinds of "better": **tighter** settings (C6 min 3) raise the win rate and profit factor with fewer trades; **looser** settings (C4, C5, C1 period) give more trades and more total points at a lower profit factor. Which you want depends on whether you prefer fewer, cleaner trades or more activity.

## 3. Searching several parameters together — it overfits

A greedy search (each step applies the one change that most improves the lower bound of the average R on the *training* half; at most K changes), judged on the other half:

| Tuned on → judged on | K changes | What it changed | Judged half: trades · win · P&L | vs start config |
|---|---|---|---|---|
| older → newer | 1 | C1 level 50 → 55 | 16 · 50 % · +91.3 | **+12.7** |
| older → newer | 2+ | + C5 multiplier 2 → 3 | 14 · 43 % · +68.8 | **−9.8** |
| newer → older | 1 | C6 min risk 2 → 3 | 11 · 45 % · +30.9 | **+3.3** |
| newer → older | 2 | + C6 max risk 6 → 8 | 11 · 45 % · +30.9 | +3.3 |
| newer → older | 3+ | + C3 min_pct 0 → 0.005 | 8 · 50 % · +25.3 | **−2.3** |

(The first, uncapped coordinate-descent run changed 7 parameters at once. On its training half it showed a profit factor of 10.8; on the other half it fell below the untouched config — one direction −28 pts, the other −30 pts.)

**What this means:** the **first** change generalized in both directions; every extra change made the held-out result *worse*. More tuning = less reliable. A handful of trades per half cannot support seven tuned numbers.

## 4. Combining the two best single changes

Start config = C6 risk 2–6. "Older" / "newer" = the two session halves.

| Config | Trades | Win | P&L | Older half | Newer half |
|---|---|---|---|---|---|
| Start (risk 2–6) | 40 | 40 % | +106.2 | 21 · 33 % · +27.6 | 19 · 47 % · +78.6 |
| A: risk 3–6 (C6 min 3) | 24 | 58 % | +124.5 | 11 · 45 % · +30.9 | 13 · 69 % · +93.6 |
| B: C1 level 55 | 38 | 47 % | +160.0 | 22 · 45 % · +68.8 | 16 · 50 % · +91.3 |
| A + B | 26 | 50 % | +126.8 | 13 · 46 % · +40.6 | 13 · 54 % · +86.2 |
| A + B + C5 multiplier 1.5 | 30 | 47 % | +121.0 | 15 · 47 % · +43.2 | 15 · 47 % · +77.9 |

The improvements are **not additive**: A + B is worse than B alone, and each extra change moves toward the start config's numbers. Stay with **one** change.

## 5. Conclusion

- **There is no reliable "best set" of all six conditions** to find in this data; searching for one produces numbers that fail on the other half.
- The two changes that held up in **both** halves are **C6 minimum risk 3** (has a reason; fewer, cleaner trades) and **C1 level 55** (more points). Pick **one**, not both, and not more.
- Whichever you choose, treat it as a hypothesis: it was found on these 29 sessions. Confirm on sessions it has not seen, and with a cost per trade.

## 6. Which LTF candle length is best? (`timeframes`)

The same strategy and the same settings (C6 risk 2–6, previous-high/low target), run on many LTF candle lengths with the HTF always 5 × the LTF. Tick data is one price per second, so a 6-second candle holds only about 6 ticks.

| LTF (HTF) | Trades | Win | P&L | PF | Older half: n · win · P&L | Newer half: n · win · P&L |
|---|---|---|---|---|---|---|
| 6s (30s) | 44 | 36 % | +57.8 | 1.71 | 22 · 27 % · **−1.4** | 22 · 45 % · +59.2 |
| 10s (50s) | 28 | 43 % | +49.3 | 1.85 | 9 · 44 % · +17.0 | 19 · 42 % · +32.4 |
| **12s (1m)** | **37** | **41 %** | **+103.7** | **2.60** | 19 · 37 % · +38.1 | 18 · 44 % · +65.6 |
| 15s (75s) | 16 | 38 % | +42.1 | 2.20 | 10 · 40 % · +18.9 | 6 · 33 % · +23.3 |
| 20s (100s) | 9 | 33 % | +15.3 | 1.69 | 4 · 50 % · +19.9 | 5 · 20 % · −4.6 |
| 24s – 60s | 1–6 each | — | — | — | too few trades to judge | too few trades to judge |
| 90s – 300s | 0 | — | — | — | no signals | no signals |

- **12s is the best candidate:** the most points, the best profit factor, enough trades (37), and positive in **both** halves.
- **10s is a reasonable second:** positive in both halves, but fewer trades (28) and a lower profit factor.
- **6s** has the most trades but lost slightly in the older half, so it is not consistent. **15s** is positive in both halves but with only 16 trades.
- **20s and slower** do not produce enough trades to judge; from 90s up there are none, because the HTF candle series is too short for the filters to warm up and the patterns are rare.
- **Caution:** the conditions count candles (scan 20, SMA 44, look-back 20 …), so each was shaped around 12s. On a slower or faster timeframe the same numbers cover a different amount of time; a fair test of another timeframe would re-tune them, with the same overfitting caution as above. And 12s was the timeframe the settings were developed on, which favours it.

## 7. Aiming for a high win rate (all conditions except C5)

**Goal set by you:** a high win rate, not the most points; C5 (distance ratio) stays exactly as it is; every other condition may be tightened. So the search now scores a setting by the **lower 95 % confidence bound of its win rate** (a high win rate on a handful of trades scores low) and needs at least 12 trades. C5 is frozen. Same two-half test as before, finer grid. (`node research/optimize/optimize.js search --objective winrate --freeze C5 --grid fine --min-trades 12`)

| Tuned on → judged on | Changes allowed (cumulative) | Win rate on the half it was **tuned** on | Win rate on the **other** half | Start config on the other half |
|---|---|---|---|---|
| older → newer | 1: C1 level 55 | 48 % | **50 %** (16 trades) | 47 % |
| older → newer | 2: + C1 RSI period 18 | 62 % | **38 %** (8 trades) | 47 % |
| older → newer | 3: + C6 min risk 2.5 | 70 % | **43 %** (7 trades) | 47 % |
| newer → older | 1: C6 min risk 3 | 69 % | **50 %** (10 trades) | 35 % |
| newer → older | 2: + C3 max spread 0.015 | 80 % | **44 %** (9 trades) | 35 % |
| newer → older | 5: + C6 max risk 8, C3 min spread 0.005 | **100 %** (8 trades) | **50 %** (6 trades) | 35 % |

**Reading it:** stacking filters can push the win rate on the data it was tuned on to 80 % or even 100 % (on 8 trades), but on the half it had never seen it stays around **40–50 %** — and with more than one change it is often *no better than the start*. A high win rate bought by filtering the same trades again and again does not carry over. The first change is the only one that reliably did: C6's minimum risk (older half: 35 % → 50 %) or C1's RSI level (newer half: 47 % → 50 %).

**What was applied:** only C6's minimum risk 2 → 3 (`config/ltf.json`). It had the clearest reason (tiny stops sit inside the noise), the best win rate of the single changes (41 % → 61 % on 12s + 36s in-sample; 50 % on the older half and 69 % on the newer half) and the cleanest improvement of the profit factor (2.6 → 4.7). C1–C4 were left as they are because every further filter lowered the held-out result. With all data in the search (no holdout) it would have gone further — e.g. risk ≥ 4, SMA 9, C4 short level 40 gives 15 trades at 80 % — but that number is the same kind of mirage and is **not** applied.

## 8. The condition-by-condition sweeps (logs)

Run on the 3–6 risk range, 12s + 36s, no costs; every row of every log is in `research/optimize/logs/` (sorted by hit ratio).

| Log | What was swept | Finding |
|---|---|---|
| `c1-scan-sweep.log` | C1 `scan_min_candles` 1–20 × `scan_max_candles` 2–40 (609 pairs, 89 distinct results) | A higher minimum raises the hit ratio and cuts trades: 2 → 65 % (23 trades), 7 → 71 % (17), 9 → 73 % (11). A minimum of 6+ skips the zone's own candles — only crossings after the zone has closed count. |
| `c3-spread-sweep.log` | C3 `max_pct` 0.001 … 0.029, `min_pct` 0 (29 values, 15 distinct) | Flat at 60–67 % from about 0.011 up; 0.016–0.019 gives 66.7 % on 21 trades vs 60.9 % on 23 at 0.020. C3 is already about right. |
| `c4-lookback-sweep.log` | C4 `lookback_min_candles` 1–25 × `lookback_max_candles` 10–30 (405 pairs, 36 distinct) | A minimum from 1 to 10 changes nothing; from about 13 up the hit ratio rises to 69–73 % on 15–16 trades (14–19: 73 % on 15). The qualifying SMA-of-RSI peak should be an *older* one. |

Common thread: signals that come right after the zone, or that rest on a fresh extreme, are weaker; later, more settled setups win more — at the price of far fewer trades. The three filters mostly remove the *same* trades: all three together leave 12 trades at 75 % (older half 3 trades 67 %, newer half 9 trades 78 %), little better than one alone.

## 9. Applied: C1 7–31, C3 0.017, C4 14–19 — and the neighbourhood test

*(Status: these three were applied for a while and then **replaced** — see §10: cross-validation showed such stacked changes do not hold up on unseen days. `config/ltf.json` now holds the untuned C1 / C3 / C4 ranges and C6 risk 3.5–6.)* These three were applied together to `config/ltf.json`. To tell a robust setting from a lucky peak, `node research/optimize/optimize.js neighbors` tries **every combination within ±2 steps** of the chosen values on all five settings (3,125 neighbours) and also moves each setting alone by up to ±3.

| | Chosen centre | Its 3,125 neighbours | Old centre's 1,125 neighbours (C1 1–20, C3 0.020, C4 1–20) |
|---|---|---|---|
| Trades | 12 | median 12 (10th–90th percentile 9–15) | median 22 |
| Win rate | **75 %** | median **71 %**, 10th pct 67 %, worst 60 %, best 80 % | median 63 %, worst 57 % |
| Older half / newer half win rate | 67 % (3 trades) / 78 % | medians 67 % / 78 % | 55 % / 69 % |
| Neighbours with win rate ≥ 60 % | — | **100 %** (≥ 65 %: 94 %) | 84 % |
| Neighbours with fewer than 10 trades | — | 21 % | 0 % |

Moving one setting at a time (trades · win rate), e.g. C1 minimum 4 / 7 / 10: 15·73 % / 12·75 % / 11·73 %; C4 minimum 11 / 14 / 17: 14·71 % / 12·75 % / 12·75 %; C3 max 0.014 / 0.017 / 0.020: 10·70 % / 12·75 % / 13·77 %.

**Reading it:** the result is a **plateau**, not a knife-edge — no neighbour falls below a 60 % win rate, and the centre (75 %) is only a few points above the neighbours' median (71 %). That is a good sign that the exact numbers don't matter much. It does **not** show the strategy will hold on new days: all the neighbours select roughly the same 9–15 trades, and those trades are the ones the filters were chosen on. What the check can't see is selection: from a 23-trade pool we kept the 12 that fit the pattern. Other facts: the 12 trades are spread over 9 days; leaving any one day out keeps the win rate between 70 % and 90 %; the biggest single trade is 17 % of the profit.

**Honest expectation for new days:** between the 50 % seen on unseen halves in the walk-forward test (§7) and the 75 % here. The only real test is new sessions.

## 10. No new data? Cross-validate the whole tuning procedure (`cv`)

Without new sessions the honest question is: **if I run my tuning on some days and trade the others, what do I get?** `node research/optimize/optimize.js cv` answers it. It splits the 29 sessions into blocks (6 folds, 10 folds, or one day at a time), tunes on all the other blocks (greedy, up to 5 changes, win-rate objective, C5 frozen, fine grid), trades the held-out block with the config after 0, 1, 2 … 5 changes, and pools all the held-out trades. Every number is from days the tuning never saw, **and the tuning procedure itself — including the choice of values — is inside the test**, which a single "tune on one half, test on the other" cannot show. Start config: the neutral one — C1 1–20, C3 0–0.02, C4 1–20, C6 risk 2–6.

Held-out result, all folds pooled (12s + 36s, no costs):

| Changes allowed | 6 folds: trades · win | 10 folds: trades · win | Leave-one-day-out (29 folds): trades · win · P&L |
|---|---|---|---|
| **0 (untuned)** | 39 · 41.0 % | 39 · 41.0 % | 39 · 41.0 % · +111.7 |
| **1** | **15 · 60.0 %** | **15 · 60.0 %** | **18 · 50.0 % · +75.5** |
| 2 | 13 · 53.8 % | 16 · 43.8 % | 15 · 33.3 % · +17.9 |
| 3 | 13 · 53.8 % | 18 · 38.9 % | 18 · 33.3 % · +23.0 |
| 4 | 8 · 37.5 % | 12 · 41.7 % | 12 · 25.0 % · −1.7 |
| 5 | 9 · 33.3 % | 14 · 42.9 % | 13 · 23.1 % · −9.4 |

- **One change helps on unseen days; every further change hurts.** With 4–5 changes the held-out win rate is *below the untuned config* (23–43 % against 41 %), and in the leave-one-day-out test the total P&L even turns negative.
- **The one change is stable:** in every one of the 6 / 10 / 29 folds the first change the search chose was **C6 `min_risk_points`** (values 3, 3.5 or 4 — in the 29-fold run: 4 in 22 folds, 3 in 5, 3.5 in 2). No other setting was ever chosen first except C1 `level` 57.5 (twice) when the search was asked to maximise average R instead.
- **What it buys:** the held-out win rate rises from 41 % to **50–60 %** (15–18 trades). Total points are *lower* (+75 … +86 against +112) because it trades fewer times — it is a quality-over-quantity change.
- **With "average R" as the objective** (not the win rate) tuning did **not** beat the untuned config on unseen days at all (42 % vs 41 %, lower P&L).
- **What it says about the config applied in §9** (C1 7–31, C3 0.017, C4 14–19 *plus* the risk range): that is three extra tuned changes. The held-out evidence above says extra changes of that kind **did not generalize** — expect it to do worse on new days than "untuned + a higher minimum risk".

**Best setting supported by the data:** keep C1, C3, C4 at their broad, untuned values (C1 1–20, C3 0–0.02, C4 look-back 1–20, C5 as it is) and raise **C6's minimum risk to about 3.5** (anywhere 3–4):

| C6 `min_risk_points` | Trades | Win | Older half | Newer half |
|---|---|---|---|---|
| 2 (untuned) | 39 | 41 % | 20 · 35 % | 19 · 47 % |
| 3 | 23 | 61 % | 10 · 50 % | 13 · 69 % |
| **3.5** | 17 | 65 % | 6 · 67 % | 11 · 64 % |
| 4 | 13 | 69 % | 3 · 67 % | 10 · 70 % |

Rising minimum = fewer trades and a higher hit ratio; 3.5 is the middle of the stable range and keeps 17 trades. The honest expectation on unseen days is the held-out row for one change: about **50–60 %**, not the 65–69 % of the table.

Logs: `research/optimize/logs/cv-6fold.log`, `cv-10fold.log`, `cv-leave-one-day-out.log` (per-fold detail: which change was chosen and the held-out trades), `cv-best-config.json` (the all-data fit with one change).

## 10b. Does a maximum risk of 8 beat 6? (`cv --only C6`)

The 23-10 candle at 13:36:12 (E distance 7.35, long, +19.15 when traded) was rejected by the maximum of 6. Raising it to 8 admits it, so the question was whether that helps on unseen days. The sweep (C6 minimum 3.5, everything else untuned):

| C6 `max_risk_points` | Older half: trades · win | Newer half: trades · win | Newer-half P&L |
|---|---|---|---|
| 5 | 5 · 80 % | 9 · 56 % | +50.7 |
| 6 | 6 · 67 % | 11 · 64 % | +74.4 |
| 7 | 6 · 67 % | 14 · 64 % | +100.4 |
| **7.5 – 8** | 6 · 67 % | **15 · 67 %** | **+119.5** |
| 9 | 6 · 67 % | 16 · 63 % | +111.2 |
| 10 and up | 7 · 57 % | 16–17 · 59–63 % | +95.8 … +111.2 |

Then the cross-validation with **only C6 tunable** (start: 3.5 / 6; held-out trades pooled over all folds):

| | 6 folds | 10 folds | One day at a time |
|---|---|---|---|
| Fixed 3.5 / 6 (no tuning) | 17 · 64.7 % · +112.4 | 17 · 64.7 % · +112.4 | 17 · 64.7 % · +112.4 |
| Tuned (1 change, held-out) | 16 · 56.3 % · +82.0 | 19 · 63.2 % · +120.0 | 17 · 58.8 % · +100.4 |
| First change chosen | max 8 (5 of 6 folds) | max 8 (9 of 10) | max 8 (27 of 29) |

**Reading it:** the search *consistently* picks a maximum of 8, so the choice is stable and 8 is a reasonable value — but on unseen days it did **not** improve on a fixed 6 (similar points, a slightly lower win rate). The 17 → 21 trades in-sample come from 4 extra trades in the newer half, 3 of them wins. Conclusion: 6 and 8 are equivalent within the noise; keeping 8 admits more setups, keeping 6 is a little more selective. (Note the "fixed 3.5 / 6" row is itself partly in-sample, because the 3.5 minimum was chosen on this data, which flatters it by a few points.)

Logs: `research/optimize/logs/cv-c6-*.log`.

## 11. Re-running it

```bash
node research/optimize/optimize.js sweep                          # one-parameter tables (add --ltf 12 for the 12s chart only)
node research/optimize/optimize.js search                         # greedy search with the train / test split, both directions
node research/optimize/optimize.js timeframes                     # the strategy on many LTF candle lengths (HTF = 5 x LTF)
node research/optimize/optimize.js search --objective winrate --freeze C5 --grid fine --min-trades 12 [--final 3]   # win-rate search, C5 frozen; --final K also tunes on all data (prints, writes nothing)
node research/optimize/optimize.js sweep --base my-ltf.json       # start from another LTF config instead of config/ltf.json
node research/optimize/optimize.js c1scan                         # Condition 1 only: every scan_min_candles 1..20 x scan_max_candles 2..40, sorted by hit ratio -> research/optimize/logs/c1-scan-sweep.log
node research/optimize/optimize.js cv --base neutral.json --objective winrate --freeze C5 --grid fine --folds 6   # no new data: tune on some sessions, trade the rest; picks the number of changes by held-out evidence -> research/optimize/logs/cv.log
node research/optimize/optimize.js neighbors --base my-ltf.json         # robustness: every setting within ±2 steps of the C1 / C3 / C4 values in that config -> research/optimize/logs/neighbors.log
node research/optimize/optimize.js c3scan                         # Condition 3 only: min_pct 0 x max_pct 0.001 .. 0.029 -> research/optimize/logs/c3-spread-sweep.log
node research/optimize/optimize.js c4scan                         # Condition 4 only: lookback_min_candles 1..25 x lookback_max_candles 10..30 -> research/optimize/logs/c4-lookback-sweep.log
```

Add new sessions to `input/` and re-run: the halves move with the data, so the verdicts above can change — that is the point of re-running.
The tool reuses the project's own candles, HTF rules, signal chain and trade simulation, so the start-config line matches `node scripts/run-backtest.js` exactly.
