# TickCharts — NIFTY / SENSEX second-data charts

A TradingView-style dual-chart page for NSE/BSE second-level tick data. Two stacked
timeframes side by side (**HTF** = confirmation, **LTF** = signal), locked at a **5:1
ratio**, with crosshair readouts and indicator panels. Runs entirely in the browser —
no server, no build step, no network access required. On top of the charts sits a
**strategy simulation and command-line back-test** (hit ratio, P&L, drawdown …).

Built on [TradingView Lightweight Charts™ v4.2.0](https://github.com/tradingview/lightweight-charts)
(Apache 2.0), vendored locally.

> The current `input/` folder holds **NIFTY** and **SENSEX** sessions (both are supported by the loader).
> The simulation replays recorded sessions — there is no live trading, and its results are **not** evidence of profitability.

---

## Project layout

```
README.md  package.json  .gitignore
├── web/            the app — open web/index.html in a browser
│   ├── index.html          layout, styles, chart logic (one file)
│   ├── lib/                vendored charting library
│   └── generated/          build output the page loads: data.js, config.js, ltf-config.js, strategies-config.js
├── src/            the logic, pure JavaScript with no DOM — shared by the page, the scripts and the tests
│   ├── confirmation.js     HTF Pattern A / B rules and filters
│   ├── ltf-conditions.js   LTF conditions C1–C6 and the signal chain
│   ├── strategies.js       strategy registry (reads config/strategies.json)
│   ├── trade-sim.js        entry / stop / target simulation and statistics
│   └── oi-flow.js · trendlines.js
├── scripts/        command-line tools: build-config.js · build-data.js · run-backtest.js
├── tests/          *.test.js (one per module / condition) and run-all.js
├── config/         the settings you edit: htf.json · ltf.json · strategies.json
├── input/          raw recorded sessions (*_DASHBOARD.json)
├── docs/           all documentation (map below); docs/design/ = historical plans
├── research/       parameter studies, not part of the strategy: optimize/ (sweeps, cross-validation, logs) · evolve/
└── screenshots/
```

Data flows one way: `input/` → `scripts/build-data.js` → `web/generated/data.js` → the page; `config/*.json` → `scripts/build-config.js` → `web/generated/*-config.js` → the page and the back-test.

## Quick start

```bash
npm run build                    # = node scripts/build-config.js && node scripts/build-data.js   (after editing config/ or adding input/)
npm run backtest                 # back-test every recorded session with each strategy switched on (see docs/strategy.md §7)
npm run trades                   # the same, listing every trade
npm test                         # every test suite, one line each
open web/index.html              # the charts (or just double-click the file)
```

> **Market data stays local.** The bundle built from `input/`, `web/generated/data.js`, is gitignored; of the raw `input/*_DASHBOARD.json` recordings only a handful are tracked in git — treat the rest as local files. Put your own `*_DASHBOARD.json` files in `input/` and run `npm run build` before opening the page or running the back-test.

(`npm` is only a shortcut — the project has no dependencies; every command also runs as plain `node …`, for example `node scripts/run-backtest.js --strategy SB_Bhanusali`, `node tests/<name>.test.js`.)

## Documentation map

| Read this | When you want to |
|---|---|
| [docs/algorithm.md](docs/algorithm.md) | see the whole strategy and every setting on **one page** |
| [docs/htf-pattern.md](docs/htf-pattern.md) | understand HTF Pattern A / B in plain language, with worked examples |
| [docs/ltf-pattern.md](docs/ltf-pattern.md) · [docs/ltf-condition5.md](docs/ltf-condition5.md) | understand LTF conditions C1–C5 (C5 in depth) |
| [docs/strategy.md](docs/strategy.md) | entry / exit rules, statistics, back-test results |
| [docs/strategies.md](docs/strategies.md) | switch strategies on / off in `config/strategies.json` and add a new one |
| [docs/analysis.md](docs/analysis.md) | read the findings (OI-filter data issue, what drives profit, costs) and the next-steps list |
| [docs/optimization.md](docs/optimization.md) | see which condition settings help in *both* halves of the data, and why searching all of them together fails |
| [docs/design/](docs/design/) | learn *why* it was built this way (historical plans: HTF confirmation, HTF filters, LTF conditions) |
| this README | the app itself: files, data pipeline, layout, indicators, crosshair, running, limitations |

---

## 1. Files

**App and data**

| Path | What it is |
|---|---|
| `web/index.html` | The whole app — layout, styles, chart logic and indicator maths in one file |
| `web/lib/lightweight-charts.standalone.production.js` | Vendored charting library (v4.2.0) |
| `web/generated/data.js` | **Generated** compact data bundle (`window.CHART_DATA`) — do not edit by hand |
| `scripts/build-data.js` | Converts the raw dashboard JSON in `input/` into `data.js` |
| `input/*_DASHBOARD.json` | Raw per-session tick + option-chain flow sources (currently 31 NIFTY files; a date in two files is read once, the later file wins) |

**Configuration** (edit the JSON, then run `node scripts/build-config.js`)

| Path | What it is |
|---|---|
| `config/htf.json` | HTF filters: `sma_slope_filter`, `sma_rsi_filter`, `oi_change_filter` — single editable source of truth |
| `config/ltf.json` | LTF conditions: `condition_1_rsi_cross` … `condition_6_risk_range` |
| `config/strategies.json` | **Strategy registry** — every strategy with an `enabled` switch, a plain-English `summary`, its `signals` generator and its `trade` rules (`stop_multiple`, `target_multiple`, `round_trip_cost_points`, `no_entry_from`, `hard_exit_at`). Holds `SB_Bhanusali` (on) |
| `scripts/build-config.js` | Generates the three bundles below from the three JSON files |
| `web/generated/config.js` · `web/generated/ltf-config.js` · `web/generated/strategies-config.js` | **Generated** (`window.HTF_CONFIG` / `LTF_CONFIG` / `STRATEGIES_CONFIG`) — do not edit by hand |

**Rule modules** (pure — no DOM; loaded by the page and `require`d by the tests / back-test)

| Path | What it is |
|---|---|
| `src/confirmation.js` | HTF candle-pattern rules + config validation for the three HTF filters |
| `src/ltf-conditions.js` | LTF conditions C1–C5, the shared chain (`TL.runChain`) and their config validation |
| `src/oi-flow.js` | Option-chain flow helpers: CE / PE OI change per HTF candle, number formatting |
| `src/trendlines.js` | Trend-line helpers (time / price anchors, hit-testing, storage) |
| `src/replay.js` | Bar-replay helpers: the session cut to the ticks up to a replay time |
| `src/trade-view.js` | How a trade is drawn on the LTF chart: entry / exit candle columns, the position box, level lines, emoji labels (pure geometry) |
| `src/strategies.js` | Strategy registry: validates `config/strategies.json`, says which strategies exist / are on / can run, and produces each one's signals |
| `src/trade-sim.js` | Strategy simulation and statistics (shared by every strategy) |
| `scripts/run-backtest.js` | Command-line back-test over every recorded session |
| `package.json` | Shortcuts only (`npm run build / backtest / trades / test`); no dependencies |

**Tests** (`npm test` runs all; or `node tests/<file>`; test IDs in brackets)

| File | Covers |
|---|---|
| `confirmation.test.js` | HTF base rules, timing, completeness predicate |
| `slope-filter.test.js` (T13–T28) · `sma-rsi-filter.test.js` (T29–T40) · `oi-filter.test.js` (T107–T112) | the three HTF filters |
| `oi-flow.test.js` (T103–T106) | HTF CE / PE OI-change lines |
| `ltf-condition1.test.js` (T41–T52) · `ltf-condition2.test.js` (T53–T60) · `ltf-condition3.test.js` (T65–T73) · `ltf-condition4.test.js` (T74–T81) · `ltf-condition5.test.js` (T82–T90) · `ltf-condition6.test.js` (T130–T134) | LTF conditions |
| `ltf-spread.test.js` (T61–T64) | the SMA-spread calculation (used by C3) |
| `trade-sim.test.js` (T91–T102) | shared chain and strategy simulation |
| `run-all.js` | runs every suite and prints one line each |
| `strategies.test.js` (T121–T124) | strategy registry, validation, SB_Bhanusali signals, selector and back-test wiring |
| `trendlines.test.js` (T113–T120) | trend-line helpers and page wiring |
| `trade-view.test.js` (T150–T154) | trade drawing: geometry of the columns, the position box and the level lines; labels; page wiring |
| `replay.test.js` (T140–T144) | bar replay: truncation, no look-ahead (candles and signals), page wiring |

**Other**

| Path | What it is |
|---|---|
| `docs/` | All documentation — see the map above |
| `research/optimize/optimize.js` | Parameter study for the LTF conditions C1–C6: one-parameter sweeps and a train / test greedy search, reported for the older and newer half of the sessions ([docs/optimization.md](docs/optimization.md)). Writes nothing to the config |
| `research/evolve/evolve.js` | **Experimental**, separate from the strategy: a genetic strategy search with walk-forward validation (options such as `--cost`, `--seed`, `--pop`, `--gens` are listed in its header comment) |
| `screenshots/` | Reference screenshots (crosshair alignment) |

---

## 2. Data pipeline

```
input/*_DASHBOARD.json  ──(node scripts/build-data.js)──▶  web/generated/data.js  ──▶  web/index.html
```

`build-data.js` reads every `*_DASHBOARD.json` file, extracts the per-second series
(`nifty_seconds` / `sensex_seconds`), splits it into **contiguous segments** wherever the
feed skipped a second, and writes it out as `window.CHART_DATA`.

Run it again whenever you add data:

```bash
node scripts/build-data.js
```

Configuration loads the same way — as a plain script, so `file://` keeps working:

```
config/htf.json  ──(node scripts/build-config.js)──▶  web/generated/config.js  ──▶  index.html
```

**Run `node scripts/build-config.js` after every change to `config/htf.json`, then reload
`web/index.html`.** The page reads the generated `web/generated/config.js`, never the JSON
directly, so an edit that isn't followed by the generator silently keeps the previous
values — and because `config.js` is loaded once at page load, an already-open page keeps
its old values until you reload. The generator exits 1 on malformed JSON (a broken config
can never produce a partial artifact) and embeds a `sourceSha` so you can see which source
produced the bundle. `config/htf.json` carries three independent sections — `sma_slope_filter`,
`sma_rsi_filter` and `oi_change_filter` (all documented in §6) — each validated separately,
neither affecting the others. `config/ltf.json` and `config/strategies.json` work the same way.

**Current data:** 29 distinct NIFTY sessions, 2026-09-11 → 2026-10-27, plus 3 SENSEX sessions (2026-10-21 → 2026-10-23), from 32 files with no duplicate dates. A typical session is 09:15:00 → 15:30:00 IST with a few
hundred feed gaps of up to ~11 s. Each file also carries a `flow` series (CE / PE open-interest columns) — see [docs/analysis.md](docs/analysis.md) §2 for a caveat on how those columns behave.

- Ticks are 1-second prices; a session spans ~22,500 seconds.
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
| **⤢ (per panel)** | Fits the whole session into view on the price chart |

---

## 4. Timeframes — the locked 5:1 mapping

The two panels cannot drift apart: changing either one drives the other.

| LTF (signal) | HTF (confirmation) | Ratio | Bars per session |
|---|---|---|---|
| 12s | 60s (1m) | 5:1 | 1,876 |
| 36s | 180s (3m) | 5:1 | 626 |

- **Only these two pairs are offered.** The slower pairs (60s/5m, 3m/15m, 5m/25m) produced almost no signals — the HTF series is too short for the filters to warm up ([docs/optimization.md](docs/optimization.md) §6) — so they were removed from the page and from the back-test.
- Defaults: **LTF = 12s, HTF = 1m**.
- The lock is **bidirectional** — pick 3m on the HTF and the LTF snaps to 36s, and back.
- LTF dropdown offers: `12s 36s` · HTF dropdown offers: `1m 3m`.
- Candles are bucketed from the session open (09:15:00), which is wall-clock aligned for
  every timeframe above, so bars line up across both panels.

---

## 5. Indicators

All indicators are calculated **independently from the candles of their own panel** — the
HTF SMA 9 uses HTF candles, the LTF SMA 9 uses LTF candles, and so on.

### 5.1 On the price chart

| Indicator | Panels | Period | Colour | Width | Warm-up |
|---|---|---|---|---|---|
| **SMA 9** | HTF + LTF | 9 bars, simple average of closes | `#d1d4dc` light grey | 2px | starts at bar 9 |
| **SMA 44** | **LTF only** | 44 bars, simple average of closes | `#00e676` green | 2px | starts at bar 44 |

The HTF has no SMA 44 series at all (it is not created), so the two price charts differ by
design. Both overlays share the candle price scale and have no axis labels or price lines.

### 5.2 RSI — calculated, not drawn

The RSI sub-panel that used to sit under each price chart (RSI 14 and its SMA 14, with 70 / 30 bands) has been **removed from both the HTF and the LTF page**. RSI 14 and the SMA 14 of RSI are still
**calculated** — Condition 1 (RSI cross), Condition 4 (SMA-of-RSI extreme) and the HTF SMA-of-RSI filter use them, with the rules in 5.3 — they are just not plotted.

### 5.3 Calculation rules

- SMA = arithmetic mean of the last *n* closes; no value is drawn before *n* closes exist.
- RSI uses Wilder's running average:
  `avg = (prev_avg × 13 + current) / 14`, seeded with the simple mean of the first 14
  changes; `RSI = 100 − 100 / (1 + RS)`, with a rising-only market returning 100.
- SMA-14-of-RSI is computed over the **RSI series**, aligned to the same bar timestamps.
- These are plot-only additions: adding or editing an indicator changes no signal. (The condition chain and the strategy
  simulation, §6, are separate and read the same indicator values.)

---

## 6. HTF candle-pattern confirmation

An **optional overlay** showing whether the latest completed HTF
candle satisfies your candle-structure rules. This part is **pattern matching only**: no
entry/exit logic, and nothing computed from future data. (The LTF condition chain built on top of
it, and the strategy **simulation** that replays recorded sessions — never live trading — are
described below and in [`docs/strategy.md`](docs/strategy.md).)

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
SMA 9, ATR 14, lookback 3 completed candles, `minimum_slope` 0.25 (retuned from the
originally approved 0.10 — the shipped-value tests read the value from the file).

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

### Option-chain OI-change filter (optional, config-driven, third gate)

A third, independent gate in `config/htf.json` → `oi_change_filter` (`enabled`, `minimum_difference` 0) checks the **CE / PE open-interest change** of the candle being
evaluated (candle −1; the sum of its minutes for candles longer than 1m — see the HTF option-chain flow section below):

```text
Pattern A passes when  PE change − CE change  >  minimum_difference        Pattern B passes when  CE change − PE change  >  minimum_difference
```

- **Strict and signed** (PE −100 is greater than CE −500). **Missing data fails closed**: a session without option-chain flow, or a candle with no minute in it, is `Not Matched`.
- All gates AND-chain: `Matched ⟺ base pattern ∧ slope ∧ RSI-SMA ∧ OI change` (each only while its section is active). `enabled: false` restores the previous behaviour exactly.
- **Currently `enabled: false`.** The flow columns in the input files appear to be running totals since the open, not per-minute changes, so this gate behaves like a once-a-day side flag and lowered the back-test result — details and the proposed fix in [docs/analysis.md](docs/analysis.md) §2.
- The HTF readout shows an `oi PE … CE … ✓/✗` chip. An invalid section fails closed with `HTF: Config error`. Tests: `tests/oi-filter.test.js` (T107–T112).
- After editing: `node scripts/build-config.js`, then reload the page.

### SMA-of-RSI filter (optional, config-driven, second gate)

A second, independent gate in `config/htf.json` checks whether the HTF **SMA `period` of
Wilder RSI 14** supports the pattern's move. Shipped settings: `enabled: true`,
`period: 14`, `pattern_a_max: 65`, `pattern_b_min: 35`.

```text
rsi_ma = SMA(period) of Wilder RSI(14) over the HTF candles — the SMA 14 of the Wilder RSI 14 (calculated; the RSI panel is no longer drawn)
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
- After editing the section: `node scripts/build-config.js`, then **reload the page** (§2).

### Timing

- **Coverage window** — which LTF candles are highlighted: the five closing in
  `(C_k − htfSec, C_k]`. Example: an HTF candle closing **10:35** (5m) against a 1m LTF
  highlights the candles closing **10:31, 10:32, 10:33, 10:34, 10:35**.
- **Reveal time** — when the band appears: at `C_k`, never before. Historical charts show
  every window; live operation reveals a window only after its HTF candle completes.
- Completeness predicate: `candle.time + htfSec - 1 <= sessionEndTick`. The `- 1` is
  load-bearing — see [docs/design/htf-confirmation-plan.md](docs/design/htf-confirmation-plan.md) §5.1 for the measured proof of why the
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
node tests/confirmation.test.js    # 259 assertions, all passing
node tests/slope-filter.test.js    # 139 assertions, all passing
node tests/sma-rsi-filter.test.js  # 133 assertions, all passing
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

### LTF Condition 1 — RSI 50 cross (continuation)

Spec: [`docs/design/ltf-conditions-plan.md`](docs/design/ltf-conditions-plan.md). After each highlighted Pattern A / B band on the **LTF** chart, every
candle inside the search span (**zone candles included**) whose LTF RSI 14 crosses 50 in the pattern's direction gets an arrow marker (`C1 A` below the
candle, `C1 B` above it; strict comparisons, so exactly 50 is neither side):

- **A** — previous RSI **< 50** and current RSI **> 50**; **B** — previous **> 50** and current **< 50**.
- The span is counted from the band's **first candle** (position 1): only crossings at positions `scan_min_candles` … `scan_max_candles`
  count (shipped 1 … 20; `scan_max_candles` `0` = unlimited), so the 5 zone candles use up part of it; a newer band ends an older band's search. Crosses on the **zone's own candles count**, as do
  crosses after it, and **every** cross inside the span is marked (crosses before the zone are ignored).
- Configured in `config/ltf.json` → `condition_1_rsi_cross` (`enabled`, `rsi_period`, `level`, `scan_min_candles`, `scan_max_candles`; the older single `scan_candles` is still read as the maximum);
  run `node scripts/build-config.js` and reload after every edit. Invalid config fails closed (no arrows, the LTF
  readout shows the problem); `enabled:false` removes the condition.
- Toolbar **LTF Conditions** toggle clears only these arrows. It needs **HTF Confirmation** on (the bands are its input).
- The LTF crosshair readout shows a `C1` chip for the hovered band (`⬆ 13:41:12, 13:43:24  last: RSI 51.8 (prev 48.9)` or `no cross`).

### LTF Condition 2 — SMA trend filter on Condition 1

Spec: [`docs/design/ltf-conditions-plan.md`](docs/design/ltf-conditions-plan.md). On the candle where a C1 arrow forms, the LTF SMA 9 and SMA 44 must agree with the
pattern: **A** needs SMA 9 **>** SMA 44, **B** needs SMA 9 **<** SMA 44 (strict). Where C1 **and** C2 both hold, the
candle gets **one combined arrow** `C1+C2 A` (cyan, below) / `C1+C2 B` (magenta, above) in place of the plain C1
arrow; C1 marks that fail the SMA test keep the plain `C1 A` / `C1 B` arrow.

- Configured in `config/ltf.json` → `condition_2_sma_trend` (`enabled`, `fast_period` 9, `slow_period` 44);
  `fast_period` must be smaller than `slow_period`. Run `node scripts/build-config.js` and reload after every edit;
  invalid config fails closed (no C2 arrows, readout shows the problem). The chart's SMA lines stay 9 / 44.
- It only filters C1 marks (never creates its own), so it needs Condition 1 active. SMA 44 needs 44 candles of
  history, so C2 cannot appear in the first 43 candles of the session.
- The LTF crosshair readout shows a `C2` chip (`⬆ 12:58:48  SMA9 … > SMA44 …` or `none`).

### LTF Condition 3 — SMA spread band on C1 + C2

Spec: [`docs/design/ltf-conditions-plan.md`](docs/design/ltf-conditions-plan.md). On a C1 + C2 candle the SMA 9 / SMA 44 **spread %** (the SMA 9 / SMA 44 spread, calculated but no longer plotted) must sit in a
small band next to zero: **A** `0 < spread ≤ +0.020` (`max_pct`), **B** `−0.020 ≤ spread < 0` (lower edge exclusive — C2 already
needs the right sign — upper edge inclusive). Where C1 **and** C2 **and** C3 hold, the candle gets **one** arrow
`C1+C2+C3 A` (gold, below) / `C1+C2+C3 B` (violet, above); marks that reach only C2 keep `C1+C2`, only C1 keep `C1`.

- `config/ltf.json` → `condition_3_spread_band` (`enabled`, `min_pct` 0, `max_pct` 0.02, in **percent**; B mirrors
  the limits). C3 reuses C2's SMA periods and only filters C2 marks (never creates its own). Run
  `node scripts/build-config.js` and reload after every edit; invalid config fails closed (readout shows the problem).
- The LTF crosshair readout shows a `C3` chip (`⬆ 12:58:48  spread +0.015% (0 < x ≤ 0.02)` or `none`).

### LTF Condition 4 — SMA-of-RSI extreme before the arrow (on C1 + C2 + C3)

Spec: [`docs/design/ltf-conditions-plan.md`](docs/design/ltf-conditions-plan.md). A C1 + C2 + C3 mark is kept only if **any one of the previous 20 LTF candles** (counted back from
the arrow candle, which itself is excluded) has **SMA 14 of RSI 14** at an extreme: **A** `> 67.50`, **B** `< 32.50`
(strict). Where all four conditions hold the candle gets **one** arrow `C1+C2+C3+C4 A` (green, below) /
`C1+C2+C3+C4 B` (red, above); marks that stop earlier keep the arrow they earned.

- `config/ltf.json` → `condition_4_rsi_sma_extreme` (`enabled`, `rsi_period` 14, `sma_period` 14, `lookback_min_candles` 1, `lookback_max_candles` 20,
  `pattern_a_min` 67.5, `pattern_a_max` 100, `pattern_b_min` 0, `pattern_b_max` 32.5). **Ranges:** the SMA-of-RSI is checked on the candles `lookback_min_candles` … `lookback_max_candles`
  before the arrow (1 = the one just before); Pattern A needs a value with `pattern_a_min < value ≤ pattern_a_max`, Pattern B `pattern_b_min ≤ value < pattern_b_max`.
  The older keys `lookback_candles`, `pattern_a_above`, `pattern_b_below` are still read (maximum / A minimum / B maximum, other edges open). Only filters C3 marks, never creates its own. Run
  `node scripts/build-config.js` and reload after every edit; invalid config fails closed (readout shows the problem).
- SMA-of-RSI first exists at the 28th candle; candles without a value are skipped, and with none usable the mark fails.
- The LTF crosshair readout shows a `C4` chip (`⬆ 12:58:48  SMA-RSI 67.9 @ 12:57:00 (> 67.5)` or `none`).

### LTF Condition 5 — back candle distance vs e candle distance

Spec: [`docs/ltf-condition5.md`](docs/ltf-condition5.md). The **E candle** is the candle with the `C1+C2+C3+C4` arrow. **Pattern A:** e distance = E high − (E−1) low,
back distance = (highest high of the previous `back_candles` candles) − E high. **Pattern B (mirror):** e distance = (E−1) high − E low,
back distance = E low − (lowest low of the same candles). The E candle is kept only if **back distance > `distance_multiplier` × e distance**
(strict; 20 and 2 by default). A passing E candle gets one combined arrow `C1+C2+C3+C4+C5 A` (pink ⬆ below) or `… B` (pink ⬇ above);
a failing one keeps its `C1+C2+C3+C4` arrow.

- `config/ltf.json` → `condition_5_distance_ratio` (`enabled`, `back_candles`, `distance_multiplier`). Only filters C4 marks, never creates its own.
  Run `node scripts/build-config.js` and reload after every edit; invalid config fails closed (readout shows the problem).

### LTF Condition 6 — risk range (both patterns)

Config: `config/ltf.json` → `condition_6_risk_range` (`enabled`, `min_risk_points` 3.5, `max_risk_points` 8). On a `C1+C2+C3+C4+C5` candle, the **E candle distance** — which is the trade's risk, because the stop sits
`stop_multiple` × that distance from the entry — must be **at least** `min_risk_points` and **strictly below** `max_risk_points`. The same range applies to long (Pattern A) and short (Pattern B). Only candles that pass
become the full signal `C1+C2+C3+C4+C5+C6` (pink arrow); a candle that passed C5 but not C6 keeps a muted-purple `C1+C2+C3+C4+C5` arrow and is **not traded**.
Set `enabled: false` to go back to C1–C5 as the full signal. Tests: `tests/ltf-condition6.test.js` (T130–T134). Run `node scripts/build-config.js` and reload after editing.
- An e distance ≤ 0 or a back distance ≤ 0 fails. The LTF crosshair readout shows a `C5` chip (`back 44.20 > 2 × e 15.40`, `none`, or `Pattern A only`).

### Trend lines (drawing tool)

Draw trend lines on the **HTF and LTF price charts**, as in TradingView.

- **Draw:** click **✎ Trend line** in the toolbar, then click two points on a price chart (a dashed preview follows the mouse). Esc cancels.
- **Adjust:** click a line to select it (it shows two round handles); drag a handle to move one end, or drag the line to move the whole line. Grabbing a line does not pan the chart.
- **Delete:** select a line and press **Delete** (or **Backspace**), or click **Delete**. **Clear** removes every line of the instrument / date on both charts (it asks first).
- **Parallel line:** select a line, click **∥ Parallel**, then click where the parallel should pass — a dashed preview follows the mouse and the new line copies the base line's two times, slope, colour and extension, shifted to go through your click (the button is greyed out until a line is selected; Esc cancels). It is an ordinary line afterwards, moved and deleted on its own.
- **Width, colour and extension:** every line is drawn **1 px** wide. The colour picker and **Extend →** switch apply to the selected line, and to new lines when nothing is selected. **Extend → is off by default**: a new line stops at its second point; switch it on and the line continues to the right edge of the chart along its slope.
- **Anchored to time and price,** not pixels: a line follows pan and zoom, and survives a change of timeframe on its chart. HTF and LTF each keep their own lines per instrument and date.
- **Saved in the browser** (`localStorage`, key `tickcharts.trendlines.v1`) and restored on reload. They live in this browser only — another browser or a cleared site-data setting starts empty — and nothing else in the project reads them (no condition, filter or trade uses a trend line).
- Code: `src/trendlines.js` (maths, hit-testing, storage) and the `Panel` trend-line methods in `web/index.html` (a series primitive paints the lines).

### HTF option-chain flow — CE / PE open-interest change

The HTF **price chart itself** carries two extra lines: **CE OI change** (red) and **PE OI change** (green), built from the `ce_oi_change` /
`pe_oi_change` columns of the `flow` series in the dashboard files. The candles use the upper part of the chart (right price axis) and the two lines run in a band
under them on their **own left axis** (short numbers such as `231.45M`). The readout row above the chart shows both values of the hovered candle as full numbers
(`CE OI change +231,448,685  PE OI change +70,161,715`)..
The trade-off: the candles get less height than on the LTF chart, and the left axis labels run up the full height although the lines occupy only the lower band.

- **Per candle:** the file has one change per minute (the change during the minute that ends at its timestamp). A **1-minute** candle shows exactly that number;
  a longer candle shows the **sum of the minutes that ended inside it** (5m = five minutes added up), and the readout says how many minutes. A snapshot stamped
  09:20:01 counts as the 09:20 minute, and the 09:15 baseline row (zero) belongs to no candle. A candle never carries a minute that ended after its close.
- **Source:** `build-data.js` keeps the first snapshot of each minute per session. The per-second file for NIFTY 21-10 has no change columns, so there the change
  is worked out as the difference of consecutive cumulative values (in the per-minute files the change columns equal exactly that difference).
  Run `node scripts/build-data.js` after adding input files. A session with no flow data shows a dash and no lines.
- The cumulative CE / PE values are **not** plotted. HTF only; display only — it feeds no pattern, condition or trade rule.

### Strategy simulation and back-test

Spec and first results: [`docs/strategy.md`](docs/strategy.md). Pattern A signals are **long**, Pattern B **short**. A full `C1+C2+C3+C4+C5` signal enters at the
**open of the next candle** (never before its HTF zone has closed), with **stop = 1 ×** and **target = 2 ×** the E candle distance from the entry price
(`config/strategies.json` → `SB_Bhanusali.trade`). The second-by-second ticks decide which level is reached first. **Session rules (IST):** no entry from **15:10**, and a **hard exit at 15:19** closes any
trade still open (`no_entry_from` / `hard_exit_at`, each can be `null` to switch it off); with no hard exit a trade closes at the last price of the session.
Results are points for 1 unit.

- **On the page:** a toolbar badge (`Strategy: 2 trades · hit 50% · P&L +10.70 pts`, hover for the details) and, on the LTF chart, **LONG @ / SHORT @**
  squares at the entries and **TP / SL / EOD** circles at the exits. Needs **LTF Conditions** on.
- **Browser console:** a `[strategy] …` group with the trade table and statistics each time the LTF chart is evaluated (F12).
- **All sessions:** `node scripts/run-backtest.js` (`--trades`, `--ltf 12,36`, `--json`, `--out backtest.log` to save a log file, and `--set ltf.condition_5_distance_ratio.distance_multiplier=2` for a
  one-run what-if). It prints the hit ratio, total / average P&L, profit factor, drawdown, the long / short split and the per-session table.
- The whole C1 → C5 chain is evaluated by one shared function (`TL.runChain` in `src/ltf-conditions.js`), used by the page, the simulation and the runner.
- Nothing here is a trading system: no orders, no live data. The recorded sample is small and the rules were tuned on it, so the numbers are illustrations.

### SMA spread — calculated, not drawn

The histogram pane of **(SMA 9 − SMA 44) ÷ SMA 44 × 100** that used to sit under the LTF price chart (with its `SMA 9 · SMA 44 · Spread` readout) has been **removed**. The spread is still
**calculated** — Condition 3 tests it against the `min_pct` … `max_pct` band — and the Condition 3 readout chip still shows the spread of the hovered candle; it is just no longer plotted.

## 7. Crosshair & legends

- Dashed crosshair on the price chart, **snapped to the hovered candle**
  (Magnet mode). The line, its time label, both legends and the confirmation readout
  always name the same bar — in Normal mode the line could rest between candles while
  the labels named a neighbouring one.
- **Price legend**: `time · O H L C · ▲/▼ close`. Falls back to the last bar when the
  pointer leaves the chart.
- Hovering a panel's chart updates its legends and the confirmation readout to that timestamp.
- **The HTF and LTF panels mirror each other too.** Hovering one panel's chart
  pins the other panel at the same *moment*, snapped to that timeframe's own candle —
  hovering a 1m candle at 12:28 highlights the 12:25 5m candle on the HTF, and both
  panels' legends and confirmation readouts follow. (Lightweight Charts does not re-fire
  `crosshairMove` for a programmatic pin, so the mirror redraws the target's legends and
  readout directly.) The horizontal line stays on each panel's own series — an HTF and
  an LTF price level are different quantities — while the vertical lines and time labels
  are parallel.
- **Zoom and scroll are synchronized between the panels**, so the parallel lines stay
  parallel after any range change. The visible logical ranges are converted with the
  matching half-slot padding (`l_dst = k·l_src ∓ (k−1)/2`, k = bar-time ratio):
  Lightweight Charts measures a range *inclusively* and anchors a bar to its slot
  center, so a naive seconds conversion left the panels off by one whole slot
  (300s vs 60s → ±10.7px at the window edges, measured). With the padding, the same
  timestamp lands on **pixel-identical x on all four charts** at window start, middle
  and end, in both directions, at any zoom.
- Scrolling or zooming one sub-chart moves the other with it (visible-range sync).

Note on sync internals: Lightweight Charts delivers range-change callbacks
asynchronously, so the sync compares against the target chart's current range rather than
using a boolean guard — otherwise the echo snaps the charts back apart.

---

### How a trade is drawn on the LTF chart

Every simulated trade of the selected strategy is highlighted so the entry and exit candles are easy to find:

- **Entry candle** — a **white column** behind the whole candle, an arrow (cyan ▲ below the candle for a long, amber ▼ above it for a short) and the label **🟢 LONG 22850.55** / **🔴 SHORT 22850.55**.
- **Exit candle** — a **green column** (profit) or **red column** (loss) and the label **✅ TP +14.35**, **❌ SL −3.75**, **⏰ HARD +2.00** or **🔚 EOD 0.00**.
- **Position box** between them (behind the candles): a green zone from the entry price up / down to the target, a red zone from the entry price to the stop, a green / red outline for the result, and dashed **entry** (white), **target** (green) and **stop** (red) lines.
- A trade that is still open (bar replay) has no exit column; its box runs on to the right edge and its label ends with `(open)`.

### Bar replay

The toolbar's **⏪ Bar replay** shows a session as if it were happening. Click it, then **click a candle on either chart** — everything after that candle disappears and the session plays forward from there.

| Control | What it does |
|---|---|
| ▶ / ⏸ (or **Space**) | play / pause |
| ⏮ / ⏭ (or **← / →**) | back / forward one LTF candle |
| speed | 1× · 2× · 5× · 10× · 25× (candles per second: 1, 2, 5, 10, 25) |
| slider | jump to any candle of the session |
| bars in view | 60 · 120 · 240 · 500 candles visible at once (the HTF chart shows the same stretch of time) |
| ✕ Exit (or **Esc**) | back to the whole session |

- **Nothing from the future is ever used.** At every step the page rebuilds both charts, every indicator, the HTF patterns, the C1–C6 arrows and the strategy trades from **only the ticks up to the replay time** (`src/replay.js`). The newest LTF candle is always complete; the newest HTF candle is still forming, and the HTF rules do not count a candle until it has closed — so no pattern appears early.
- **Trades** appear when their signal is found, as in live trading. A trade that has not yet reached its stop or target is marked `(open)` and left out of the statistics until it closes; the strategy badge and the P&L therefore only count finished trades.
- Changing the instrument or date leaves replay; changing the timeframe keeps the replay time.
- Tests: `tests/replay.test.js` (T140–T144) — among them a check on real sessions that the candles and the strategy signals found on the truncated session are exactly those of the full session that were already knowable (no leaks, none missing).

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

Fastest: open `web/index.html` straight from disk — the files in `web/generated/` and `src/` are
loaded as plain scripts, so there is no `fetch()` and no CORS problem. (After editing
`config/htf.json`, rerun `node scripts/build-config.js` first **and reload the page** —
see §2.)

To serve it instead (useful for phone/tablet on your network):

```bash
npx serve .                     # from the PROJECT ROOT (the page loads ../src/*.js), or any static file server
```

Then visit the served URL followed by `/web/index.html`. The page has no external requests of any kind — the charting
library is vendored in `web/lib/`.

---

## 10. Known limitations

- The data is **recorded sessions**, not a live feed; charts are historical. The Date dropdown lists every session in `data.js`.
- The session is 6h15m, so 15m/25m charts are sparse (25–26 candles).
- Only the CE / PE OI **change** of the `flow` series is shown (HTF price chart); the cumulative values and the `atm` / index columns are not plotted.
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
- `web/generated/config.js` is generated: editing `config/htf.json` without rerunning
  `node scripts/build-config.js` keeps the previous values — the page cannot detect a
  *stale* bundle from `file://`, only a *missing* one (which fails closed with a
  regeneration hint).
- **OI-change data semantics:** `ce_oi_change` / `pe_oi_change` in the flow rows grow all day and `cumulative_*` is their running sum, so the HTF CE / PE lines and the OI-change filter
  show running totals, not per-minute changes ([docs/analysis.md](docs/analysis.md) §2). The filter is off until this is resolved.
- The back-test is **before costs** and covers a small sample; see [docs/strategy.md](docs/strategy.md) §8 and [docs/analysis.md](docs/analysis.md) §4.
- An invalid `config/htf.json` fails closed while active: badge `HTF: Config error`,
  readout shows the first problem, zero matches until the config is fixed and regenerated.

## Paths (`config/paths.json`)

| Key | Used for | Default |
|---|---|---|
| `input_dir` | the `*_DASHBOARD.json` tick files (backtest, `build-data`, research) | `input` |
| `output_dir` | the trades CSV (`--csv`) and run logs (`--out`) | `output` |
| `research_log_dir` | logs written by `research/optimize` | `research/optimize/logs` |

A relative path is resolved against the project folder, an absolute path (for example `/data/disc/input` on a VPS) is used as is, and the output folder is created if missing. A bare `--csv trades.csv` or `--out run.log` lands inside `output_dir`; an absolute file path is kept. To override without editing the file, set `DISC_PATHS_FILE`, `DISC_INPUT_DIR`, `DISC_OUTPUT_DIR` or `DISC_RESEARCH_LOG_DIR`. The web page's generated bundle (`web/generated/`) stays where it is because `web/index.html` loads it by relative URL.
