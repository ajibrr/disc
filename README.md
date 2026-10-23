# TickCharts — NIFTY / SENSEX second-data charts

A TradingView-style dual-chart page for NSE/BSE second-level tick data. Two stacked
timeframes side by side (**HTF** = confirmation, **LTF** = signal), locked at a **5:1
ratio**, with crosshair readouts and indicator panels. Runs entirely in the browser —
no server, no build step, no network access required.

Built on [TradingView Lightweight Charts™ v4.2.0](https://github.com/tradingview/lightweight-charts)
(Apache 2.0), vendored locally.

---

## 1. Files

| Path | What it is |
|---|---|
| `charts/index.html` | The whole app — layout, styles, chart logic and indicator maths in one file |
| `charts/data.js` | **Generated** compact data bundle (`window.CHART_DATA`) — do not edit by hand |
| `charts/build-data.js` | Converts the raw dashboard JSON in `input/` into `data.js` |
| `charts/lib/lightweight-charts.standalone.production.js` | Vendored charting library (v4.2.0) |
| `charts/confirmation.js` | Pure HTF candle-pattern rules + config validation for both filters — no DOM; loaded by the page and `require`d by the tests |
| `charts/tests/confirmation.test.js` | Node test suite for the pattern rules and the completeness predicate |
| `charts/tests/slope-filter.test.js` | Node test suite for the ATR-normalized SMA slope filter (T13–T28) |
| `charts/tests/sma-rsi-filter.test.js` | Node test suite for the SMA-of-RSI filter (T29–T40) |
| `config/htf.json` | HTF filter configuration — both sections (`sma_slope_filter`, `sma_rsi_filter`), the single editable source of truth |
| `charts/build-config.js` | Generates `charts/config.js` from `config/htf.json` — **run after every config change** |
| `charts/config.js` | **Generated** config bundle (`window.HTF_CONFIG`) — do not edit by hand |
| `input/NIFTY_2026-10-23_DASHBOARD.json` | Raw tick source, NIFTY (NSE) |
| `input/SENSEX_2026-10-23_DASHBOARD.json` | Raw tick source, SENSEX (BSE) |

---

## 2. Data pipeline

```
input/*_DASHBOARD.json  ──(node charts/build-data.js)──▶  charts/data.js  ──▶  charts/index.html
```

`build-data.js` reads every `*_DASHBOARD.json` file, extracts the per-second series
(`nifty_seconds` / `sensex_seconds`), splits it into **contiguous segments** wherever the
feed skipped a second, and writes it out as `window.CHART_DATA`.

Run it again whenever you add data:

```bash
node charts/build-data.js
```

Configuration loads the same way — as a plain script, so `file://` keeps working:

```
config/htf.json  ──(node charts/build-config.js)──▶  charts/config.js  ──▶  index.html
```

**Run `node charts/build-config.js` after every change to `config/htf.json`, then reload
`charts/index.html`.** The page reads the generated `charts/config.js`, never the JSON
directly, so an edit that isn't followed by the generator silently keeps the previous
values — and because `config.js` is loaded once at page load, an already-open page keeps
its old values until you reload. The generator exits 1 on malformed JSON (a broken config
can never produce a partial artifact) and embeds a `sourceSha` so you can see which source
produced the bundle. The JSON carries two independent sections — `sma_slope_filter` and
`sma_rsi_filter` (both documented in §6) — each validated separately, neither affecting
the other.

**Current data**

| Instrument | Exchange | Date | Ticks | Session (IST) | Feed gaps | Expiry |
|---|---|---|---|---|---|---|
| NIFTY | NSE | 2026-10-23 | 22,239 | 09:15:00 → 15:30:00 | 237 (max 11s) | 20261027 |
| SENSEX | BSE | 2026-10-23 | 22,239 | 09:15:00 → 15:30:01 | 247 (max 11s) | 20261029 |

- Ticks are 1-second prices; the session spans ~22,500 seconds (22,501 for NIFTY, 22,502 for SENSEX).
- **Gaps are forward-filled**: a bar that receives no ticks carries the previous close, so
  the12s chart never develops holes.
- Adding more dated `*_DASHBOARD.json` files to `input/` and rerunning the script adds
  them to the **Date** dropdown automatically (it disables itself while only one date exists).

---

## 3. Layout

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Toolbar:  Instrument ▾   Date ▾   🔒 1m → 5m · 5:1 locked   session meta  │
├─────────────────────────────────────┬──────────────────────────────────────┤
│ HTF (confirmation)                  │ LTF (signal)                         │
│ [HTF] NIFTY · 2026-10-23  5m   ⤢   │ [LTF] NIFTY · 2026-10-23  1m   ⤢    │
│ O H L C ▲ 22600.00                  │ O H L C ▲ 22600.00                   │
│ ┌─────────────────────────────────┐ │ ┌──────────────────────────────────┐ │
│ │ candles + SMA 9                 │ │ │ candles + SMA 9 + SMA 44 (green) │ │
│ └─────────────────────────────────┘ │ └──────────────────────────────────┘ │
│ RSI 14 66.10  SMA 14 53.37          │ RSI 14 89.62  SMA 14 67.38           │
│ ┌─────────────────────────────────┐ │ ┌──────────────────────────────────┐ │
│ │ RSI 14 + SMA 14 of RSI          │ │ │ RSI 14 + SMA 14 of RSI           │ │
│ └─────────────────────────────────┘ │ └──────────────────────────────────┘ │
└─────────────────────────────────────┴──────────────────────────────────────┘
```

Toolbar controls:

| Control | Behaviour |
|---|---|
| **Instrument** | NIFTY · NSE / SENSEX · BSE |
| **Date** | Sessions available for that instrument (newest first) |
| **🔒 chip** | Shows the live locked pair, e.g. `3m → 15m · 5:1 locked` |
| **HTF Confirmation** | Toggles the candle-pattern visualization (§6) |
| **badge** | `HTF: Matched A · 10:35` — state of the latest eligible completed HTF candle |
| **Meta bar** | Session times, tick count, feed gaps, expiry |
| **⤢ (per panel)** | Fits the whole session into view on both the price and RSI charts |

---

## 4. Timeframes — the locked 5:1 mapping

The two panels cannot drift apart: changing either one drives the other.

| LTF (signal) | HTF (confirmation) | Ratio | Bars per session |
|---|---|---|---|
| 12s | 60s (1m) | 5:1 | 1,876 |
| 36s | 180s (3m) | 5:1 | 626 |
| 60s (1m) | 300s (5m) | 5:1 | 376 |
| 180s (3m) | 900s (15m) | 5:1 | 126 |
| 300s (5m) | 1500s (25m) | 5:1 | 76 |

- Defaults: **LTF = 1m, HTF = 5m**.
- The lock is **bidirectional** — pick 15m on the HTF and the LTF snaps to 3m, and back.
- LTF dropdown offers: `12s 36s 1m 3m 5m` · HTF dropdown offers: `1m 3m 5m 15m 25m`.
- Candles are bucketed from the session open (09:15:00), which is wall-clock aligned for
  every timeframe above, so bars line up across both panels.
- 15m and 25m yield only 25–26 bars for the full 6h15m session — use them for context, not detail.

---

## 5. Indicators

All indicators are calculated **independently from the candles of their own panel** — the
HTF SMA 9 uses HTF candles, the LTF SMA 9 uses LTF candles, and so on.

### 5.1 On the price chart

| Indicator | Panels | Period | Colour | Width | Warm-up |
|---|---|---|---|---|---|
| **SMA 9** | HTF + LTF | 9 bars, simple average of closes | `#ffb020` orange | 2px | starts at bar 9 |
| **SMA 44** | **LTF only** | 44 bars, simple average of closes | `#00e676` green | 2px | starts at bar 44 |

The HTF has no SMA 44 series at all (it is not created), so the two price charts differ by
design. Both overlays share the candle price scale and have no axis labels or price lines.

### 5.2 RSI sub-panel (both panels)

| Indicator | Period | Method | Colour | Width | Warm-up |
|---|---|---|---|---|---|
| **RSI 14** | 14 bars | **Wilder smoothing** (the TradingView default) | `#2962ff` blue | 2px | first value at bar 15 |
| **SMA 14 of RSI** | 14 bars | **Simple average of RSI values** — *not* of price | `#ffb020` orange | 1px | first value at bar 28 |

RSI panel settings:

- Fixed **0–100** price scale, 1 decimal readout.
- Reference bands at **70** (red, `rgba(239,83,80,.6)`) and **30** (green,
  `rgba(38,166,154,.6)`), dashed with axis labels.
- Height 130px, sitting directly under its price chart.

### 5.3 Calculation rules

- SMA = arithmetic mean of the last *n* closes; no value is drawn before *n* closes exist.
- RSI uses Wilder's running average:
  `avg = (prev_avg × 13 + current) / 14`, seeded with the simple mean of the first 14
  changes; `RSI = 100 − 100 / (1 + RS)`, with a rising-only market returning 100.
- SMA-14-of-RSI is computed over the **RSI series**, aligned to the same bar timestamps.
- These are plot-only additions. There is no strategy, entry/exit or signal logic in this
  project, so nothing trading-related changes when indicators are added or edited.

---

## 6. HTF candle-pattern confirmation

An **optional, visualization-only** overlay showing whether the latest completed HTF
candle satisfies your candle-structure rules. This is **pattern matching, not signal
generation**: no entry/exit logic, no strategy behaviour, and nothing computed from
future data.

Toggle with **HTF Confirmation** in the toolbar (default ON). Turning it off removes every
visual and leaves all series data byte-identical.

### Terminology

`Pattern A` (the rules formerly called BUY) · `Pattern B` (formerly SELL) ·
states `Matched`, `Not Matched`, `Unavailable`.

### Rules — evaluated literally, with strict `<` / `>`

Conditions 1–4 must all hold, **plus** either 5A **or** 5B:

| # | Pattern A | Pattern B |
|---|---|---|
| 1 | High(−2) > High(−1) | High(−2) < High(−1) |
| 2 | Low(−2) > Low(−1) | Low(−2) < Low(−1) |
| 3 | candle −2 is red (close < open) | candle −2 is green (close > open) |
| 4 | candle −1 is red (close < open) | candle −1 is green (close > open) |
| 5A | High(−2) > High(−3) and High(−4) and High(−5) | High(−2) < High(−3) and High(−4) and High(−5) |
| 5B | High(−3) > High(−4) and High(−5) | High(−3) < High(−4) and High(−5) |

5B does not reference candle −2, so a pattern can match on 5B alone. It is implemented
exactly as written rather than “corrected”.

### ATR-normalized SMA slope filter (optional, config-driven)

`config/htf.json` can gate both patterns on the slope of the HTF **SMA 9**, normalized by
the HTF **ATR 14**, evaluated on the same HTF candles. Shipped settings: `enabled: true`,
SMA 9, ATR 14, lookback 3 completed candles, `minimum_slope` 0.10.

```text
slope = (SMA9[k] − SMA9[k − lookback]) / ATR14[k]
Pattern A passes when slope >  minimum_slope       Pattern B passes when slope < −minimum_slope
```

- All comparisons are **strict**: a slope exactly at the threshold does not pass, and a
  neutral or unavailable slope never matches — a missing SMA/ATR value is never treated
  as a rising or falling slope.
- Warm-up is `max(sma_period − 1 + lookback, atr_period)` = **14 completed candles**, so
  the first matchable candle is the **15th**. At 25m (15 complete bars) that leaves
  exactly one candidate bar — see §10.
- A filter-rejected match becomes `Not Matched` (no marker, no band); the readout shows
  `slope +0.342 ✓` / `✗` per pattern group, or `slope –` when history is missing.
  `Unavailable` still means only “insufficient pattern-window history”.
- **Invalid config fails closed:** the badge reads `HTF: Config error`, the readout shows
  the first problem, and nothing matches — never a silent fallback to unfiltered
  patterns. Setting `enabled: false` deliberately keeps the original behavior, with the
  other fields inert.
- ATR uses **Wilder's RMA** (seed = mean of the first 14 true ranges), the same smoothing
  convention as the project's RSI. The five-candle rules themselves are untouched.

### SMA-of-RSI filter (optional, config-driven, second gate)

A second, independent gate in `config/htf.json` checks whether the HTF **SMA `period` of
Wilder RSI 14** supports the pattern's move. Shipped settings: `enabled: true`,
`period: 14`, `pattern_a_max: 65`, `pattern_b_min: 35`.

```text
rsi_ma = SMA(period) of Wilder RSI(14) over the HTF candles — the value the RSI sub-panel plots
Pattern A passes when rsi_ma <  pattern_a_max       Pattern B passes when rsi_ma > pattern_b_min
```

- The gated value is **exactly the plotted `SMA 14 (RSI)`** at the same candle index as
  the Pattern A/B evaluation (test T34 proves it element-for-element against the real
  `rsi()` / `smaNullable()` extracted from `index.html`), and the badge reflects the latest
  eligible completed candle — never a future or incomplete one.
- Both comparisons are **strict**: equality at the threshold fails. The RSI length is
  fixed at 14; `period` is the SMA length, so at the shipped `period: 14` the chip equals
  the plotted line.
- Warm-up is `13 + period` = **27 completed candles**: before index 27 the value is
  unavailable and the gate **fails closed** — `Not Matched`, never `Matched`.
  `Unavailable` still means only “insufficient five-candle pattern history”.
- The section is fully independent of `sma_slope_filter`: each validator reads only its
  own key (test T32), so neither can affect the other. With `enabled: false` — or the
  section absent — this filter is bypassed entirely and the five-candle rules plus the
  slope filter behave exactly as before.
- The two filters AND-chain inside `evaluate()`: `Matched ⟺ base pattern ∧ (slope gate if
  active) ∧ (rsi gate if active)`; `evaluatePattern` itself is untouched.
- Readout chips: `rsi 52.81 ✓` appears beside each pattern group whenever the section is
  active, and `rsi –` while the indicator is warming up.
- **Invalid config fails closed, per section:** an enabled-but-invalid section (e.g.
  `pattern_a_max` outside 0–100, non-integer `period`, missing `enabled`) gives badge
  `HTF: Config error`, a readout problem prefixed with the section name (`sma_rsi_filter:
  pattern_a_max must be a finite number in [0, 100]`) and zero matches — even when the
  other section is perfectly valid.
- After editing the section: `node charts/build-config.js`, then **reload the page** (§2).

### Timing

- **Coverage window** — which LTF candles are highlighted: the five closing in
  `(C_k − htfSec, C_k]`. Example: an HTF candle closing **10:35** (5m) against a 1m LTF
  highlights the candles closing **10:31, 10:32, 10:33, 10:34, 10:35**.
- **Reveal time** — when the band appears: at `C_k`, never before. Historical charts show
  every window; live operation reveals a window only after its HTF candle completes.
- Completeness predicate: `candle.time + htfSec - 1 <= sessionEndTick`. The `- 1` is
  load-bearing — see `CandleImplementionplan.md` §5.1 for the measured proof of why the
  off-by-one variant wrongly drops a fully-covered bucket.
- The partial final candle is never evaluated: at 5m, 75 of 76 bars are eligible, and the
  badge reads only the latest **eligible** candle.
- Badge, markers, bands and readouts all read from one `evaluate()` result, so they cannot
  disagree.

### What you see

| Element | Where | Meaning |
|---|---|---|
| Badge `HTF: Matched A · 10:35` | toolbar | state of the latest eligible completed candle |
| `◆ A` / `◆ B` markers | on HTF candle −1 | pattern matched |
| grey `–` markers | first 4 candles | `Unavailable` — insufficient history |
| blue outline box | around candle −2 | the candle being judged |
| blue / amber band | LTF **price** panel only | the five-candle window, 10% alpha, behind the candles |
| readout row | under each chart header | per-condition breakdown (HTF) / window state (LTF) |

`Not Matched` draws **no** marker and **no** band — failures are read in the readout row,
not sprinkled across the chart.

Bands are painted by a Lightweight Charts **primitive** (`series.attachPrimitive` with
`zOrder: 'bottom'`) directly inside the chart canvas, so they sit behind the candle bodies
and stay locked to their candles through zoom, scroll and fit. A DOM element placed behind
the canvas would be invisible: LWC paints an opaque background onto its own canvas.

### Tests

```bash
node charts/tests/confirmation.test.js    # 259 assertions, all passing
node charts/tests/slope-filter.test.js    # 139 assertions, all passing
node charts/tests/sma-rsi-filter.test.js  # 133 assertions, all passing
```

Covers literal rule transcription, strict-comparison boundaries, flat gap candles, the
five-candle window mapping, a no-look-ahead property test, session-boundary isolation,
badge/chart consistency, and the completeness predicate **run against the real
`buildCandles()` extracted from `index.html`** rather than a copy.

The slope-filter suite adds: the three-mode config contract (off / active / fail-closed
error), strict-threshold boundary cases, ATR zero/NaN/malformed-candle safety, slope
no-look-ahead (truncation + slice properties), index.html wiring extraction, and a
real-data property — **enabled matches are always a subset of unfiltered matches**, with
per-timeframe counts printed for both instruments.

The SMA-of-RSI suite adds: strict boundaries derived from real runs, per-pattern gate
directionality, an `enabled:false` bypass proven identical to slope-only output, validator
independence, a 14-case fail-closed battery with visible section-prefixed problems,
**element-for-element equivalence with the plotted SMA 14 of RSI** on real data, badge /
latest-candle timing, the warm-up rule (null before index 27 never matches), and the
monotonicity chain `both ⊆ slope-only ⊆ unfiltered` at every timeframe, with counts
printed for both instruments.

---

## 7. Crosshair & legends

- Dashed crosshair on both the price and RSI charts, following the pointer.
- **Price legend**: `time · O H L C · ▲/▼ close`. Falls back to the last bar when the
  pointer leaves the chart.
- **RSI legend**: `time · RSI 14 value · SMA 14 value`.
- Hovering *either* sub-chart updates **both** legends to that timestamp, and the
  crosshair is mirrored between the price and RSI charts of the same panel.
- Scrolling or zooming one sub-chart moves the other with it (visible-range sync).

Note on sync internals: Lightweight Charts delivers range-change callbacks
asynchronously, so the sync compares against the target chart's current range rather than
using a boolean guard — otherwise the echo snaps the charts back apart.

---

## 8. Appearance

| Element | Value |
|---|---|
| Background | `#131722` (panel `#131722`, page `#0d1117`) |
| Grid lines | `rgba(42,46,57,.6)` |
| Axis borders | `#2a2e39` |
| Candles up / down | `#26a69a` / `#ef5350` (body, border and wick) |
| Crosshair | `#758696`, 1px dashed, grey labels |
| Price format | 2 decimals, min move 0.01 |
| Timestamps | Always **IST** (`Asia/Kolkata`), regardless of the machine's timezone |

---

## 9. Running it

Fastest: open `charts/index.html` straight from disk — `data.js` **and `config.js`** are
loaded as plain scripts, so there is no `fetch()` and no CORS problem. (After editing
`config/htf.json`, rerun `node charts/build-config.js` first **and reload the page** —
see §2.)

To serve it instead (useful for phone/tablet on your network):

```bash
cd charts && npx serve .        # or any static file server
```

Then visit the served URL. The page has no external requests of any kind — the charting
library is vendored in `charts/lib/`.

---

## 10. Known limitations

- The data is a **recorded session**, not a live feed; charts are historical, and the
  Date dropdown currently offers one day until more dashboard files are dropped in.
- The session is 6h15m, so 15m/25m charts are sparse (25–26 candles).
- The `flow` arrays (per-minute CE/PE OI change) present in the source JSON are not
  plotted — the page is price-chart only.
- The session's final bar can be partial (e.g. 76 bars at 5m for a ~22,501s session).
- The slope filter warms up after 14 completed HTF candles, so at **25m** (15 complete
  bars) only the final bar can match with the shipped settings — 25m shows no markers
  unless that single bar matches. `atr_period` in `config/htf.json` is the knob (e.g. 7
  raises the candidates to 4); the five-candle rules themselves are unaffected.
- The SMA-of-RSI filter warms up even later — index **27** (`13 + period`) — so with both
  filters shipped only the 28th candle onward is matchable at all: **15m (25 complete
  bars) and 25m (15) get zero matchable candles and show no markers.** The visible result
  equals today's (the slope filter already yields none there), but turning the slope
  filter off would not help while this one is active. `period` in `config/htf.json` is the
  knob (e.g. 8 lowers warm-up to index 21).
- `charts/config.js` is generated: editing `config/htf.json` without rerunning
  `node charts/build-config.js` keeps the previous values — the page cannot detect a
  *stale* bundle from `file://`, only a *missing* one (which fails closed with a
  regeneration hint).
- An invalid `config/htf.json` fails closed while active: badge `HTF: Config error`,
  readout shows the first problem, zero matches until the config is fixed and regenerated.
