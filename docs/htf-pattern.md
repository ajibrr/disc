# HTF Pattern A / Pattern B — Explanation

The **HTF** chart (confirmation timeframe) decides whether the latest completed HTF candle is a
**Pattern A**, a **Pattern B**, or neither. A Matched result is what lights up the LTF chart
(see [ltf-pattern.md](ltf-pattern.md)).

> This is **pattern matching and visualization only — not BUY / SELL signals.**
> Source of truth: [src/confirmation.js](../src/confirmation.js) · settings: [config/htf.json](../config/htf.json).

---

## 1. The big picture

```
 5 completed HTF candles ──► base candle rules (4 rules + 5A/5B) ──► slope filter ──► RSI-SMA filter ──► OI-change filter ──► MATCHED A / B
                                      │                                  │                 │
                                      └────────────── any failure ───────┴─────────────────┴──► NOT MATCHED
```

A pattern is **Matched** only if **every enabled** layer passes, each in its own direction (layer 4 is currently switched off):

| Layer | Pattern A needs | Pattern B needs |
|---|---|---|
| 1. Base candle rules | the 5-candle shape for A (section 3) | the 5-candle shape for B (section 3) |
| 2. SMA slope filter | slope **rising** enough | slope **falling** enough |
| 3. SMA-of-RSI filter | RSI-SMA **below** a ceiling | RSI-SMA **above** a floor |
| 4. Option-chain OI-change filter | **PE** OI change **greater than** **CE** OI change | **CE** OI change **greater than** **PE** OI change |

States: **Matched** · **Not Matched** · **Unavailable** (not enough history yet).

---

## 2. Candle numbering

The candle that has **just completed** is **−1**; going backwards in time:

| Label | Which candle |
|---|---|
| **−1** | the latest completed HTF candle (the one being evaluated) |
| **−2** | the candle before it (the one outlined in blue on the chart) |
| **−3, −4, −5** | the three before that |

Only **completed** candles are used. The final, partial candle of a session is never evaluated, and a
state never depends on anything after the candle's close (no look-ahead).

---

## 3. Layer 1 — base candle rules

All of rules **1–4** must hold, **plus** either **5A or 5B**. Every comparison is strict (`<` / `>`).

| # | Pattern A | Pattern B |
|---|---|---|
| 1 | High(−2) **>** High(−1) | High(−2) **<** High(−1) |
| 2 | Low(−2) **>** Low(−1) | Low(−2) **<** Low(−1) |
| 3 | candle −2 is **red** (close < open) | candle −2 is **green** (close > open) |
| 4 | candle −1 is **red** (close < open) | candle −1 is **green** (close > open) |
| 5A | High(−2) **>** High(−3), High(−4) **and** High(−5) | High(−2) **<** High(−3), High(−4) **and** High(−5) |
| 5B | High(−3) **>** High(−4) **and** High(−5) | High(−3) **<** High(−4) **and** High(−5) |

- **A in words:** two red candles in a row, the second one lower on both high and low, after a recent high.
- **B in words:** the mirror — two green candles in a row, the second one higher on both high and low, after a recent low.
- **5B does not look at candle −2**, so a pattern can match on 5B alone. It is implemented exactly as written.

---

## 4. Layer 2 — SMA slope filter

Checks that the HTF **SMA 9** is moving in the pattern's direction, measured in **ATR units** so the
number means the same thing at every price level and timeframe.

```
slope = ( SMA9[now] − SMA9[now − lookback] ) ÷ ATR14[now]
```

| | Pattern A | Pattern B |
|---|---|---|
| Passes when | slope **>** `minimum_slope` | slope **<** −`minimum_slope` |

Settings in `config/htf.json` → `sma_slope_filter` (current values):

| Setting | Value | Meaning |
|---|---|---|
| `enabled` | true | `false` skips this layer |
| `sma_period` | 9 | the moving average being measured |
| `atr_period` | 14 | ATR length (Wilder smoothing) |
| `lookback_candles` | 3 | compares the SMA now with 3 completed candles ago |
| `minimum_slope` | 0.25 | how steep the SMA must be (shipped value in `config/htf.json`; was 0.50 when the examples below were written) |

- **Strict:** a slope exactly at the threshold fails. A missing value never counts as rising or falling.
- **Warm-up:** needs 14 completed candles, so the first candle that can match is the **15th**.

---

## 5. Layer 3 — SMA-of-RSI filter

Checks that momentum is not already stretched in the pattern's direction. It uses the **SMA 14 of
Wilder RSI 14** — the orange line on the HTF RSI chart.

| | Pattern A | Pattern B |
|---|---|---|
| Passes when | RSI-SMA **<** `pattern_a_max` | RSI-SMA **>** `pattern_b_min` |
| Current limit | **65** | **35** |

Settings in `config/htf.json` → `sma_rsi_filter`: `enabled: true`, `period: 14`, `pattern_a_max: 65`, `pattern_b_min: 35`.

- **Strict**, and **warm-up** is 27 completed candles: before that the value is unavailable and the layer
  **fails closed** (Not Matched, never Matched).
- Layers 2 and 3 are independent: each can be turned off without affecting the other.

---

## 5b. Layer 4 — option-chain OI-change filter

Checks that the option market is moving the same way as the pattern, using the **CE / PE open-interest change** shown as the red and green lines on the HTF chart
(CE = call options, PE = put options; OI change = how much of that open interest was added or removed).

| | Pattern A | Pattern B |
|---|---|---|
| Passes when | **PE change − CE change  >  `minimum_difference`** (PE change is greater) | **CE change − PE change  >  `minimum_difference`** (CE change is greater) |

Settings in `config/htf.json` → `oi_change_filter`: `enabled: false` (currently **off** — see [analysis.md](analysis.md) §2 for why), `minimum_difference: 0` (in the file's own OI units; 0 means any margin passes).

- **Which numbers:** the CE and PE change of **candle −1** (the candle being evaluated). A 1-minute candle uses the file's change for that minute; a longer candle uses the **sum of the minutes inside it**.
- **Signed comparison:** the numbers are compared as they are, so PE −100 is greater than CE −500 (both fell, PE fell less). **Strict:** equal values fail.
- **Missing data fails closed:** a session with no option-chain flow, or a candle with no minute in it, is **Not Matched** (never Matched).
- Independent of the other layers: each has its own switch. `enabled: false` (or removing the section) restores the previous behaviour exactly.
- The readout shows an `oi` chip beside each pattern group: `oi PE 70.16M CE 231.45M ✗` (the two numbers and whether the layer passes).

---

## 6. States and what you see

| State | Meaning | On the chart |
|---|---|---|
| **Matched A / B** | all four layers passed | arrow marker on candle −1 (blue ⬆ "Pattern A" / orange ⬇ "Pattern B"), plus a shaded band on the LTF chart |
| **Not Matched** | evaluable, but a layer failed | nothing drawn — read the reason in the readout row |
| **Unavailable** | fewer than 5 candles of history | small grey `–` marker (first 4 candles of the session) |

- **Readout row** (under the HTF header) shows each rule as ✓ / ✗ for A and B, plus the `slope`, `rsi` and `oi` values with their ✓ / ✗.
- **Toolbar badge** shows the latest eligible candle, e.g. `HTF: Matched A · 12:58:00`.
- **Blue outline box** marks candle −2, the candle being judged.
- **Config error:** an enabled but invalid config section fails closed — the badge says `HTF: Config error` and nothing matches.

---

## 7. Worked examples (real data, 1m HTF, NIFTY)

> The examples were computed with `minimum_slope` **0.50** and no OI layer. With the current config (0.25) the second example's slope check would pass (−0.416 < −0.25) but its RSI-SMA check still fails, so it stays Not Matched.

**Matched — 22-10-2026, HTF candle closing 12:58:00 (Pattern A)**

| Layer | Result |
|---|---|
| Base rules | A shape holds (rules 1–4 and 5A/5B) ✓ |
| Slope | +1.767, needs > 0.50 ✓ |
| RSI-SMA | 63.43, needs < 65 ✓ |
| **State** | **Matched A** |

**Not Matched — 15-10-2026, HTF candle 14:43:00–14:44:00 (Pattern B)**

| Layer | Result |
|---|---|
| Base rules | B shape holds ✓ (with filters off this candle is Matched B) |
| Slope | −0.416, needs < −0.50 ✗ |
| RSI-SMA | 33.45, needs > 35 ✗ |
| **State** | **Not Matched** — both filters blocked it |

---

## 8. Where the numbers can be changed

| What | Where |
|---|---|
| Slope strictness, SMA / ATR lengths, lookback | `config/htf.json` → `sma_slope_filter` |
| RSI ceiling for A, floor for B, SMA length | `config/htf.json` → `sma_rsi_filter` |
| OI-change gate on / off, required margin | `config/htf.json` → `oi_change_filter` |
| The five-candle rules | fixed in `src/confirmation.js` (not configurable) |

After editing `config/htf.json`, run `node scripts/build-config.js` and **reload the page**.

---

## 9. Tests

```bash
node tests/confirmation.test.js     # base rules, timing, completeness
node tests/slope-filter.test.js     # slope filter
node tests/sma-rsi-filter.test.js   # SMA-of-RSI filter
node tests/oi-filter.test.js        # option-chain OI-change filter
```

More detail: [README.md](../README.md) §6 · [htf-confirmation-plan.md](design/htf-confirmation-plan.md) · [htf-filters-plan.md](design/htf-filters-plan.md).
