# LTF Conditions — Plan

> *File paths in this record (`charts/…`) refer to the project layout at the time; the code now lives in `src/`, `scripts/`, `tests/` and `web/` — see the [README](../../README.md).*

> **Per-condition specs** for the LTF chain (C1 → C5), with the decisions taken for each. For a plain-language overview read [../ltf-pattern.md](../ltf-pattern.md); for the strategy built on top, [../strategy.md](../strategy.md).

> **Status: Condition 1 IMPLEMENTED and verified** (`src/ltf-conditions.js`, `config/ltf.json`, `tests/ltf-condition1.test.js` 71/0; HTF regression gates 259/139/133 green; browser-checked). ❓ = open question.

This file holds every condition evaluated on the **LTF chart**. Each condition has its own
numbered section, its own config block and its own function, so a new one is added **below** the
last without touching the earlier ones.

| # | Name | Config key | Status |
|---|---|---|---|
| **1** | **RSI 50 Cross (Continuation)** | `condition_1_rsi_cross` | Implemented |
| **2** | **SMA Trend Filter on Condition 1** (SMA 9 vs SMA 44) | `condition_2_sma_trend` | Implemented |
| **3** | **SMA Spread Band on C1 + C2** (0 to ±0.020 %) | `condition_3_spread_band` | Implemented |
| **4** | **SMA-of-RSI extreme in the previous 20 candles** (A: any > 67.50, B: any < 32.50) | `condition_4_rsi_sma_extreme` | Implemented |
| **5** | **Back candle distance vs E candle distance** (back > 2 × e; Pattern B is the mirror) | `condition_5_distance_ratio` | Implemented for Patterns A and B — full spec in [../ltf-condition5.md](../ltf-condition5.md) |
| 6 | _(next condition goes here)_ | `condition_6_…` | — |

## Shared conventions (apply to every condition)

- **Starting point:** every condition hangs off a highlighted Pattern A / Pattern B band on the LTF chart (a Matched HTF window, revealed at its HTF close `C_k`).
- **Config:** one file, `config/ltf.json`, one top-level block per condition, each with its own `enabled` flag. Generated into the page like `htf.json` — **run the generator after every change.** Invalid config **fails closed** with a visible error; `enabled:false` leaves the chart unchanged (off / active / error, same as the HTF filters).
- **Code:** one pure rule module `src/ltf-conditions.js` (no DOM, UMD like `confirmation.js`, testable in Node), one `evaluateConditionN(...)` function per condition. RSI always comes from the existing `rsiArray` in `confirmation.js` (export it) — the same Wilder RSI 14 the LTF RSI panel plots; a test asserts they agree.
- **Wiring:** results are drawn from `applyConfirmation()` in `index.html` as LTF series markers (one merged `setMarkers` call), a segment in the LTF crosshair readout, and one shared `LTF Conditions` toggle that clears only these visuals.
- **No look-ahead:** nothing is shown before the pattern it belongs to is revealed.
- **Tests:** one file per condition in `tests/`, numbering continues after T40; the HTF suites (259 / 139 / 133) must stay green.

---

## Condition 1 — RSI 50 Cross (Continuation)

### 1.1 What it does

After a Pattern A / Pattern B band has appeared, mark the LTF candle where RSI 14 crosses the 50 line **in the pattern's direction**:

| Pattern | Previous candle's RSI 14 | Current candle's RSI 14 | Marker |
|---|---|---|---|
| **A** | **< 50** | **> 50** | ⬆ arrow **below** the candle, label `C1 A` |
| **B** | **> 50** | **< 50** | ⬇ arrow **above** the candle, label `C1 B` |

Arrows use the same marker mechanism the HTF chart already uses (`arrowUp` / `arrowDown`). Colours match the bands (A blue, B orange). RSI exactly 50 is neither side, so `49 → 50 → 51` is not a cross.

### 1.2 Decisions

| # | Decision |
|---|---|
| Scope | Anywhere on the chart once a pattern has appeared (not limited to the 5-candle band). |
| Independence | Stands alone; later conditions may build on it. |
| Every cross | **Every** crossing inside the search span is marked (changed from "first cross only" on 2026-10-24). RSI must go back through 50 before the next cross can count. |
| Zone candles included | Crossings on the HTF zone's own candles (the band's 5 candles) **are marked**, as are crossings after it (changed 2026-10-25 — an earlier version, 2026-10-24, excluded the zone). The zone counts toward `scan_candles`. |
| Marker | Arrow above/below the candle (no emoji). |
| Comparison | Strict `<` / `>`. |
| Search length | `scan_candles` in `config/ltf.json`; ships as **20** (placeholder you tune). `0` = no limit. |
| Search start | The **first candle of the highlighted band**. |

### 1.3 How "once a pattern has appeared" works

A small state machine walked left-to-right over the LTF candles:

1. A Matched HTF window is **revealed at its HTF close `C_k`** (existing rule — nothing earlier).
2. The search window starts at the **first LTF candle of the band** (`C_k − htfSec`) and covers **`scan_candles` LTF candles** from there (it includes the 5 band candles). A cross on a band candle **is** marked (see "Zone candles included"); the first candle of the zone can carry an arrow too — its previous RSI is the closed candle just before the zone.
3. **Every** candle that satisfies that pattern's cross, inside the span, is marked. If no cross occurs within `scan_candles` the window shows no arrow. `scan_candles: 0` = search until the next window or session end.
4. A **newer Matched window** (either pattern) supersedes any older one still searching; every crossing inside the span is marked, so a window can yield several marks.
5. Not-Matched / Unavailable HTF candles do not start or stop anything.

Example: Pattern A appears and RSI never crosses up through 50 within 20 candles → no mark. Pattern A is followed by Pattern B before any cross → the A search is dropped and B starts looking for its cross down.

### 1.4 Config

```json
"condition_1_rsi_cross": { "enabled": true, "rsi_period": 14, "level": 50, "scan_candles": 20 }
```
`scan_candles` = integer ≥ 0; `rsi_period` integer ≥ 1; `level` 0–100. Anything else fails closed with a visible config error.

### 1.5 Rule function

```
evaluateCondition1(ltfCandles, rsiValues, windows, cfg)
  -> [{ time, pattern: 'A'|'B', rsi, prevRsi, windowCloseTime }]
```
A mark on candle `i` uses only RSI at `i` and `i-1` (both closed).

### 1.6 Display

LTF markers as in 1.1; a segment in the LTF crosshair readout, e.g. `C1 A ⬆ RSI 51.8 (prev 48.9)`; re-evaluated on instrument / date / timeframe change.

### 1.7 Edge cases

RSI undefined for the first 14 candles → no cross; first candle has no previous → no cross; flat forward-filled candles keep RSI unchanged and cannot create a cross; a window near session end may never see a cross (no mark).

### 1.8 Tests — `tests/ltf-condition1.test.js` (T41…)

Config validation + fail-closed + `enabled:false`; A cross up fires on each crossing (staying above 50 is not a new cross); B mirror; cross before the band's first candle ignored; crosses on the zone's candles count (first, middle, last), first candle after the zone counts, crosses before the zone ignored; new window re-arms; opposite-pattern window supersedes; null RSI → no mark; boundaries 49.99 / 50 / 50.01 (strict); `scan_candles` limit (cross on the last allowed candle fires, one later does not; `0` = unlimited); no look-ahead; marker position/colour per pattern; real-data check on NIFTY + SENSEX for all five LTF pairs; HTF regression gates stay green.

### 1.9 Build order

1. Config + validator + tests.  2. Rule function (TDD).  3. Wire markers, readout, toggle.  4. Verify in browser (NIFTY + SENSEX, all 5 timeframe pairs).  5. README update (§1 files, §2 pipeline, new §6 subsection, §9, §10).

---

## Condition 2 — SMA Trend Filter on Condition 1

### 2.1 What it does

Condition 2 **filters Condition 1**. On the candle where a C1 arrow forms, check the two LTF moving averages the chart plots (SMA 9 and SMA 44, simple averages of closes):

| Pattern | C1 mark kept as C2 when… | Marker |
|---|---|---|
| **A** | SMA 9 **>** SMA 44 on that candle | cyan ⬆ arrow below the candle, label `C1+C2 A` |
| **B** | SMA 9 **<** SMA 44 on that candle | magenta ⬇ arrow above the candle, label `C1+C2 B` |

- **Display (updated — C1 AND C2 combined):** C2 only ever keeps C1 marks, so "C1 AND C2" is simply the C1 marks that also pass the SMA test. Those candles get **one combined arrow** labelled `C1+C2 A` / `C1+C2 B` (cyan ⬆ below / magenta ⬇ above), **replacing** the separate C1 and C2 arrows. C1 marks that fail the SMA test (or have no SMA 44 yet) keep the plain `C1 A` / `C1 B` arrow. One arrow per C1 mark, never two.
- **Strict comparison:** SMA 9 exactly equal to SMA 44 passes neither A nor B.
- **Warm-up:** SMA 44 exists from the 44th LTF candle; before that nothing can pass (a missing value never passes).
- **Depends on C1:** C2 only ever filters C1 marks — it never creates a mark of its own, so it needs Condition 1 active (and HTF Confirmation on).
- **No look-ahead:** verdict uses only closes up to the marked candle.

### 2.2 Config

```json
"condition_2_sma_trend": { "enabled": true, "fast_period": 9, "slow_period": 44 }
```
`fast_period` and `slow_period` are integers ≥ 1 and `fast_period` must be smaller than `slow_period`. Anything else fails closed with a visible config error; `enabled:false` removes C2 (C1 unaffected). Periods are tunable, but note the chart's SMA 9 / SMA 44 **lines** are fixed — change the periods and the drawn lines no longer match what C2 tests.

### 2.3 Rule function

```
evaluateCondition2(ltfCandles, c1Marks, cfg)
  -> the C1 marks that pass, each extended with { smaFast, smaSlow }
```

### 2.4 Display

`combineMarks(c1Marks, c2Marks)` (pure, tested) turns the two lists into one entry per C1 mark (`kind` `C1+C2` or `C1`), drawn in one marker call (sorted by time). The LTF crosshair readout gets a `C2` chip for the hovered band, e.g. `C2 ⬆ 12:58:48  SMA9 22541.2 > SMA44 22530.7`, or `none`.

### 2.5 Tests — `tests/ltf-condition2.test.js` (T53…)

Config validation (incl. fast ≥ slow) + fail-closed; A kept / dropped; B kept / dropped; strict equality; warm-up; only-filters-C1 (output ⊆ input, input not mutated); no look-ahead; real-data check that the SMAs equal the plotted ones and every dropped C1 genuinely fails the test (NIFTY + SENSEX, all five LTF pairs).

### 2.6 Build order (done)

Config + validator → rule function → wiring → tests → README.

---

## SMA spread view (indicator — not a condition)

A view-only indicator on the **LTF** chart: how far SMA 9 is from SMA 44, as a percentage, for **every candle**.

**spread % = (SMA 9 − SMA 44) ÷ SMA 44 × 100** (signed: positive = SMA 9 above SMA 44, negative = below).

- **Histogram pane** under the LTF RSI pane: one bar per candle, green above 0 and red below, dashed zero line, same time axis and crosshair as the price and RSI charts (hover any of the three and all move together).
- **Readout** row above the pane: `time · SMA 9 · SMA 44 · Spread ±x.xxx%` for the hovered candle (latest candle at rest).
- Blank for the first 43 candles (SMA 44 needs 44 candles). The numbers come from the very same SMA arrays the chart plots, so they always match the lines.
- **LTF only**, always on, no config and no toggle; it does not feed Condition 1 or 2 and changes none of their results.
- Code: pure `spreadPct(fast, slow)` in `src/ltf-conditions.js`; tests in `tests/ltf-spread.test.js` (T61–T64).
- Not built (options discussed): per-candle table, text labels under candles, colour strip — add on request.

---

## Condition 3 — SMA Spread Band on C1 + C2

> **Status: IMPLEMENTED and verified** (`condition_3_spread_band` in `config/ltf.json`, `evaluateCondition3` + three-kind `combineMarks` in `src/ltf-conditions.js`, `tests/ltf-condition3.test.js` 63/0; all other suites green; browser-checked). All proposed defaults below were accepted.

### 3.1 What it does

Condition 3 narrows Conditions 1 + 2 further. On the candle where a C1 + C2 mark forms, the **SMA 9 / SMA 44 spread %** (the same number the spread histogram shows) must sit in a small band next to zero:

| Pattern | C1 + C2 mark kept as C3 when the spread % is… | Meaning |
|---|---|---|
| **A** (C1 A and C2 A) | between **0 and +0.020** | SMA 9 only just above SMA 44 |
| **B** (C1 B and C2 B) | between **0 and −0.020** | SMA 9 only just below SMA 44 |

- **Spread %** = (SMA 9 − SMA 44) ÷ SMA 44 × 100 — the formula of the *SMA spread view*, so what you read on the histogram is exactly what is tested. `0.020` therefore means **0.020 %** (not 0.020 points).
- **Chain:** C3 = C1 **AND** C2 **AND** spread band. Like C2, it only filters existing marks and never creates one. C1 or C2 off ⇒ C3 has nothing to filter.
- **Where it is evaluated:** on the candle that carries the C1 + C2 arrow; it reads only SMA values at that candle (no look-ahead).
- **Effect of the band:** the lower end (0) is already enforced by C2 (A needs SMA 9 > SMA 44, B needs <), so C3's real extra bite is the **upper limit 0.020 %** — it removes C1 + C2 marks where the averages have already moved far apart.
- **Warm-up:** no SMA 44 yet (first 43 candles) ⇒ nothing passes.

### 3.2 Decisions (all proposed defaults accepted)

| # | Question | Proposed default |
|---|---|---|
| Q1 | Unit of `0.020` | **Percent** (0.020 %), same as the histogram readout. |
| Q2 | Are the band edges inclusive? | **Lower edge exclusive** (A: spread > 0 / B: spread < 0, already required by C2). **Upper edge inclusive** (A: spread ≤ +0.020, B: spread ≥ −0.020), so exactly 0.020 passes. |
| Q3 | How should a C3 mark look? | Same combining pattern as C2: one arrow per mark, label **`C1+C2+C3 A` / `C1+C2+C3 B`** (distinct colour, e.g. gold ⬆ below / violet ⬇ above), **replacing** the C1+C2 arrow; marks that fail C3 keep their C1+C2 (or C1) arrow. |
| Q4 | SMA periods | **Reuse C2's** `fast_period` / `slow_period` (9 / 44) so C3 always tests the same averages C2 does and the histogram plots. Not separately configurable. |
| Q5 | Is the band a hard-coded 0.020 or configurable? | **Configurable** in `config/ltf.json`; B uses the mirror image (negative) of the same limits. |
| Q6 | Your note read "c2b and c2ba" — I took it as **C1 B and C2 B** (the Pattern B pair). | As stated. |

### 3.3 Config

```json
"condition_3_spread_band": { "enabled": true, "min_pct": 0, "max_pct": 0.02 }
```
- `min_pct` ≥ 0 and `max_pct` > `min_pct` (both numbers, in percent). Pattern A tests `min_pct < spread ≤ max_pct`; Pattern B tests `−max_pct ≤ spread < −min_pct`.
- Invalid ⇒ fail closed with a visible config error (same off / active / error contract). `enabled:false` removes C3; C1 and C2 are unaffected.
- Run `node scripts/build-config.js` and reload after every edit.

### 3.4 Rule function

```
evaluateCondition3(ltfCandles, c2Marks, cfg, c2cfg)
  -> the C2 marks whose spread % is inside the band, each extended with { spreadPct }
```
Uses the pure `spreadPct()` already in `src/ltf-conditions.js` on SMA arrays built with C2's periods. `combineMarks` grows a third kind, `C1+C2+C3`, so there is still **one entry per C1 mark**.

### 3.5 Display

- Marker per 3.2 Q3.
- LTF crosshair readout gets a `C3` chip for the hovered band: `C3 ⬆ 12:58:48  spread +0.015% (0 < x ≤ 0.020)` or `none`.
- No new toolbar toggle: it is covered by **LTF Conditions**.

### 3.6 Edge cases

Spread exactly 0 ⇒ fails (lower edge exclusive; C2 already rejects it). Spread exactly +0.020 / −0.020 ⇒ passes (Q2 default). Spread beyond the limit ⇒ the mark stays as C1+C2. SMA 44 undefined ⇒ dropped. No C2 marks ⇒ no C3 marks.

### 3.7 Tests — `tests/ltf-condition3.test.js` (T65…)

Config validation (min/max ordering, negatives, non-numbers) + fail-closed + `enabled:false`; A inside / on the upper edge / just outside / negative / zero; B mirror; A and B judged by their own sign; only filters C2 (output ⊆ input, input not mutated); no look-ahead; `combineMarks` with three kinds (one entry per C1 mark, correct `kind`); real-data check that every C3 mark's spread equals the histogram value and lies in the band and that every dropped C2 mark genuinely lies outside it (NIFTY + SENSEX, all five LTF pairs); static wiring assertions; existing suites stay green.

### 3.8 Build order (done)

1. (Q1–Q6 confirmed)  2. Config + validator + tests.  3. `evaluateCondition3` + `combineMarks` third kind (TDD).  4. Wire marker, readout chip.  5. Verify in browser (NIFTY + SENSEX, all five pairs).  6. README update.

---

## Condition 4 — SMA-of-RSI Extreme in the Previous 20 Candles (on C1 + C2 + C3)

> **Status: IMPLEMENTED and verified** (`condition_4_rsi_sma_extreme` in `config/ltf.json`, `evaluateCondition4` + `smaNullableArray` + four-kind `combineMarks` in `src/ltf-conditions.js`, `tests/ltf-condition4.test.js` 74/0; all other suites green; browser-checked). Q1 answered **(a)**; all other proposed defaults accepted.

### 4.1 What it does

Condition 4 narrows the chain once more. On the candle that carries a **C1 + C2 + C3** mark, look back over the **previous 20 LTF candles** at the **SMA 14 of RSI 14** (the orange line on the LTF RSI pane) and require that **at least one** of them was at an extreme:

| Pattern | C4 passes when **any one** of the previous 20 candles has SMA-of-RSI… | In words |
|---|---|---|
| **A** | **> 67.50** | momentum had recently been strongly overbought |
| **B** | **< 32.50** | momentum had recently been strongly oversold |

- **Chain:** C4 = C1 **AND** C2 **AND** C3 **AND** C4. Like C2 and C3 it only filters existing marks and never creates one. If C1, C2 or C3 is off, C4 has nothing to filter.
- **"Any one"** means a single candle in the 20 is enough (a max / min test): A passes if `max(SMA-of-RSI over the 20) > 67.50`, B passes if `min(...) < 32.50`.
- **Strict comparison** (`>` / `<`), like every other rule in the project: exactly 67.50 / 32.50 does not count.
- **Values used:** the SMA of RSI is the one the LTF RSI chart already plots (SMA 14 of RSI 14), so what you read on the chart is what is tested.
- **Warm-up:** SMA 14 of RSI 14 first exists at the **28th candle** (index 27). Candles where it does not exist yet are **skipped**; if none of the 20 has a value, C4 fails (a missing value never passes).
- **No look-ahead:** only candles before the marked candle are read.

### 4.2 Decisions (Q1 = option (a); all other proposed defaults accepted)

| # | Question | Proposed default |
|---|---|---|
| Q1 | "Previous 20 candles" — before **what**? (a) the 20 candles immediately **before the arrow candle** itself, or (b) the 20 candles before the **zone's first candle**. | **(a)** — counted back from the candle that carries the arrow, **not including** that candle. These 20 may include zone candles. |
| Q2 | Does the arrow candle itself count? | **No** — strictly the 20 before it. |
| Q3 | Strict or inclusive (`> 67.50` vs `≥`, `< 32.50` vs `≤`)? | **Strict.** |
| Q4 | How should a C4 mark look? | Same combining rule as before: **one arrow per mark**, label **`C1+C2+C3+C4 A` / `C1+C2+C3+C4 B`** in new colours (e.g. **green ⬆ below / red ⬇ above**), **replacing** the C1+C2+C3 arrow. Marks that fail C4 keep the arrow they already earned. |
| Q5 | Are the numbers hard-coded or configurable? | **Configurable** in `config/ltf.json`: lookback, both thresholds, and the RSI / SMA lengths. |
| Q6 | The wording "sma of rsi 14" — I read it as **SMA(14) of RSI(14)**, i.e. the plotted orange line. | As stated; both lengths configurable, defaults 14 / 14. |

Heads-up on how C4 interacts with the others (no change needed, just so it is not a surprise):
- C1 needs RSI to cross **up through 50** for A (down for B), while C4 wants the smoothed RSI to have been **above 67.5** (below 32.5) within the last 20 candles — so the arrows that survive are crosses that follow a recent strong run, and C4 will usually remove a lot of marks.
- The HTF SMA-of-RSI filter (A needs **< 65**, B **> 35**) works on **HTF** candles, so it does not conflict with C4, which works on **LTF** candles.

### 4.3 Config

```json
"condition_4_rsi_sma_extreme": {
  "enabled": true,
  "rsi_period": 14,
  "sma_period": 14,
  "lookback_candles": 20,
  "pattern_a_above": 67.5,
  "pattern_b_below": 32.5
}
```
- `rsi_period`, `sma_period`, `lookback_candles`: integers ≥ 1. `pattern_a_above` and `pattern_b_below`: numbers in 0–100, and `pattern_b_below` must be smaller than `pattern_a_above`.
- Invalid ⇒ fail closed with a visible config error (same off / active / error contract). `enabled:false` removes C4; C1–C3 are unaffected.
- Run `node scripts/build-config.js` and reload after every edit.

### 4.4 Rule function

```
evaluateCondition4(ltfCandles, c3Marks, cfg)
  -> the C3 marks that pass, each extended with { rsiSmaMax | rsiSmaMin, hitTime, hitValue }
```
- Builds SMA(`sma_period`) of Wilder RSI(`rsi_period`) once per run (same maths as the plotted line; a test asserts they agree).
- For each mark at index `i`: examine indices `i − lookback … i − 1` (clamped at the session start), skip empty values, apply the A / B test.
- `hitTime` / `hitValue` record the most recent qualifying candle for the readout.
- `combineMarks` grows a fourth kind, `C1+C2+C3+C4`, so there is still **one entry per C1 mark**.

### 4.5 Display

- Marker per 4.2 Q4.
- LTF crosshair readout gets a `C4` chip for the hovered zone: `C4 ⬆ 12:58:48  SMA-RSI 69.3 @ 12:54:12 (> 67.5)` or `none`.
- No new toggle: covered by **LTF Conditions**.

### 4.6 Edge cases

Fewer than 20 candles before the mark (early session) → use what exists; SMA-of-RSI not defined yet (before the 28th candle) → skipped, and if nothing usable remains → C4 fails; value exactly 67.50 / 32.50 → not a hit; a hit only counts if it lies before the arrow candle; no C3 marks → no C4 marks.

### 4.7 Tests — `tests/ltf-condition4.test.js` (T74…)

Config validation (ordering of the two thresholds, bad lengths) + fail-closed + `enabled:false`; A passes with one candle at 67.51 and fails at exactly 67.50; B passes at 32.49 and fails at exactly 32.50; hit at the 20th candle back passes, at the 21st fails; hit **on** the arrow candle does not count; "any one" (a single qualifying candle among many non-qualifying); A and B judged by their own direction; warm-up skipping and all-empty → fail; only filters C3 (output ⊆ input, input not mutated); no look-ahead; `combineMarks` with four kinds (one entry per C1 mark); real-data check that the SMA-of-RSI equals the plotted line and every kept / dropped mark is correctly classified (NIFTY + SENSEX, all five LTF pairs); static wiring assertions; existing suites stay green.

### 4.8 Build order (done)

1. (Q1–Q6 confirmed)  2. Config + validator + tests.  3. `evaluateCondition4` + `combineMarks` fourth kind (TDD).  4. Wire marker and readout chip.  5. Verify in browser (NIFTY + SENSEX, all five pairs).  6. Update README, `ltf.md` and `ltf_pattern_explanation.md`.

---

## Condition 5 — Back Candle Distance vs E Candle Distance

> **Status: Patterns A and B IMPLEMENTED and verified.** The full explanation, definitions and real-data tables live in
> [../ltf-condition5.md](../ltf-condition5.md); this section is the summary.

- **E candle** = the candle carrying the `C1+C2+C3+C4` arrow (A or B). **E−1** = the candle just before it.
- **Pattern A:** e distance = E high − (E−1) low; back high = max(high) of the `back_candles` candles before E (E excluded, E−1 included);
  back distance = back high − E high.
- **Pattern B (mirror):** e distance = (E−1) high − E low; back low = min(low) of the same candles; back distance = E low − back low.
- **Rule (strict, both patterns):** back candle distance **>** `distance_multiplier` × e candle distance. An e distance ≤ 0, or a back distance ≤ 0, fails.
- **Config:** `condition_5_distance_ratio`: `enabled` true · `back_candles` 20 · `distance_multiplier` 2 (both numbers configurable; run
  `node scripts/build-config.js` and reload after editing).
- **Display:** a passing E candle gets **one** combined arrow `C1+C2+C3+C4+C5 A` (pink ⬆ below) or `C1+C2+C3+C4+C5 B` (pink ⬇ above); a failing one keeps its `C1+C2+C3+C4` arrow.
  Readout chip `C5` on hover: `⬆ 12:58:48  back 44.20 > 2 × e 15.40`.
- Code: `normalizeCondition5` / `evaluateCondition5` / five-kind `combineMarks` in `src/ltf-conditions.js`; tests `tests/ltf-condition5.test.js` (T82–T90, incl. T87 Pattern B).

---

## Condition 6 — _(to be defined)_

_Add below in the same shape (own `condition_6_…` config block, `evaluateCondition6`, test file, sections 6.1–6.x)._
