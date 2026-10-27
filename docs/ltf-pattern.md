# LTF Pattern A / Pattern B — Explanation (C1, C2, C3, C4, C5)

The **LTF** chart (signal timeframe) takes a **Matched** HTF pattern and then looks for a more precise
entry candle through five stacked conditions: **C1 → C2 → C3 → C4 → C5**. Each condition only *filters* the one
before it, so a candle that passes C5 has passed all five.

> Visualization only — **not BUY / SELL signals.**
> HTF side: [htf-pattern.md](htf-pattern.md) · full spec: [ltf.md](design/ltf-conditions-plan.md) · code: [src/ltf-conditions.js](../src/ltf-conditions.js) · settings: [config/ltf.json](../config/ltf.json).

---

## 1. The big picture

```
 HTF Matched A / B ──► shaded band on LTF ──► C1: RSI 50 cross ──► C2: SMA 9 vs SMA 44 ──► C3: spread in a tight band ──► C4: SMA-RSI extreme before
 (see HTF doc)         (the "zone")            (finds candidates)    (trend agrees)            (averages still close together)    (momentum was stretched) ──► C5: room to the recent extreme
```

| Term | Meaning |
|---|---|
| **Zone / band** | the 5 LTF candles that make up the Matched HTF candle (5:1 ratio). It appears when the HTF candle closes. |
| **Search span** | the crossing candle's **position** counted from the **first candle of the zone** (position 1, zone included) must lie in `scan_min_candles` … `scan_max_candles` (shipped 1 … 20). `scan_max_candles` `0` = no limit. |
| **Zone candles** | the 5 candles of the zone itself. **Arrows can form on them as well as after them** (crosses *before* the zone are ignored). |

Needs **HTF Confirmation** on (it supplies the zones) and the **LTF Conditions** toggle on.

---

## 2. The five conditions side by side

| | **Pattern A** | **Pattern B** |
|---|---|---|
| **Starts from** | an HTF Pattern A zone | an HTF Pattern B zone |
| **C1 — RSI 50 cross** | previous RSI 14 **< 50** and current RSI 14 **> 50** (crosses **up**) | previous RSI 14 **> 50** and current RSI 14 **< 50** (crosses **down**) |
| **C2 — SMA trend** *(on top of C1)* | SMA 9 **>** SMA 44 on that candle | SMA 9 **<** SMA 44 on that candle |
| **C3 — spread band** *(on top of C1 + C2)* | spread % between **0 and +0.020** | spread % between **0 and −0.020** |
| **C4 — SMA-of-RSI extreme** *(on top of C1 + C2 + C3)* | **any one** of the previous 20 candles has SMA-of-RSI **> 67.50** | **any one** of the previous 20 candles has SMA-of-RSI **< 32.50** |
| **C5 — back vs e distance** *(on top of C1–C4)* | back candle distance **>** 2 × e candle distance (high side, section 7) | back candle distance **>** 2 × e candle distance (low side — the mirror, section 7) |
| **C6 — risk range** *(on top of C1–C5)* | **3.5 ≤** e candle distance **< 8** points | **3.5 ≤** e candle distance **< 8** points (same range) |
| **Arrow when all conditions pass** | `C1+C2+C3+C4+C5+C6 A` — pink ⬆ **below** the candle (`C1+C2+C3+C4+C5 A` in muted purple = passed C5 but the risk was outside 3.5–8 points) | `C1+C2+C3+C4+C5+C6 B` — pink ⬇ **above** the candle |

**Spread %** = (SMA 9 − SMA 44) ÷ SMA 44 × 100 (calculated; the histogram that used to show it under the LTF chart was removed).
**SMA-of-RSI** = SMA 14 of RSI 14 (calculated; the RSI panel is no longer drawn on the page).
**E candle** = the candle carrying the C1–C4 arrow; the distances are defined per pattern in section 7 (details in [ltf-condition5.md](ltf-condition5.md)).

---

## 3. Condition 1 — RSI 50 cross (continuation)

Finds the candles where momentum crosses the 50 line in the pattern's direction, after the zone.

| Rule | Detail |
|---|---|
| Direction | A needs a cross **up** through 50, B a cross **down** |
| Comparison | strict — RSI exactly 50 is neither side, so `49 → 50 → 51` is **not** a cross |
| Where | on any candle inside the search span — **the zone's own candles included** |
| How many | **every** cross in the span gets an arrow (RSI must go back through 50 before the next one counts) |
| Newer zone | a newer HTF zone ends the older zone's search and takes over |
| Missing RSI | no arrow (RSI 14 needs 15 candles; a missing value never crosses) |

Arrow if only C1 holds: `C1 A` (blue ⬆ below) / `C1 B` (orange ⬇ above).

Setting — `condition_1_rsi_cross`: `rsi_period` 14 · `level` 50 · `scan_min_candles` 1 · `scan_max_candles` 20.

---

## 4. Condition 2 — SMA trend filter (on C1)

Keeps a C1 cross only when the two moving averages agree with the direction.

| | Pattern A | Pattern B |
|---|---|---|
| Passes when | SMA 9 **>** SMA 44 | SMA 9 **<** SMA 44 |

- Strict — equal averages pass neither.
- SMA 44 needs 44 candles, so C2 cannot appear in the first 43 candles of the session.
- Never creates a mark of its own; it only filters C1.

Arrow when C1 and C2 hold: `C1+C2 A` (cyan ⬆ below) / `C1+C2 B` (magenta ⬇ above).

Setting — `condition_2_sma_trend`: `fast_period` 9 · `slow_period` 44.

---

## 5. Condition 3 — spread band (on C1 + C2)

Keeps a C1 + C2 mark only when SMA 9 is still **close to** SMA 44 — i.e. the move has just started
rather than being stretched.

| | Pattern A | Pattern B |
|---|---|---|
| Passes when | `0 < spread ≤ +0.020 %` | `−0.020 % ≤ spread < 0` |

- Lower edge **excluded** (C2 already needs the right sign); upper edge **included**, so exactly 0.020 passes.
- The limits are in **percent**, and Pattern B uses the mirror image of the same limits.
- Reuses C2's SMA periods; never creates a mark of its own.

Setting — `condition_3_spread_band`: `min_pct` 0 · `max_pct` 0.02.

---

## 6. Condition 4 — SMA-of-RSI extreme before the arrow (on C1 + C2 + C3)

Keeps a C1 + C2 + C3 mark only when momentum had recently been stretched in the pattern's direction.

| | Pattern A | Pattern B |
|---|---|---|
| Passes when **any one** of the previous 20 candles has SMA-of-RSI | **> 67.50** | **< 32.50** |

- **Which candles:** the 1st to the 20th candle **before the arrow candle**, counted back from it (`lookback_min_candles` 1 … `lookback_max_candles` 20; 1 is the candle just before the arrow). The arrow candle itself is **not** included. They can include zone candles.
- **Strict** comparison — exactly 67.50 / 32.50 does not count. One qualifying candle is enough.
- **Warm-up:** SMA-of-RSI first exists at the 28th candle. Candles without a value are skipped; if none of the 20 has one, C4 fails.
- No look-ahead (only earlier candles are read). Never creates a mark of its own; it only filters C3.

Arrow when C1 to C4 all hold: `C1+C2+C3+C4 A` (green ⬆ below) / `C1+C2+C3+C4 B` (red ⬇ above).

Setting — `condition_4_rsi_sma_extreme`: `rsi_period` 14 · `sma_period` 14 · `lookback_min_candles` 1 · `lookback_max_candles` 20 · `pattern_a_min` 67.5 · `pattern_a_max` 100 · `pattern_b_min` 0 · `pattern_b_max` 32.5.

---

## 7. Condition 5 — back candle distance vs e candle distance

Keeps an E candle only when there is still **more than twice as much room** to the recent extreme as the size of the E candle's own move.

| Quantity | Pattern A (high side) | Pattern B (low side — the mirror) |
|---|---|---|
| **e candle distance** | **E high − (E−1) low** | **(E−1) high − E low** |
| **back extreme** | **back high** = highest **high** among the previous 20 candles | **back low** = lowest **low** among the previous 20 candles |
| **back candle distance** | **back high − E high** | **E low − back low** |
| **Rule (strict)** | **back distance  >  2 × e distance** | **back distance  >  2 × e distance** |

- The previous 20 candles are the ones before the E candle (the E candle excluded, the candle just before it included).
- An e candle distance of zero or less (a gap), or a back candle distance of zero or less (nothing beyond the E candle in the recent past), fails.
- Both patterns share the same two numbers, both configurable: how many candles back, and the multiplier (2).

Arrow when C1 to C5 all hold: `C1+C2+C3+C4+C5 A` (pink ⬆ below) / `C1+C2+C3+C4+C5 B` (pink ⬇ above). A candle that fails C5 keeps its `C1+C2+C3+C4` arrow.

Setting — `condition_5_distance_ratio`: `back_candles` 20 · `distance_multiplier` 2.

---

## 8. What the arrows mean (one arrow per candle)

A candle that crosses RSI 50 gets **exactly one** arrow — the highest level it reached:

| Arrow label | Reached | Colour (A below / B above) |
|---|---|---|
| `C1 A` / `C1 B` | C1 only | blue ⬆ / orange ⬇ |
| `C1+C2 A` / `C1+C2 B` | C1 and C2 | cyan ⬆ / magenta ⬇ |
| `C1+C2+C3 A` / `C1+C2+C3 B` | C1, C2 and C3 | gold ⬆ / violet ⬇ |
| `C1+C2+C3+C4 A` / `C1+C2+C3+C4 B` | C1 to C4 | green ⬆ / red ⬇ |
| `C1+C2+C3+C4+C5 A` / `C1+C2+C3+C4+C5 B` | all five | pink ⬆ / pink ⬇ |

Hover a zone on the LTF chart: the readout row shows a `C1`, `C2`, `C3`, `C4` and `C5` chip with the crossing times,
RSI / SMA / spread values, or `none`.

Other LTF extra: the
**LTF Conditions** toolbar toggle that clears all the arrows (the zones stay).

---

## 9. Worked example — NIFTY, 22-10-2026, 12s LTF (1m HTF)

> *This example was worked out with the earlier shipped settings (C1 scan positions 1 … 20, C3 max 0.020, C4 look-back 1 … 20, no minimum risk). With the current minimum risk of 3.5 points, candles with a smaller E distance no longer become signals; the logic is unchanged.*

HTF candles closing 12:57:00 and 12:58:00 are **Matched A** (slope +2.10 / +1.77, RSI-SMA 62.5 / 63.4). The
search for the 12:58:00 zone starts at 12:57:00 (the zone is 12:57:00–12:58:00) and runs 20 candles, so arrows can
appear on the zone's own candles and after it. Four RSI up-crosses fall in the span:

| Candle | C1: RSI 14 | C2: SMA 9 vs SMA 44 | C3: spread % | C4: SMA-of-RSI, previous 20 | C5: back vs e distance | Arrow |
|---|---|---|---|---|---|---|
| 12:57:36 *(inside the zone)* | 49.95 → 50.92 ✓ | 22718.22 > 22695.25 ✓ | +0.1012 — above 0.020 ✗ | — | — | `C1+C2 A` |
| **12:58:48** | 47.54 → 52.02 ✓ | 22705.51 > 22702.01 ✓ | **+0.0154** — inside 0 … 0.020 ✓ | highest was **79.19** at 12:54:48; latest candle above 67.50 was 12:57:00 (67.94) ✓ | e = 22711.75 − 22696.35 = **15.40**; back high 22755.95 (12:55:48), back = 44.20 **>** 2 × 15.40 = 30.80 ✓ | **`C1+C2+C3+C4+C5 A`** |
| 12:59:48 | 49.75 → 50.76 ✓ | SMA 9 below SMA 44 ✗ (spread −0.0066) | — | — | — | `C1 A` |
| 13:00:36 | 49.06 → 51.68 ✓ | SMA 9 below SMA 44 ✗ (spread −0.0123) | — | — | — | `C1 A` |

A contrasting E candle that **fails** C5: NIFTY 23-10, 12:16:48 — e distance 12.55 (needs back > 25.10) but the recent top is only 7.05 above the E high, so it stays `C1+C2+C3+C4 A`.

Pattern B example (mirror): NIFTY 22-10, 12:15:12 — E low 22608.25, (E−1) high 22614.55 → e = **6.30**; lowest low of the previous 20 candles 22589.95 (12:12:00) → back = 22608.25 − 22589.95 = **18.30 > 2 × 6.30 = 12.60** ✓ → `C1+C2+C3+C4+C5 B`.

Zone candles count: the zone 12:57:00–12:58:00 contains its own RSI up-cross at **12:57:36** (49.95 → 50.92). It passes C2 (SMA 9 22718.22 > SMA 44 22695.25) but fails C3 (spread **+0.1012** is above 0.020), so it carries `C1+C2 A`.

---

## 10. Settings summary — `config/ltf.json`

| Block | Key | Value | Purpose |
|---|---|---|---|
| `condition_1_rsi_cross` | `enabled` | true | turn C1 off to remove all LTF arrows |
| | `rsi_period` | 14 | RSI length |
| | `level` | 50 | the line being crossed |
| | `scan_min_candles` | 1 | first position scanned, counted from the zone's first candle (1 = that candle) |
| | `scan_max_candles` | 20 | last position scanned (`0` = unlimited); the older single `scan_candles` is still read as this maximum |
| `condition_2_sma_trend` | `enabled` | true | `false` leaves every arrow as plain C1 |
| | `fast_period` / `slow_period` | 9 / 44 | the two averages compared (fast must be smaller) |
| `condition_3_spread_band` | `enabled` | true | `false` stops promotion above C1+C2 |
| | `min_pct` / `max_pct` | 0 / 0.02 | band limits in percent (B mirrors them) |
| `condition_4_rsi_sma_extreme` | `enabled` | true | `false` stops promotion above C1+C2+C3 |
| | `rsi_period` / `sma_period` | 14 / 14 | the SMA-of-RSI line being tested |
| | `lookback_min_candles` / `lookback_max_candles` | 1 / 20 | which candles before the arrow are checked: the nearest (1 = the one just before) and the farthest |
| | `pattern_a_min` / `pattern_a_max` | 67.5 / 100 | Pattern A needs a value with `min <` value `≤ max` (lower edge exclusive, upper inclusive) |
| | `pattern_b_min` / `pattern_b_max` | 0 / 32.5 | Pattern B needs a value with `min ≤` value `< max` (lower edge inclusive, upper exclusive) |
| | *older keys* | | `lookback_candles`, `pattern_a_above`, `pattern_b_below` are still read as the maximum / A minimum / B maximum |
| `condition_5_distance_ratio` | `enabled` | true | `false` stops promotion above C1 to C4 |
| | `back_candles` | 20 | how many candles before the E candle give the back high |
| | `distance_multiplier` | 2 | back distance must exceed this × the e candle distance (both patterns) |
| `condition_6_risk_range` | `enabled` | true | `false` stops promotion above C1 to C5 |
| | `min_risk_points` | 3.5 | the e candle distance must be **at least** this many points (inclusive) |
| | `max_risk_points` | 8 | and **below** this many points (exclusive) — the e candle distance is the stop distance, i.e. the trade's risk; the same range for long and short |

After editing: run `node scripts/build-config.js` and **reload the page**. An invalid block fails closed — the readout
shows the problem and no arrows are drawn for it.

> Note: the chart's drawn SMA lines are fixed at 9 and 44. If `fast_period` / `slow_period` are changed, the arrows
> test the new periods but the lines on the chart do not follow.

---

## 11. Tests

```bash
node tests/ltf-condition1.test.js   # C1
node tests/ltf-condition2.test.js   # C2
node tests/ltf-condition3.test.js   # C3
node tests/ltf-condition4.test.js   # C4
node tests/ltf-condition5.test.js   # C5 (Patterns A and B)
node tests/ltf-spread.test.js       # the spread calculation (C3)
```
