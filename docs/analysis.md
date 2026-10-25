# Analysis — what the back-test shows, and what to do next

> **Status:** findings from a review on 25-10-2026 of the 29 recorded NIFTY sessions (09-09 to 23-10), config as shipped
> (HTF slope 0.25, C5 multiplier 2, OI layer off), points for 1 unit, no costs.
> **Small sample (55 trades). Everything here is a lead to test, not a proven rule.** Strategy rules: [strategy.md](strategy.md).

Contents: [1. Summary](#1-summary) · [2. The OI-change filter](#2-the-oi-change-filter) · [3. What made trades profitable](#3-what-made-trades-profitable) (3b: current rules) ·
[4. Costs](#4-costs) · [5. Improving without overfitting](#5-improving-without-overfitting) · [6. Ideas, in order](#6-ideas-in-order) · [7. Reproducing the numbers](#7-reproducing-the-numbers)

---

## 1. Summary

| Question | Answer |
|---|---|
| Is the strategy profitable on the recorded data? | Before costs, slightly: 55 trades, 40 % hit ratio, **+52.30 pts**, profit factor 1.42. |
| Does it survive costs? | **No, not much room:** about break-even at 1 point round trip ([§4](#4-costs)). |
| Is the OI-change filter useful? | **Not as built.** It lowers the result, and its input data does not mean what the code assumes ([§2](#2-the-oi-change-filter)). It is **off**. |
| What do the winners have in common? | A **volatile market** (large recent range, larger signal candle) and, to a lesser degree, trading **with the day's direction** ([§3](#3-what-made-trades-profitable)). |
| Is the result stable over time? | **No.** Sep 11–30: −10.6 pts (30 % hit). Oct 1–23: +62.9 pts (50 % hit). |

---

## 2. The OI-change filter

### 2.1 What it is

Layer 4 of the HTF pattern (`config/htf.json` → `oi_change_filter`). For the HTF candle being evaluated it compares the **change in open interest** on call options (CE)
and put options (PE):

| | Pattern A (long) | Pattern B (short) |
|---|---|---|
| Passes when | PE change − CE change **>** `minimum_difference` | CE change − PE change **>** `minimum_difference` |

- The numbers are **signed** (PE −100 beats CE −500) and the comparison is **strict**.
- A candle's value is the **sum of the minute rows inside it** (`src/oi-flow.js` → `changePerCandle`).
- Missing data fails closed (Not Matched). Currently `enabled: false`.

### 2.2 What the back-test says

| | Filter off | Filter on | Filter on, CE/PE swapped *(experiment)* |
|---|---|---|---|
| Trades | 55 | 27 | 29 |
| Hit ratio | 40.0 % | 37.0 % | 41.4 % |
| Total P&L | +52.30 | +11.10 | +37.60 |
| Profit factor | 1.42 | 1.16 | – |
| LONG | 17 trades, 41.2 %, +20.45 | 11 trades, 27.3 %, −15.90 | 7 trades, 57.1 %, +32.75 |
| SHORT | 38 trades, 39.5 %, +31.85 | 16 trades, 43.8 %, +27.00 | 22 trades, 36.4 % |

The 28 trades the filter removes had a **42.9 % hit ratio and +41.20 pts** — better than the 27 it keeps (37.0 %, +11.10). Removed longs: 6 trades, 66.7 %, +36.35.

### 2.3 Why: the input columns are not per-minute changes

The code assumes each flow row's `ce_oi_change` / `pe_oi_change` is the change **during that minute**. In the files it is not:

- The values grow all day. On 21-10 CE change goes 0.42 M (09:16) → 9.6 M (09:20) → 27 M (09:45) → 97 M (14:15).
- `cumulative_ce` is the running **sum of `ce_oi_change`** (424,710 + 3,304,535 = 3,729,245 at 09:17) — a cumulative of something already cumulative.
- In all 30 flow files checked, the sign of (PE − CE) equals the previous minute's **96–100 %** of the time, and `cumulative = previous cumulative + change` holds 99–100 % of the time.

So `ce_oi_change` behaves like the **total OI change since the open**, and the filter compares two running totals. Their difference rarely changes sign, so the filter mostly picks **one side per day**
(on 21-10 the long side passed on every one of the first ~45 candles I printed after 09:15). That is a regime flag, not a signal for the candle being evaluated, which explains the odd results above.

The code itself matches its spec and tests (`tests/oi-filter.test.js`); the issue is what the data columns mean. The same extraction feeds the CE / PE OI lines on the HTF chart.

### 2.4 Decision and follow-up

- **Decision:** keep `oi_change_filter.enabled` **false**.
- **To confirm with the data source:** exactly how `ce_oi_change` is defined (which strikes, since when).
- **If confirmed as running totals:** change `extractFlow` in `src/oi-flow.js` to use the **difference between consecutive `ce_oi_change` values** as the per-minute change, update `oi-flow.test.js` / `oi-filter.test.js`, then re-run the comparison.
- Also consider a **per-pattern direction** setting, since the swapped experiment suggests longs may respond the opposite way. With 6–17 trades per side this is **not** enough evidence to flip the rule.

Other data notes: `NIFTY_2026-09-11_DASHBOARD.json` and `NIFTY_2026-09-14_DASHBOARD.json` are identical copies; `NIFTY_2026-10-21_DASHBOARD.json` and `NIFTY_20261021_DASHBOARD.json` are both 21-10 (the latter wins).

---

## 3. What made trades profitable

All 55 trades (filter off). Features were measured at the signal time from the signal's own marks and the tick data.

### 3.1 Winners vs losers (medians; 22 winners, 33 losers)

| Feature | Winners | Losers |
|---|---|---|
| Stop distance = E candle distance (pts) | 4.13 | 2.75 |
| Price move since the open, in the trade's direction (pts) | +61.8 | −21.4 |
| Range of the last 60 minutes (pts) | 73 | 55 |
| Range of the last 10 minutes (pts) | 33.8 | 29.3 |

Features that did **not** separate them: LTF RSI value, SMA spread, back-distance ratio, entry delay.

### 3.2 Win rate by condition

| Condition | Trades | Hit ratio | P&L (pts) | 1st half P&L | 2nd half P&L |
|---|---|---|---|---|---|
| Volatile hour (60-min range ≥ 55) | 32 | 50 % | +64.2 | +5.5 | +58.7 |
| Quiet hour (< 55) | 23 | 26 % | −11.9 | −16.1 | +4.2 |
| With the day's direction | 30 | 47 % | +44.0 | +8.7 | +35.3 |
| Against the day's direction | 25 | 32 % | +8.3 | −19.3 | +27.6 |
| Stop ≥ 4 pts | 21 | 57 % | +62.0 | −2.8 | +64.8 |
| Stop < 4 pts | 34 | 29 % | −9.7 | −7.8 | −1.9 |
| By entry hour: 12:00–13:00 | 9 | 22 % | −15.2 | | |
| By entry hour: 13:00–14:00 | 19 | 42 % | +28.4 | | |
| All trades | 55 | 40 % | +52.30 | −10.6 | +62.9 |

*1st half = sessions 11-09 to 30-09, 2nd half = 01-10 to 23-10.*

### 3.3 The 4–6 point stop bucket

14 trades had a stop (= E candle distance) of 4–6 points: **9 wins (64 %)**, average win +9.40, average loss −4.58, total +61.7 pts — more than the whole strategy made, so the other 41 trades lost about 9.4 pts together.
Stops under 4 pts win only ~30 %: they are inside the normal wiggle of the index. Above 6 pts (7 trades) the result was break-even.

### 3.4 How the losers lose

Of the 33 stopped trades only **5 reached +1R first** (2 reached +1.5R); on average they went **0.57R** in favour before the stop. Most losers move against the trade almost immediately,
which points at entry quality, not at the exit — a breakeven or trailing stop would not rescue many of them.

### 3.5 Reading this honestly

- The thresholds (55 pts, 4 pts) were chosen **after looking at these same trades**. Out-of-sample results will be weaker.
- Of the rules above only **volatility** held up in both halves of the data; the day-direction rule did not (against-trend trades lost in the first half and won in the second).
- The strong months are October; September alone is break-even to negative.
- A bigger stop is largely a symptom of a more volatile market, so the "stop ≥ 4" and "volatile hour" findings are probably one effect.

### 3b. Winners vs losers on the current rules (risk below 5, previous-extreme target — 44 trades, 14 winners)

*Done on 25-10-2026, before the risk range was changed to 2–6. These are the trades the winners/losers comparison below is about; the 2–6 run is in [strategy.md](strategy.md) §8.1.*

| Feature (median) | Winners | Losers |
|---|---|---|
| Risk (E candle distance), pts | **3.85** | **2.55** |
| Price move since the open, in the trade's direction | +68 | −36 |
| Range of the last 60 minutes, pts | 69 | 54 |
| RSI momentum on the signal candle | 4.1 | 2.9 |
| Biggest move against the trade (MAE), pts | −0.9 | −2.7 |
| Biggest move in favour (MFE), pts | 12.2 | 1.4 |

| Condition | Trades | Win rate | P&L (pts) | 1st half | 2nd half |
|---|---|---|---|---|---|
| **Risk ≥ 3** | 20 | **60 %** | **+111.2** | +44.8 | +66.3 |
| **Risk < 3** | 24 | **8 %** | **−30.3** | −20.6 | −9.7 |
| Moved with the day since the open | 23 | 43 % | +70.9 | +34.2 | +36.6 |
| Against the day | 21 | 19 % | +10.0 | −10.0 | +20.0 |
| Range of the last 60 min ≥ 60 | 19 | 47 % | +79.0 | +39.3 | +39.7 |
| Risk ≥ 3 and with the day | 14 | 64 % | +79.6 | +35.5 | +44.1 |

- **Main finding:** signals with a tiny E candle distance (under 3 points) almost never win (2 of 24, in both halves). The stop is smaller than normal noise on a 12-second chart, and a small distance also puts the previous-high target far away (losers' targets averaged 4.1R, winners' 3.0R).
- **Winners move straight:** median MAE −0.9 points, finishing in 39–300 seconds. Losers are stopped in a median 36 seconds; only 7 of 30 reached +1R first.
- **Weaker patterns:** moving with the day's direction (holds in the first half only) and a busy last hour (probably the same effect as a larger signal candle). HTF slope, HTF RSI average, SMA spread and time of day did not separate winners from losers.
- **Caution:** 44 trades, the 3-point line was chosen after seeing them. It held in both halves and has a plausible reason, so it is worth testing on new days — but it is not proven. The risk range in `config/ltf.json` (C6) is the lever.

---

## 4. Costs

The P&L above is **before costs**. The same 55 trades with a fixed round-trip cost:

| Cost per trade (pts) | 0 | 0.5 | 1.0 | 1.5 | 2.0 |
|---|---|---|---|---|---|
| Total P&L (pts) | +52.3 | +24.8 | −2.7 | −30.2 | −57.7 |

Average stop is ~3.7 pts, so any realistic cost is a large share of the risk. Test with `--set strategy.round_trip_cost_points=<n>` or in `config/strategies.json` (`SB_Bhanusali.trade`).
**This is the first thing to settle:** if there is no edge after realistic costs, nothing else matters.

---

## 5. Improving without overfitting

Taking fewer trades at a higher hit ratio is reasonable, but with ~55 trades a filter giving 60 % can be found on almost any data. The method matters more than the filter.

1. **Start from a reason, not a number.** "A 2 : 1 target needs the market to be moving" is a reason; "range ≥ 55" is a threshold taken from the data.
2. **One or two rules, round thresholds.** Every extra rule or tuned value multiplies the chance of fitting noise.
3. **Keep a holdout you do not look at.** Tune on the older sessions; run the final rule **once** on the newest 6–8 (or on newly recorded days).
4. **Check neighbours.** A real rule works at 50, 55 and 60; if only 55 works it is luck.
5. **Check both halves of the data** (early and late sessions).
6. **Count trades.** Under ~30 kept trades a hit ratio is unreliable (14 trades at 64 % has a 95 % interval of roughly 35–87 %).
7. **Judge P&L net of costs, not only hit ratio.**
8. **More sessions** is the cheapest fix; ~30 more days would make every check above meaningful.

Expect the live result to be below the back-test. A filtered strategy that holds ~55 % on a holdout would already be a good outcome.

---

## 6. Ideas, in order

1. **Settle costs** (§4).
2. **Fix the OI data, then re-test the layer** (§2.4) — or leave it off.
3. **One volatility rule** with a stated reason, e.g. skip signals when the last-60-minute range is below a round level, or a minimum stop distance (~4 pts). Test on a holdout.
4. **Time-of-day** window (the 12:00–13:00 entries lost) — small sample, treat with care.
5. **Entry quality** — most losers go wrong at once; try an extra confirmation on the entry candle or a small-pullback entry.
6. **Target / stop shape** — target 1.5× / 2× / 2.5×, cap on risk per trade (the −15.40 trade on 22-10 equals about two average wins), daily loss limit.
7. **Timeframes** — 12s is 50 of 55 trades; 36s and 60s have 5 trades combined: drop them or collect more data.

---

## 7. Reproducing the numbers

```bash
node scripts/run-backtest.js                                   # the headline run
node scripts/run-backtest.js --trades                          # every trade
node scripts/run-backtest.js --json > trades.json              # machine-readable, for your own slicing
node scripts/run-backtest.js --set htf.oi_change_filter.enabled=true       # OI layer on
node scripts/run-backtest.js --set strategy.round_trip_cost_points=1       # with a cost
```

The §2.2 "CE/PE swapped" run and the §3 feature tables came from temporary analysis scripts that are **not** part of the repository; re-creating them needs the per-trade signal marks
(`rsi`, `spreadPct`, `eDistance`, `backDistance`) and the tick data, joined on `signalTime`. Win rates by hour, by stop size and the cost table can all be rebuilt from `--json` output.
