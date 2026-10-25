# HTF SMA 9 ATR-Normalized Slope Filter — Implementation Plan

> *File paths in this record (`charts/…`) refer to the project layout at the time; the code now lives in `src/`, `scripts/`, `tests/` and `web/` — see the [README](../../README.md).*

> **Historical design record** — Part I: ATR-normalized SMA slope filter; Part II: SMA-of-RSI filter (both implemented). Written *before* the code, with its decision log and test plans; some statements describe the plan, not the final state. For how things work **now**, read [../htf-pattern.md](../htf-pattern.md).

> **Status: IMPLEMENTED and verified** (approval given; revision 2 as approved). All
> steps of §11 completed: config + generator, module, T13–T28 suite (139/0), baseline
> gate (259/0), index.html wiring, browser verification T26, README §1/§2/§6/§9/§10.
> Unresolved items O1–O4 were resolved by the proposed defaults (O4: shipped as-is).
>
> **Shipped-config update (2026-10-24, user decision):** `minimum_slope` retuned
> **0.10 → 0.25** (config/htf.json, regenerated); the two tests that pin shipped values
> now compare against the file itself. Q5 below records the originally approved default.
>
> **Part II (bottom of this file): HTF SMA-of-RSI filter — IMPLEMENTED and verified**
> (approved with answers to Q-P1…Q-P5, incorporated as decided). Delivered: config
> section + regenerated bundle (sourceSha `47913ff9bf351c2e`), validator + gate,
> T29–T40 suite (133/0), regression gates untouched (259/0 + 139/0), index.html wiring
> and browser verification (all five TF pairs, NIFTY/SENSEX, fail-closed scratch-config
> path, toggle), README §1/§2/§6/§9/§10.
>
> **Legend** — ✅ Fact confirmed by source inspection · ✅(Qn) Decision incorporated from
> review round 1 · 💡 Recommendation · ⚠️ Assumption · ❓ Remaining open question

### Decision log (review round 1)

| # | Question | Decision |
|---|---|---|
| Q1 | Config loading | **Option A** — `config/htf.json` is the single editable source of truth; `scripts/build-config.js` generates `web/generated/config.js` to preserve the `file://` workflow; the generator **must be run after every configuration change** |
| Q2 | Slope neutral/unavailable while the pattern window is evaluable | **`Not Matched`**, with the slope shown as unavailable in the condition readout; `Unavailable` remains reserved for insufficient pattern-window history |
| Q3 | Invalid configuration | **Fail closed** when the filter section is present and invalid: display a clear configuration error, never silently fall back to unfiltered matches; a *deliberately disabled* filter (`enabled: false`) still preserves original behavior |
| Q4 | ATR convention | **Wilder's RMA**, seeded with the simple mean of the first 14 valid true-range values; indexing convention documented |
| Q5 | Shipped defaults | `enabled: true`, SMA period 9, ATR period 14, lookback **3 completed HTF candles**, minimum normalized slope 0.10; existing chart SMA utilities **unchanged** |

Unchanged constraints from the original task: Pattern A/B rules untouched, slope uses
only completed HTF candles, existing HTF↔LTF mapping and visualization behavior
preserved.

---

## 1. Objective and scope

Add an **optional** ATR-normalized SMA 9 slope gate in front of the existing HTF
Pattern A / Pattern B matching rules, controlled by configuration in `config/htf.json`.

**In scope:** the filter rule, its configuration (load, validate, fail-closed error
state), its readout display, tests, docs.

**Out of scope (unchanged):** the five-candle pattern rules themselves, Condition 5B
semantics, marker/band styling, chart sync, existing indicators (SMA 9/44, RSI 14,
SMA-of-RSI — explicitly kept unchanged per Q5), data generation (`build-data.js` /
`data.js`), buy/sell or trading logic of any kind.

---

## 2. Existing architecture (as inspected)

### 2.1 Repository layout ✅

```
CandleImplementionplan.md      ← docs live at repo root (precedent for this file)
README.md
charts/
  index.html                   1,102 lines — layout, styles, chart logic, indicators
  confirmation.js              pure rule module (UMD), loaded by page AND required by tests
  data.js                      generated bundle (window.CHART_DATA) — do not hand-edit
  build-data.js                input/*_DASHBOARD.json → data.js
  lib/lightweight-charts.standalone.production.js   vendored v4.2.0
  tests/confirmation.test.js   332 lines, no framework, 259 assertions
input/                         raw NIFTY / SENSEX dashboard JSON (single date each)
config/                        ❌ DOES NOT EXIST (created during implementation, not before)
```

No `package.json`, no test runner, no linter, no build tooling. Tests run as
`node tests/<file>.js`. ✅

### 2.2 The page (`web/index.html`) ✅

- Script order: `lib/…` → `data.js` → `confirmation.js` → one inline app script
  ([index.html:7-9](../../web/index.html#L7-L9)). `web/generated/config.js` will be inserted
  after `data.js` (§7).
- "Configuration" today = inline constants in the app script
  ([index.html:299](../../web/index.html#L299) `/* config */`): `TF_LABELS` (L303),
  `LTF_OPTIONS`, `HTF_OF`, `HTF_OPTIONS`, `DEFAULTS` (L311), `TZ`, `DATA` (L313),
  `TC = window.TickConfirm` (L314). **These stay where they are** (§3.2).
- `getTicks(symbol, date)` (L347) → `{ times, prices, meta }`; `meta.sessionEnd` is the
  last tick epoch of the session.
- `buildCandles(ticks, tf)` (L373) → OHLC array; buckets anchored at `times[0]`,
  **gaps forward-filled** (flat candles carrying the previous close).
- Indicator utilities: `smaNullable(values, period)` (L405) — arithmetic mean, `null`
  until `period` values exist; `rsi(closes, 14)` (L420) — **Wilder** smoothing, seeded
  with the simple mean of the first 14 changes, first value at index 14 (bar 15).
  **Q5: these plotting utilities are left byte-for-byte unchanged.**
- **No ATR utility exists anywhere in `charts/`** ✅ (grep: `ATR` appears only in
  `README.md` describing RSI's Wilder smoothing and in `input/nifty_nubra_dashboard.py`,
  a raw-data prep script unrelated to the page).
- Confirmation flow: `getStates(htfCandles, htfSec, sessionEndTick)` (L947) caches
  `TC.evaluate(…)` per `symbol|date|htfSec`; `applyConfirmation()` (L960) is the single
  source (§6.10 of the previous plan) feeding badge, `setMarkers` (L1002), the −2
  outline, LTF bands and both readouts. It **never calls `setData`**.
- Readout: `drawConfirmLegend(state, isHtf)` ([index.html:741](../../web/index.html#L741))
  renders the HTF per-condition chips (`A: c1 ✓ c3 ✓ c4 ✓ 5A ✓ 5B ✓` …) as raw HTML
  using existing `.grp/.ok/.bad/.hint/.t/.st` classes.
- UI toggle `confirm-on` sets `app.confirmOn` (L872) and re-runs `applyConfirmation()`;
  it clears visuals only, never series data.

### 2.3 The rule module (`src/confirmation.js`) ✅

- UMD: `module.exports` in Node, `window.TickConfirm` in the browser — the exact code
  the tests run is the code the page runs.
- Exports: `STATE`, `isComplete`, `evaluatePattern`, `evaluate`, `mapToLtf`, `latest`.
- `isComplete(candle, htfSec, availableUpTo)` ⇔ `candle.time + htfSec - 1 <= availableUpTo`
  (the proven off-by-one-correct predicate; tested by T12 against the **real**
  `buildCandles()` extracted from `index.html`).
- `evaluatePattern(c1..c5)` ([confirmation.js:56-67](../../src/confirmation.js#L56-L67)) is
  the literal transcription of the five-candle rules; returns
  `{ patternA, patternB, conditions }`. It has **no access to the candle series** — only
  the five candles — so it *cannot* compute an SMA/ATR slope.
- `evaluate(candles, { htfSec, sessionEndTick, completedUpTo })` walks the series,
  skips incomplete candles, marks `k < 4` or incomplete-window candles `Unavailable`,
  else stores `{ state, pattern, conditions, candleTime, closeTime, c2Time }` keyed by
  `closeTime`.
- `mapToLtf`, `latest`, and every consumer read **only `state`/`pattern`** — any rule
  change made inside `evaluate()` propagates everywhere automatically. ✅

### 2.4 Configuration-loading logic ✅

**Finding: none exists.** `index.html` contains no `fetch()`, no `XMLHttpRequest`, no
`import` — verified by grep. The README states the page "runs entirely in the browser —
no server, no build step, no network access" and that `data.js` is "loaded as a plain
script, so there is no `fetch()` and no CORS problem" ([README.md:262-270](../../README.md#L262-L270)).
The only mechanism the project uses to bring external content into the page is the
**generated plain-script bundle** pattern (`input/*.json` → `build-data.js` → `data.js`).
Q1 adopts that same pattern for configuration.

### 2.5 Tests ✅

`tests/confirmation.test.js`: plain Node script (`ok`/`eq` helpers,
`process.exit(fail ? 1 : 0)`), covers T1, T2, T3, T4, T6, T11, T12 of
`CandleImplementionplan.md` §9. It reads real files (`index.html`, `input/*.json`) with
`fs`. Baseline at planning time: **259 passed, 0 failed**. It stays byte-untouched and
acts as the regression oracle.

---

## 3. Proposed configuration

### 3.1 The file (new: `config/htf.json`) ✅(Q5)

```json
{
  "sma_slope_filter": {
    "enabled": true,
    "method": "atr_normalized",
    "sma_period": 9,
    "atr_period": 14,
    "lookback_candles": 3,
    "minimum_slope": 0.10
  }
}
```

Top-level wrapper object (not a bare section) so future, unrelated sections can be added
without touching this one. This is the **shipped state** after implementation: the
filter is active with these values.

### 3.2 How it merges with existing configuration ✅

- There is **no existing configuration file or loader to preserve** (§2.4) — nothing is
  replaced. The inline constants block in `index.html` (TF maps, `DEFAULTS`, `TZ`) stays
  exactly as-is; it is unrelated page configuration and is not moved into JSON.
- The reader consumes **only** the `sma_slope_filter` key and ignores every other
  top-level key, so unrelated settings can never be clobbered by this feature.
- All six fields are read **from the file**, not from defaults in the evaluator (task
  §2). If the whole `sma_slope_filter` section is absent, the filter is deliberately off
  (equivalent to `enabled: false`).

### 3.3 Loading mechanism — ✅(Q1) Option A, decided

```text
config/htf.json  ──(node scripts/build-config.js)──▶  web/generated/config.js  ──<script>──▶  page
     ▲                                                  (generated, do not edit)
  single editable source of truth
```

- `scripts/build-config.js` (new, ~30 lines, mirrors `build-data.js` conventions): reads
  `config/htf.json`, **fails loudly** (exit 1 with the JSON parse/structure error) on
  malformed input, and writes `web/generated/config.js`:

```js
/* Auto-generated from config/htf.json by build-config.js — do not edit by hand.
   Run `node scripts/build-config.js` after every change to config/htf.json. */
window.HTF_CONFIG = { …verbatim JSON… };
```

- The generator embeds a `sourceSha` (hash of the JSON bytes) and the generation
  timestamp inside `HTF_CONFIG` so a stale artifact is at least identifiable in
  devtools; the generator prints "config.js is up to date" when re-run unchanged.
- **Documented requirement (Q1): the generator must be run after every configuration
  change**, stated in three places — the generated file's header comment, README §9
  (next to the existing `node scripts/build-data.js` instruction), and the plan's
  implementation sequence (§11 step 2).
- Why not `fetch()` (rejected in round 1, restated for the record): Chrome blocks
  `file://` fetch, and the documented primary usage is opening `web/index.html` from
  disk — a JSON config silently ignored would violate "read from the configuration
  file". Option A keeps both the `file://` workflow and JSON as the single source.
- Node tests bypass generation entirely: they read `config/htf.json` directly with
  `require`/`fs`.

### 3.4 Validation, three modes, and fail-closed error display ✅(Q3)

`normalizeFilter(raw)` — a new pure export of `confirmation.js` (so Node tests cover
it). **Contract:** `index.html` passes the *whole* `window.HTF_CONFIG` object (not the
section), so the loader itself can be diagnosed:

```text
normalizeFilter(window.HTF_CONFIG)
  -> { mode: 'off' | 'active' | 'error',
       filter: null | { smaPeriod, atrPeriod, lookback, minSlope },   // set when active
       problems: string[] }                                           // set when error
```

**Mode decision table:**

| Condition | Mode | Behavior |
|---|---|---|
| `raw` is `undefined`/`null` (generator never run / `config.js` missing) | `error` | fail closed + problem `"config not generated — run node scripts/build-config.js"` (derived decision **D4**, see §10) |
| no `sma_slope_filter` key in a present config object | `off` | deliberate absence ⇒ original behavior, unfiltered |
| section present, `enabled === false` (strict boolean) | `off` | **deliberately disabled ⇒ original behavior**; remaining fields are inert and not validated |
| section present, filter would be active (`enabled` is `true`, or `enabled` missing/not a boolean), and **any** field invalid | `error` | **fail closed**: no pattern can match; configuration error is displayed (below) |
| section present, `enabled === true`, all six fields valid | `active` | the gate applies (§5) |

Validation rules (run whenever the filter would be active):

| Field | Valid | Invalid examples |
|---|---|---|
| `enabled` | boolean — `true` activates, `false` deliberately disables | `"true"`, `1`, missing |
| `method` | exactly `"atr_normalized"` | anything else |
| `sma_period` | integer ≥ 2 | `0`, `9.5`, `"9"` |
| `atr_period` | integer ≥ 2 | `-1`, `"14"` |
| `lookback_candles` | integer ≥ 1 | `0` |
| `minimum_slope` | finite number ≥ 0 | `"0.1"`, `NaN`, `-0.5` (would invert A/Q gates) |
| unknown extra keys | ignored (forward-compatible) | — |

**Fail-closed consequences (Q3):** in `error` mode the evaluator never emits `Matched`
— a broken config must not silently behave as *no* filter. The error is **displayed**,
not just logged:

- **Toolbar badge:** `HTF: Config error` (reusing the existing `conf-badge` classes —
  no new CSS required; a dedicated warning style is optional polish).
- **HTF readout:** hint shows the first problem verbatim, e.g.
  `config: minimum_slope must be a finite number ≥ 0`.
- **Console:** one `console.warn` listing every problem with the config source path.
- The display appears only while the `HTF Confirmation` toggle is on (the toggle still
  means "show confirmation UI", §6), and disappears when configuration is valid.

Exact wording is a final-at-implementation detail unless you want to fix it now (§10,
remaining item O1).

---

## 4. Exact slope formula and threshold behavior ✅(Q4)/✅

### 4.1 Definition

For the HTF candle at index `k` in the array passed to `evaluate()` (the candle being
judged — `c1`, whose `closeTime` keys the state):

```text
slope[k] = ( SMA(sma_period)[k] − SMA(sma_period)[k − lookback_candles] ) / ATR(atr_period)[k]
```

- **SMA**: arithmetic mean of the last `sma_period` closes at index `k` — the same
  definition as `smaNullable` (README §5.3). Valid for `k ≥ sma_period − 1`.
- **ATR — ✅(Q4) Wilder's RMA**, seeded with the simple mean of the first **14 valid
  true-range values**. Indexing convention (documented as required):

| Quantity | Index | Value |
|---|---|---|
| `TR[0]` | 0 | **not valid** — no previous close exists |
| `TR[i]`, `i ≥ 1` | 1… | `max(high[i]−low[i], \|high[i]−close[i−1]\|, \|low[i]−close[i-1]\|)` — a TR is *valid* when it has a previous close and is finite |
| `ATR[i]`, `i < atr_period` | 0…13 | `null` (warming up) |
| `ATR[atr_period]` | 14 | `mean(TR[1..14])` — **seed = simple mean of the first 14 valid TRs** |
| `ATR[i]`, `i > atr_period` | 15… | `ATR[i] = (ATR[i−1] × (p−1) + TR[i]) / p` — Wilder recursion |

  If any seed-window TR or any later `TR[i]` is non-finite, or `ATR[i−1]` is `null`,
  then `ATR[i]` is `null` (a null never propagates into a number, and a null ATR never
  yields a valid slope — task §3). Real data is always finite, so this only governs
  malformed fixtures (T21).
- Both series come from **the same HTF candle array** being evaluated — the exact array
  `evaluate()` already received (in the app: `htfPanel.candles`, `getStates` at L947).
  The filter never sees LTF candles by construction (the module has no access to them).

### 4.2 Indexing, warm-up, and completed candles ✅

```text
slopeMinIndex = max( sma_period − 1 + lookback_candles , atr_period )
```

With the shipped config (Q5): `max(9−1+3, 14) = max(11, 14) = 14` → the slope first
exists at index 14 (the **15th** candle) — symmetric with RSI's first value at bar 15.

**Completed candles only (Q5, task §3):**

- **Lookback counts completed HTF candles.** `lookback_candles = 3` means the older SMA
  is taken at index `k − 3`, three completed candles behind `k`.
- Completeness is **monotone** inside one `evaluate()` call: candle `j < k` has
  `time[j] < time[k]`, so `time[j] + htfSec − 1 < time[k] + htfSec − 1`; if `k` passes
  `isComplete(…)` (which is checked before any evaluation), every index the slope reads
  (`k−3`, `k−11 … k`) is a completed candle. The same holds under live-mode
  `completedUpTo`, because it enters `isComplete` through the same `min(sessionEnd,
  availableUpTo)` term.
- The slope is never computed for an incomplete candle *state* — such candles produce
  no entry at all (existing behavior, unchanged).
- No look-ahead: `slope[k]` reads only indices `≤ k`; precomputing SMA/ATR arrays over
  the full series therefore cannot leak future data into any emitted state. Proven
  empirically by T24 (truncation + slice property).

Consequences per timeframe (complete candles on current data ✅):

| HTF | complete bars | matchable with filter on (index ≥ 14) |
|---|---|---|
| 60s | 375 | 361 |
| 180s | 125 | 111 |
| 300s | 75 | 61 |
| 900s | 25 | 11 |
| 1500s (25m) | 15 | **1** |

**25-minute consequences (explicit, per review request):**

- The pattern rules alone need `k ≥ 4`; the shipped filter raises the first matchable
  candle to `k = 14`. At 25m there are exactly **15** complete bars, so **only the 15th
  bar (index 14) can ever produce a `Matched` state** with the shipped configuration.
- If that single bar fails its base five-candle rules, has a neutral slope, or has a
  wrong-direction slope, the 25m chart shows **zero matches for the entire session** —
  no markers, no bands, badge reading `Not Matched`. On today's data the 25m chart has
  0 Pattern A / 1 Pattern B without the filter; whether that one B survives is an
  empirical question for test **T27** (not asserted here).
- This is expected behavior of the shipped defaults, **not a bug**, and will be
  documented in README §10. It is also **tunable purely via config**: `atr_period` is
  the binding term at 25m — e.g. `atr_period: 7` gives `slopeMinIndex = 11` and 4
  candidate bars; `lookback_candles: 4` would raise the SMA term to 12 (still under 14).
  The code places no lower bound on candidate count beyond the warm-up itself.
- 15m (25 bars → 11 candidates) and shorter timeframes are materially unaffected.

### 4.3 Threshold behavior (strict, as required) ✅ spec

| Slope `s` | Pattern A gate | Pattern B gate |
|---|---|---|
| `s > +minimum_slope` | ✅ pass | ❌ |
| `s = +minimum_slope` exactly | ❌ strict inequality fails | ❌ |
| `−minimum_slope < s < +minimum_slope` (neutral) | ❌ | ❌ |
| `s = −minimum_slope` exactly | ❌ | ❌ strict fails |
| `s < −minimum_slope` | ❌ | ✅ pass |
| `s = null` (missing/invalid history or ATR) | ❌ **never** passes | ❌ **never** passes |
| config `mode: 'error'` (fail closed) | ❌ **never** passes | ❌ **never** passes |

`slope[k] = null` whenever any input is missing or invalid: SMA history absent,
lookback SMA absent, ATR absent, **`ATR ≤ 0`** (all-forward-filled flat stretch → every
TR = 0), or the division produced a non-finite value (guard: `!(atr > 0)` catches 0,
negative and `NaN` in one test; result guarded by `Number.isFinite`).
**A null slope is never treated as a rising or falling slope** (task §3).

---

## 5. Pattern A / B integration logic 💡

### 5.1 What changes, what does not

- `evaluatePattern(c1..c5)` — **byte-for-byte unchanged**. It stays the pure literal
  transcription of the five rules; Condition 5B is not reinterpreted; no refactor of the
  original pattern logic (task §4). ✅ constraint preserved.
- The gate is applied **in `evaluate()` immediately after** `evaluatePattern` returns.
  `evaluate` receives the normalized result of `normalizeFilter` (one object carrying
  `mode`/`filter`/`problems`), so the module owns all three modes and Node tests cover
  every one of them:

```js
// inside evaluate(), after the existing Unavailable handling — sketch
var r = evaluatePattern(c1, c2, c3, c4, c5);

if (mode === 'off') {
  // EXACT current code path — byte-identical output, no new keys
  state   = r.patternA || r.patternB ? STATE.MATCHED : STATE.NOT_MATCHED;
  pattern = r.patternA ? 'A' : (r.patternB ? 'B' : null);
} else if (mode === 'error') {
  // Q3 fail-closed: evaluable window, but config is broken → never match
  state = STATE.NOT_MATCHED;  pattern = null;
  conditions = Object.assign({}, r.conditions,
                             { slope: null, slopeA: null, slopeB: null });
  entry.reason = 'config-error';            // surfaced by the readout/badge (§3.4)
} else { // 'active'
  var s = slope[k];                                  // number | null
  var conditions = Object.assign({}, r.conditions, {
    slope:   s,
    slopeA:  s === null ? null : s >  filter.minSlope,   // strict
    slopeB:  s === null ? null : s < -filter.minSlope,   // strict
  });
  var base = r.patternA ? 'A' : (r.patternB ? 'B' : null);
  pattern = (base === 'A' && conditions.slopeA === true) ||
            (base === 'B' && conditions.slopeB === true) ? base : null;
  state   = pattern ? STATE.MATCHED : STATE.NOT_MATCHED;
}
```

- The `Unavailable` branches (`k < 4`, incomplete window) run **before** this code and
  are untouched: **`Unavailable` stays reserved for insufficient pattern-window
  history** (Q2), regardless of filter mode.
- `slope[k]` comes from two arrays precomputed **once per `evaluate()` call**
  (two O(n) passes, `n ≤ 375`; the result is cached by `getStates` anyway).
- `patternA`/`patternB` mutually exclusive (A needs red −2/−1, B needs green) — the
  gate cannot make both pass.

### 5.2 Rejected slope ⇒ `Not Matched` — ✅(Q2) decided

When the pattern window is evaluable but the enabled filter's slope is **neutral** or
**unavailable**, the state is **`Not Matched`** — never `Unavailable` — and the
condition readout shows the slope as unavailable (`slope –`) or failing (`slope … ✗`).

- `Unavailable` remains exactly what it is today: fewer than five completed candles, or
  an incomplete window (session start / live edge) — pinned by T6/T11/T12, which stay
  unchanged.
- Consequence: a filter-rejected candle simply *loses* the blue/amber marker and band
  the unfiltered view would have drawn; enabling the filter can only **remove**
  visualization, never add grey markers (asserted by T26/T27).
- In `error` mode the same `Not Matched` state carries `reason: 'config-error'` so the
  readout distinguishes "config broken" from "slope neutral" (§3.4).

### 5.3 `conditions` shape

- Filter **off**: no `slope*` keys added → `conditions` byte-identical to today → all
  existing assertions (which read `conditions.c5aA` etc.) keep passing unchanged.
- Filter **active or error**: `conditions.slope: number|null`, `conditions.slopeA:
  boolean|null`, `conditions.slopeB: boolean|null` added for every evaluable
  (`Matched`/`Not Matched`) state — recorded even when the base pattern failed, so the
  hover readout can always explain the slope's contribution; in `error` mode all three
  are `null` and the entry carries `reason: 'config-error'`.

---

## 6. Enable / disable behavior ✅ spec (Q3 refined)

| `config/htf.json` state | Mode | Behavior |
|---|---|---|
| valid, `enabled: true` (shipped) | `active` | Pattern matches only if its original 1–4 ∧ (5A ∨ 5B) **and** its directional slope gate pass. Neutral or unavailable slope ⇒ `Not Matched` (Q2). Original 5-rule booleans still computed and shown in the readout. |
| valid, `enabled: false` | `off` | **Deliberately disabled ⇒ original behavior**, byte-identical output; SMA/ATR are not computed at all, so missing history cannot affect results (remaining fields inert). |
| section absent | `off` | same as deliberate disable |
| present but **invalid** (incl. `enabled` missing or not a boolean) | `error` | **Fail closed (Q3):** no `Matched` ever; badge `HTF: Config error`, readout shows the first problem, console lists all. **Never** silently unfiltered. |
| `config.js` never generated (`HTF_CONFIG` undefined) | `error` | fail closed with `config not generated — run node scripts/build-config.js` (D4) |

Independent of all this, the existing `HTF Confirmation` UI toggle keeps its meaning:
it clears/restores the *visualization* only — including hiding the config-error
display while off.

Cache note: `getStates` keys `symbol|date|htfSec` plus a fingerprint of
`mode + filter + problems` — redundant today (config is constant per page load; a
regeneration requires a reload) but prevents a stale-cache bug if live config reload is
ever added.

---

## 7. Proposed file-by-file changes (smallest set)

| # | File | Exists? | Current responsibility | Proposed change | Why needed | Regression risk |
|---|---|---|---|---|---|---|
| 1 | `config/htf.json` | ❌ new | — | create; content per §3.1 (shipped defaults, Q5) | mandated config source (task §2) | none (new file) |
| 2 | `scripts/build-config.js` | ❌ new | — | generator per §3.3: read JSON → write auto-generated `web/generated/config.js`; exit 1 on malformed JSON; header comment + printed reminder that it must be rerun after config changes; `sourceSha` embed | makes JSON loadable from `file://` (Q1) | none (new file) |
| 3 | `web/generated/config.js` | ❌ new (generated) | — | `window.HTF_CONFIG = …`, header `do not edit; run build-config.js` | the page's plain-script config input | none (new file, loaded before app script) |
| 4 | `src/confirmation.js` | ✅ | pure five-candle rules + evaluator, required by tests | add pure `normalizeFilter` (three modes, exported), private `smaArray`/`atrArray` (Wilder, §4.1)/`slopeSeries`; `evaluate()` gains optional filter-mode handling per §5.1. **`evaluatePattern`, `isComplete`, `mapToLtf`, `latest`, `STATE` untouched** | slope needs the series; only `evaluate` has it; must stay Node-testable; fail-closed must live in the module so tests cover it | **medium** — core evaluator; mitigated by off-path byte-identity (T19/T25) + untouched baseline suite |
| 5 | `web/index.html` | ✅ | whole app | (a) `<script src="config.js"></script>` after `data.js`; (b) one `const SLOPE_FILTER = TC.normalizeFilter(window.HTF_CONFIG)` + single `console.warn` on error mode; (c) `getStates` passes the normalized object and includes its fingerprint in the cache key; (d) `drawConfirmLegend` appends the slope chip when active and the config-problem hint when in error mode; (e) badge text `HTF: Config error` in error mode | wiring, readout, and the Q3 error display | **low** — no series writes; no marker/band/badge-logic changes beyond the error text; readout additions only when not `off` |
| 6 | `tests/slope-filter.test.js` | ❌ new | — | new suite T13–T28 (§9), same no-framework style | keeps the 259-assertion baseline untouched as the regression oracle | none (new file) |
| 7 | `README.md` | ✅ | docs | §1 files table (+4 rows), new "Configuration" subsection under §2 (**"run `node scripts/build-config.js` after every config change"**), §6 filter paragraph + `Not Matched`/config-error wording, §9 regen command, §10 limitations (25m consequence, stale-config risk, fail-closed behavior) | task deliverable | docs only |
| 8 | `CandleImplementionplan.md` | ✅ | prior feature's plan | optional one-line pointer to this plan | cross-reference | docs only |

**No new dependencies. No second configuration source (JSON is the only editable source;
`config.js` is generated, like `data.js`). No unrelated refactoring** — in particular
`smaNullable`/`rsi` and all plotting SMA math in `index.html` are left alone.

### 7.1 SMA helper placement — ✅(Q5) decided: plotting utilities unchanged

`smaNullable` ([index.html:405](../../web/index.html#L405)) is an inline-script function:
not exported by any module, defined *after* `confirmation.js` loads, absent in Node —
the pure module cannot call it without dependency injection that would make tests
exercise different code than the page. Per **Q5**, the existing chart SMA utilities
remain byte-for-byte unchanged; `confirmation.js` therefore gets its own private
`smaArray` (identical semantics: mean of the last `period` closes), and ATR is new
either way. (Round-1 alternative — moving `sma` into the module and re-pointing the
plots at `TC.sma` — is explicitly declined.)

---

## 8. Visualization impact

**Preserved unchanged:** blue `#2962ff` Pattern A / amber `#ff9800` Pattern B marker
colors and shapes; no marker for `Not Matched`; grey circle for `Unavailable`
(still only for window-history problems — Q2); the −2 outline; LTF band windows
`(C_k − htfSec, C_k]` painted behind candles at 10% alpha in the **price panel only**
(RSI sub-panel untouched); completed-candle reveal timing; **the existing HTF↔LTF
mapping (`mapToLtf`) is untouched**; price↔RSI range sync, crosshair mirroring, 5:1
lock; SMA/RSI indicators (Q5); badge wording in normal operation; zero `setData` calls
in any confirmation path.

**Changed — three things, all additive or subtractive, never restyling:**

1. **Rejected matches vanish.** Where the filter blocks a match (neutral/unavailable
   slope, or config error), the blue/amber marker and its LTF band disappear
   (`Not Matched`), and the badge may read `Not Matched` where it previously read
   `Matched A/B`. Nothing is ever *added* visually by a rejection (Q2).
2. **Readout slope chip** (mode `active` only), appended to each existing group using
   existing CSS classes — no new CSS:

```text
A: c1 ✓ c3 ✓ c4 ✓ 5A ✓ 5B ✓  slope +0.142 ✓   B: c1 ✗ …              Matched A
A: c1 ✓ c3 ✓ c4 ✓ 5A ✓ 5B ✓  slope −0.031 ✗   B: …                   Not Matched
A: c1 ✓ c3 ✓ c4 ✓ 5A ✓ 5B ✓  slope –                                  Not Matched
```

   (`✓`/`✗` = that pattern's directional gate; `–` = slope unavailable.)
   The LTF readout row is unchanged (window state only). Mode `off` ⇒ readout
   byte-identical to today.
3. **Configuration error display** (mode `error` only): badge `HTF: Config error`,
   readout hint with the first problem (§3.4). Hidden while the `HTF Confirmation`
   toggle is off.

No buy/sell signals, no alerting, no trading logic.

---

## 9. Test plan

New file **`tests/slope-filter.test.js`** (no-framework style, exit 1 on
failure). Command: `node tests/slope-filter.test.js`, alongside the untouched
baseline `node tests/confirmation.test.js`. Numbers continue the T-series from
`CandleImplementionplan.md` §9. **No tests are run and no results are claimed until
implementation is approved.**

**Fixtures (all synthetic unless noted):**

- `linear(n, d, base, range)` — closes ascending by exactly `d`, `high/low = close ± range`
  ⇒ every `TR` constant ⇒ ATR constant ⇒ `slope = lookback·d / ATR` **analytically
  known** (with `lookback=3`, `range=1`, `TR = max(2, d+1, 1−d)`:
  slope = `3d/2` for `d < 1`). Lets tests place the slope above, below or **exactly on**
  the threshold (boundary test derives the value from a first run, then asserts
  strictness — no float-guessing).
- `patternAWithSlope(rise, redDepth)` / `patternBWithSlope(…)` — a steep rising (resp.
  falling) run for ≥ 15 candles establishing the slope (index ≥ `slopeMinIndex`),
  ending in the standard two red stepping-down (resp. two green stepping-up) candles
  from T1/T3, so the **base pattern and the slope are independently controllable**.
- Existing T1-style 5-candle shapes reused verbatim for base-pattern cases.
- Real data: extracted `buildCandles()` + `input/*.json` (same technique as T12).
- Real config: `require('../../config/htf.json')` read directly from disk.

| ID | Required by task §8 | What it asserts |
|---|---|---|
| T13 | 1 | Pattern A: base rules hold, slope `> +min` → `state=Matched`, `pattern='A'`; `conditions.slopeA===true`, `slopeB===false` |
| T14 | 2 | Pattern B: slope `< −min` → `Matched`/`'B'`; `slopeB===true` |
| T15 | 3 | Wrong direction: A-shape with slope `< −min` → `Not Matched`; B-shape with slope `> +min` → `Not Matched`; base booleans still recorded `true` in `conditions` |
| T16 | 4 | Constructed slope **exactly** `= +min` → A rejected; exactly `= −min` → B rejected; one-ULP above/below passes (strictness) |
| T17 | 5 | Neutral slope (`|s| < min`, both directions) with valid history → both gates false → `Not Matched` (never `Matched`, never crashes), readout slope `null` |
| T18 | 6 | Read real `config/htf.json`; run fixture whose slope lies between old/new thresholds: results with `minimum_slope: 0.10` differ from results with a mutated copy at e.g. `0.50`; also assert the committed file parses and `normalizeFilter` reports `mode:'active'` with the six exact shipped values (Q5) |
| T19 | 7 | `enabled: false` → output **deep-equal** to `evaluate()` called with no filter option at all — *even when sibling fields are garbage* (deliberate disable ignores them, Q3); no `slope*` keys |
| T20 | 8 | Series of `4 ≤ k < slopeMinIndex` candles with a base-matching shape → `Not Matched`, `conditions.slope === null`, no throw; `k < 4` still `Unavailable` (Q2: window history keeps `Unavailable`) |
| T21 | 9 | All-flat candles → ATR 0 → `slope null` → never matches; candle with `close: NaN` → `null`, no `NaN`/`Infinity` ever stored in `conditions`; malformed candle (high < low) → `null`, no throw; seed-window non-finite TR → `ATR null` thereafter (§4.1) |
| T22 | 10 | **Three-mode fail-closed battery (Q3):** `normalizeFilter` table — missing `config.js` input (`undefined`) → `error` + regeneration hint (D4); section absent → `off`; `enabled:false` → `off` (siblings ignored); `enabled:"true"`/`enabled:1`/missing `enabled` → `error`; `method:"zscore"`, `sma_period:0/9.5/"9"`, `atr_period:-1`, `lookback:0`, `minimum_slope:"0.1"/NaN/−0.5` → `error` with expected `problems[]`; valid example → `active`, values round-trip; unknown extra key tolerated. **And** in `error` mode `evaluate()` on a fixture that *would* match under `active` emits `Not Matched` with `reason:'config-error'`, never `Matched`, while `k < 4` still emits `Unavailable` |
| T23 | 11 | (a) Unit: slope changes when a candle at index `≤ k` of the array passed to `evaluate` changes — it is computed from *that* HTF array only, never from LTF data; (b) wiring: T12-style source extraction asserts `getStates` is called with `htfPanel.candles` (HTF), not `ltfPanel.candles`, and that the normalized filter object is forwarded to `TC.evaluate` |
| T24 | 12 | No look-ahead, completed candles only, filter on (`active` and `error`): T4 truncation property (nothing emitted for incomplete candles; truncated result equals full result on shared keys); slice property — state at `k` from `candles.slice(0, k+1)` equals state from the full array; and slope at `k` never depends on any candle at index `> k` (lookback indices are completed whenever `k` is) |
| T25 | 13 | Baseline preservation: re-run the existing T1/T2/T3 core assertions with mode `off` (byte-equal outcomes), **and** as an implementation gate run the untouched `node tests/confirmation.test.js` (must stay at 259 passed / 0 failed) |
| T26 | 14 | Browser checklist (existing preview-tab convention): mode `off` → markers, badge, both readouts, bands, sync, indicators identical to pre-change; mode `active` → **only removals** (a previously-matched candle keeps its marker or loses it, never changes color/position), slope chips render; mode `error` → badge reads `HTF: Config error`, readout shows the problem, no match markers, console carries the warning; toggling `HTF Confirmation` hides/shows it; console clean after every interaction; zero `setData` in any path |

**Additional recommended (beyond the required 14):**

| ID | What it asserts |
|---|---|
| T27 | **Real-data monotonicity + 25m report**: on NIFTY/SENSEX at all five HTF pairs, the match set with the filter enabled is a **subset** of the match set with it disabled; every removed match has base-true ∧ (slope `null` or slope failing its direction); per-TF match counts printed for the README table — **explicitly including how many 25m matches survive (0 vs 1) and at which index** (§4.2) |
| T28 | Warm-up table: at each HTF, first matchable index equals `slopeMinIndex` (14 with shipped config), i.e. no earlier state is `Matched` while active; at 25m exactly one state (index 14) *can* be `Matched` |

**Testing the error display without touching real config:** T26's error-mode step uses
a temporary copy — point `build-config.js` at a scratch JSON (the generator accepts an
optional source path argument), regenerate, verify, then regenerate from the real
`config/htf.json`. The committed config file is never edited by tests.

---

## 10. Risks, edge cases, and remaining open items

### Decisions that close previous risks

Round-1 R4 (Not Matched semantics) and the fail-open debate are **resolved** by Q2/Q3;
the state semantics and malformed-config behavior above are now decided, not
recommended.

### Risks

- **R1 (medium) — evaluator churn.** `evaluate()` is the heart of the existing feature.
  Mitigation: mode `off` path byte-identical (T19/T25), `evaluatePattern` untouched,
  baseline suite unmodified.
- **R2 (low) — readout markup drift.** `drawConfirmLegend` is hand-built HTML.
  Mitigation: mode-`off` output byte-compared in T26; only appended spans otherwise.
- **R3 (medium, process) — stale `web/generated/config.js`.** Editing the JSON without rerunning
  `node scripts/build-config.js` keeps old behavior (the file still loads, so this is a
  *stale* value, not a config error — the one silent case the page cannot detect from
  `file://`). Mitigations (Q1): header comment, README §9, generator prints
  "up to date"/regenerated messages, `sourceSha` embedded for eyeball checks. **Cannot
  be fully eliminated without dropping `file://`** — accepted with Q1.
- **R4 (low) — fail-closed surprises (Q3, intended).** A typo makes *all* matches
  disappear rather than silently showing unfiltered ones — but it is loud: badge
  `HTF: Config error` + readout hint + console, so it fails visibly, per your decision.
- **R5 (low) — ATR on forward-filled data.** Gap candles are flat (TR 0), damping ATR
  and inflating normalized slope. Same data the patterns already see; noted in README,
  not corrected.
- **R6 (low) — module size.** `confirmation.js` grows by `normalizeFilter` + three
  private helpers; kept dependency-free and pure so the test story is unchanged.

### Edge cases

- **E1** sessions shorter than `slopeMinIndex + 1` complete candles → active mode ⇒
  nothing can ever match (evaluable states `Not Matched` with `slope –`). Correct per
  spec; visible in the readout.
- **E2** `minimum_slope: 0` → gates become `slope > 0` / `slope < 0`; exactly-flat slope
  matches neither (strict). Valid config.
- **E3** whole-window flat (deep feed gap) → ATR 0 → `null` → never matches (T21).
- **E4 — 25m (expanded, per review request):** with shipped defaults only index 14 of 15
  complete bars is matchable; the session likely ends with zero 25m markers unless that
  single bar matches with a sufficiently steep slope. Documented in README §10; tune via
  `atr_period` (see §4.2); measured by T27. Not a code defect.
- **E5** `lookback_candles ≥ available bars` → SMA at `k−lookback` null → `null` slope →
  no match, no throw (T20's shape).
- **E6** filter modes interact with nothing else: the `HTF Confirmation` toggle, TF
  switching, instrument/date switching and `confirmCache` behave as today (fingerprint
  added to key).
- **E7** config error + session start: `k < 4` remains `Unavailable` (grey marker as
  today); the config-error display is global (badge/readout), not per-candle, so the
  two signals do not collide.

### Remaining open items (post-decision)

1. **❓O1 — exact config-error wording and styling.** Proposed: badge text
   `HTF: Config error`, readout hint = first problem verbatim, existing badge classes.
   Confirm or leave to implementation taste.
2. **❓O2 — derived decision D4: missing `config.js` ⇒ `error`.** Q3 covers "section
   present and invalid"; a never-generated `config.js` is a *setup* failure, and
   failing closed on it (with the regeneration hint) matches the fail-closed spirit.
   Alternative: treat as `off`. Note the shipped repo will contain a generated
   `config.js` (like `data.js`), so this only triggers on broken setups.
3. **❓O3 — generator ergonomics.** Should `build-config.js` accept an optional source
   path (needed for T26's error-mode browser test without editing real config)?
   Recommended: yes. Should `build-data.js` also invoke it? Recommended: **no** (keeps
   data-generation logic untouched, per the original task).
4. **❓O4 — 25m taste question.** Ship as-is (1 candidate bar at 25m, documented) or
   pick a config that preserves more 25m candidates (e.g. `atr_period: 7` → 4)? The
   defaults you set in Q5 give exactly 1; code supports any tuning via config alone.

No other unresolved issues: Q1–Q5 are decided, and every other round-1 question is
closed by the tables above.

---

## 11. Step-by-step implementation sequence

1. **Gate:** you explicitly approve this revision (no Q1–Q5 answers outstanding; O1–O4
   optional clarifications only).
2. Create `config/htf.json` (§3.1, shipped defaults) and `scripts/build-config.js`
   (§3.3); run it; verify `web/generated/config.js` content, `sourceSha`, and that
   `node -e "require('./config/htf.json')"` parses.
3. `src/confirmation.js`: add `smaArray`, `atrArray` (Wilder per §4.1),
   `slopeSeries` (private), `normalizeFilter` (exported, three modes), and the
   `evaluate()` mode handling (§5.1) — `evaluatePattern` untouched.
4. Write `tests/slope-filter.test.js` (T13–T24, T27–T28); run it until green.
5. Re-run baseline `node tests/confirmation.test.js` → must remain **259 passed /
   0 failed** (T25 gate).
6. `web/index.html`: script tag, `SLOPE_FILTER` init + warn, `getStates` filter
   argument + cache fingerprint, `drawConfirmLegend` slope chip, badge/readout
   config-error display.
7. Browser verification (T26): mode `off` byte-identical UI; mode `active` only
   removals; mode `error` via scratch-JSON regeneration (then restore); all five TF
   pairs; toggle, sync, crosshair, indicators, SENSEX; console clean; zero `setData`.
8. Docs: README (§1, §2 configuration incl. the mandatory regen note, §6, §9, §10 with
   the 25m consequence) + optional pointer in `CandleImplementionplan.md`.
9. Full test run: `node tests/confirmation.test.js && node
   tests/slope-filter.test.js`.
10. Report results honestly, including per-TF match counts (T27) and anything that could
    not be verified.

---

## 12. Approval checkpoint

**🛑 Stop here. Implementation must not begin until this revision is explicitly approved.**

Until then, the following remain untouched: `src/confirmation.js`,
`web/index.html`, test files, all configuration (**no `config/` directory, no
generator, no `web/generated/config.js` has been created**), `build-data.js`/`data.js`, and
every other source file. **The only project change so far is this document, `htf_sma.md`,
at the repository root.**

At approval, please state:

1. **Approved or amendments** — per-file changes of §7 as written, with Q1–Q5 as
   recorded in the decision log.
2. Optional answers to **O1–O4** (§10) — none blocks implementation; defaults are
   proposed and marked.
3. Confirmation that implementation may begin (requesting/reviewing this plan does
   **not** authorize implementation).

---

# Part II — HTF SMA-of-RSI Filter (IMPLEMENTED — approved)

> **Status: IMPLEMENTED and verified.** Part I (above) and Part II are both live.
> Approval covered P1–P11 as written, with Q-P1…Q-P5 answered and incorporated:
> **Q-P1** `period` is the SMA period applied to the RSI series (RSI fixed at 14, so the
> gated value is the plotted SMA 14 of RSI); **Q-P2** an unavailable value fails the
> condition ⇒ `Not Matched` (the `Unavailable` state stays reserved for insufficient
> five-candle history); **Q-P3** thresholds validated in [0, 100] inclusive, an
> invalid-but-enabled section fails closed with a visible section-prefixed error;
> **Q-P4** the condition applies independently to every eligible completed candle at
> the pattern's own index, badge reads the latest eligible completed candle, no future
> or incomplete data; **Q-P5** shipped with `enabled: true`.
>
> Delivered: `config/htf.json` second section + regenerated `web/generated/config.js`
> (sourceSha `47913ff9bf351c2e`); `normalizeSmaRsiFilter` + private `rsiArray` /
> `rsiSmaSeries` + the AND-chained gate inside `evaluate()` (`evaluatePattern`
> byte-for-byte untouched); `tests/sma-rsi-filter.test.js` T29–T40 (133/0);
> index.html init, aggregated `CONFIG_ERROR` display, cache-key extension and the
> `rsi` readout chip; README §1/§2/§6/§9/§10. Regression gates unmodified: 259/0 + 139/0.
>
> Legend as in Part I: ✅ Fact confirmed by source inspection · 💡 Recommendation ·
> ❓ Open question for the approver.

## P1. Objective and scope

Add an **optional second gate** in front of the existing Pattern A / Pattern B rules:
the **SMA `period` (default 14) of the RSI series**, evaluated on the HTF candles, with
per-pattern thresholds from a **separate configuration section** so it can be tuned or
toggled without touching the shipped `sma_slope_filter` section.

**In scope (after approval):** the gate, its config section and validation, its readout
chip, tests, docs. **Out of scope:** any change to the five-candle rules, to the slope
filter's behavior or config, to the RSI/SMA plotting indicators (README §5.3 conventions
stay authoritative), to the data pipeline, or to chart styling/sync.

## P2. Existing architecture relevant to this feature ✅

- **The calculation already exists for plotting.** `rsi(closes, 14)`
  ([index.html:429](../../web/index.html#L429), Wilder smoothing, first value at index 14)
  and `smaNullable(values, period)` ([index.html:414](../../web/index.html#L414)) are
  combined in `Panel.render()` as `const rsiMa14 = smaNullable(rsi14, 14)`
  ([index.html:827](../../web/index.html#L827)) — **each panel already computes SMA 14 of
  RSI over its own candle series**, and the HTF panel's series is exactly the HTF data
  this filter needs. README §5.3 pins both conventions.
- Neither function is reachable from the pure module (inline classic script, defined
  after `confirmation.js`, absent in Node) — so the Q5/§7.1 constraint stands: the
  plotting utilities stay untouched.
- `src/confirmation.js` already contains a private `smaArray` with semantics
  identical to `smaNullable` (added in Part I), plus Wilder `atrArray`. The module
  exports `STATE`, `isComplete`, `evaluatePattern`, `evaluate`, `mapToLtf`, `latest`,
  `normalizeFilter` (three-mode: off / active / fail-closed error).
- `evaluate(candles, { htfSec, sessionEndTick, completedUpTo, filter })` gates matches
  inside its active branch; every consumer (badge, markers, −2 outline, LTF bands, both
  readouts) reads only `state`/`pattern`, so a new gate inside `evaluate()` propagates
  everywhere without touching rendering code (§6.10 single source, T11 invariants).
- The config pipeline shipped in Part I — `config/htf.json` → `node scripts/build-config.js`
  → `web/generated/config.js` → `SLOPE_FILTER = TC.normalizeFilter(window.HTF_CONFIG)` with
  `confirmFilterKey` cache fingerprinting, console warn, badge `HTF: Config error` and
  readout problem display — is generic and will simply carry a second section through.
- Test oracles: `tests/confirmation.test.js` (259/0) and
  `tests/slope-filter.test.js` (139/0), both green at the time of writing.

## P3. Proposed configuration

```json
{
  "sma_rsi_filter": {
    "enabled": true,
    "period": 14,
    "pattern_a_max": 65,
    "pattern_b_min": 35
  }
}
```

**Section independence (requirement):** the shipped `config/htf.json` becomes a
sibling-key object —

```json
{ "sma_slope_filter": { …unchanged, minimum_slope 0.10… }, "sma_rsi_filter": { …as above… } }
```

- New validator `normalizeSmaRsiFilter(raw)` reads **only** `raw.sma_rsi_filter` (own-
  property check) and ignores every other key; the existing `normalizeFilter` likewise
  reads only `sma_slope_filter`. Neither can disturb the other, in either direction —
  asserted by T32.
- All three parameters (`period`, `pattern_a_max`, `pattern_b_min`) plus `enabled` are
  read **from the file only**; nothing is hard-coded in the evaluator (task §2 rule
  carried over from Part I).
- **Mandatory workflow, documented prominently:** after editing `config/htf.json` the
  user must run **`node scripts/build-config.js`** *and* **reload `web/index.html`** —
  the page reads the generated `config.js` once at load, so a regeneration without a
  reload leaves the old values in memory. (Part I documented the regen step; this plan
  adds the explicit reload sentence to README §2 and §9.)
- `scripts/build-config.js` needs **no change**: it passes the whole JSON object through,
  so the new section flows into `config.js` automatically.

**Parameter semantics — ❓Q-P1:** `period` is read as the **SMA period applied to the
RSI series** (the “14” in “SMA 14 of RSI”); the RSI itself remains the project-standard
RSI 14 that the sub-panel already draws. 💡 Recommended — it keeps the gated value
identical to the plotted `rsiMa14`, and a configurable RSI period would silently
separate the filter from the indicator on screen. Alternative (period = RSI length,
SMA fixed at 14) is noted for the approver.

## P4. Formula, thresholds, indexing, warm-up

```text
rsiSma[k] = SMA(period) of rsi(HTF closes, 14), evaluated through index k of the SAME
            HTF candle array evaluate() received (gaps forward-filled, as everywhere)

Pattern A gate:  rsiSma[k] <  pattern_a_max     (strict — equality does NOT pass)
Pattern B gate:  rsiSma[k] >  pattern_b_min     (strict — equality does NOT pass)
```

- Both thresholds are RSI-scale (0–100): A is rejected when the smoothed RSI is at or
  above `pattern_a_max`, B when at or below `pattern_b_min`. The two ranges may overlap
  — harmless because `patternA`/`patternB` are mutually exclusive (A needs red −2/−1,
  B needs green), so each gate only ever applies to its own pattern.
- **Warm-up:** RSI first exists at index `rsi_period − 1 = 13`… precisely: first RSI
  value at index 14 (bar 15, README §5.2); the SMA needs `period` non-null RSI values →
  first `rsiSma` at index `14 + period − 1` = **27 for period 14**. General formula:
  `rsiSmaMinIndex = rsi_period − 1 + period = 13 + period`.
  Below that index the value is `null` and the gate can never pass (❓Q-P2).
- **Matchable-candle consequences with both filters shipped** (complete bars on current
  data ✅; first matchable = `max(slopeMinIndex 14, rsiSmaMinIndex 27) = 27`):

  | HTF | complete bars | matchable (both on) |
  |---|---|---|
  | 60s | 375 | 348 |
  | 180s | 125 | 98 |
  | 300s | 75 | 48 |
  | 900s | 25 | **0** |
  | 1500s | 15 | **0** |

  At 15m/25m the visible outcome does **not change** versus today — Part I's T27
  already shows 0 matches there (slope filter) — but with the slope filter *disabled*,
  this filter alone would still zero both TFs (warm-up 27 > 25/15 bars). Documented for
  README §10; the exact per-TF match deltas for indices 14–26 are an empirical output of
  T38, not asserted here.
- **No look-ahead:** `rsi(k)` is a backward recursion and the SMA is a windowed mean, so
  `rsiSma[k]` depends only on closes `0..k`; candle `k` reaches evaluation only after
  `isComplete` passes, and completeness is monotone (Part I §4.4 argument, now covering
  two indicator series). Proven by truncation + slice tests (T36).
- Strict-equality proofs reuse the Part I T16 trick: derive the real value from a first
  run, set the threshold exactly on it, assert rejection; then nudge and assert pass.

## P5. Pattern A/B integration logic

- `evaluatePattern(c1..c5)` remains **byte-for-byte untouched**; Condition 5B is not
  reinterpreted (Part I constraint carried over).
- The gate is AND-chained inside `evaluate()`'s mode branches:

```js
// sketch — active branch, after the existing slope gate
var rsiVal  = rsiSma[k];                                  // number | null
var cond = Object.assign({}, conditionsSoFar, {
  rsi:  rsiVal,
  rsiA: rsiVal === null ? null : rsiVal <  rsiCfg.pattern_a_max,   // strict
  rsiB: rsiVal === null ? null : rsiVal >  rsiCfg.pattern_b_min,   // strict
});
var pat = basePattern;
if (pat === 'A' && cond.slopeA === false) pat = null;      // existing slope gate
if (pat === 'A' && cond.rsiA !== true)    pat = null;      // new rsi gate
if (pat === 'B' && cond.slopeB === false) pat = null;
if (pat === 'B' && cond.rsiB !== true)    pat = null;
```

  Formally: `Matched ⟺ base pattern ∧ (slope gate if slope active) ∧ (rsi gate if rsi
  active)`; each disabled filter contributes nothing; an `error` mode in **either**
  section fails closed for everything (existing `reason: 'config-error'` path, never
  `Matched`, visible error).
- **Conditions-key rule (what makes byte-identity hold):** a filter's keys (`slope`/
  `slopeA`/`slopeB`, resp. `rsi`/`rsiA`/`rsiB`) appear on an entry **iff that filter's
  mode is not `off`**. With the RSI section absent or disabled, output is byte-identical
  to Part I as shipped — all 139 existing assertions must stay green without edits.
- **“Evaluate on the latest completed HTF candle” — interpretation 💡 (❓Q-P4):** the
  value is computed *per candle* from data knowable at that candle's close; for the
  badge — which reads the latest eligible completed candle (§6.10) — this is exactly
  “the value on the latest completed HTF candle”. Rejected alternative: gating **only**
  the badge while historical markers/bands stay ungated — that would let the badge
  disagree with the chart, violating the T11 single-source invariants.
- `rsiSma` is precomputed once per `evaluate()` call (two O(n) passes, `n ≤ 375`, cached
  by `getStates` anyway), only when the RSI mode is `active`.

## P6. Enable / disable behavior and validation ✅ spec

Per-section mode table (independent for `sma_rsi_filter`, mirroring Part I §3.4):

| Section state | Mode | Behavior |
|---|---|---|
| absent | `off` | deliberate absence ⇒ filter bypassed; slope filter and candle rules untouched |
| present, `enabled === false` (strict boolean) | `off` | **deliberate disable ⇒ bypass entirely**; siblings (`period`, thresholds) inert, not validated |
| present, would be active, **any field invalid** (incl. `enabled` missing / not boolean) | `error` | **fail closed**: never `Matched`; badge `HTF: Config error`; readout shows the first problem; one `console.warn` lists all |
| present, valid, `enabled === true` | `active` | both directional gates apply (strict) |

Validation rules (run whenever the filter would be active) — note: **no `method` key**
in this section (single method; do not invent one):

| Field | Valid | Invalid examples |
|---|---|---|
| `enabled` | boolean `true`/`false` | `"true"`, `1`, missing |
| `period` | integer ≥ 2 | `0`, `14.5`, `"14"` |
| `pattern_a_max` | finite number in [0, 100] (❓Q-P3) | `"65"`, `NaN`, `-5`, `101` |
| `pattern_b_min` | finite number in [0, 100] (❓Q-P3) | `"35"`, `NaN`, `105` |
| unknown extra keys | ignored (forward-compatible) | — |

**Visible error:** problems are prefixed with their section name (`sma_rsi_filter:
period must be an integer >= 2`, `sma_slope_filter: …`) so the existing badge/readout
mechanism names the broken section without new UI; if both sections error, the display
shows the first problem and the console lists all. Error in either section fails closed
globally — there is still exactly one badge and one HTF readout.

## P7. Proposed file-by-file changes (none executed this round)

| # | File | Change | Why | Risk |
|---|---|---|---|---|
| 1 | `config/htf.json` | **add** the `sma_rsi_filter` section (P3); `sma_slope_filter` byte-identical at 0.10 | mandated config source | none (new section) |
| 2 | `src/confirmation.js` | add private `rsiArray(closes, period)` mirroring index.html's `rsi()` **byte-for-byte** (Wilder, seed = mean of first 14 changes, first value idx 14); **reuse the existing private `smaArray`** for the smoothing step; export `normalizeSmaRsiFilter`; `evaluate()` gains optional `opts.rsiFilter` and the P5 gate; error branch triggers on either section's error mode. `evaluatePattern`, `isComplete`, `mapToLtf`, `latest`, `normalizeFilter` **unchanged** | the gate must live where the states are made and be Node-testable; plotting code stays untouched per Q5/§7.1 | **medium** (core evaluator) — mitigated: `rsiFilter` absent ⇒ byte-identical output, both existing suites as oracles |
| 3 | `web/index.html` | `RSI_FILTER = TC.normalizeSmaRsiFilter(window.HTF_CONFIG)` + aggregated warn; `getStates` forwards `rsiFilter`; `confirmFilterKey` extended with the RSI fingerprint; `drawConfirmLegend` appends an `rsi 61.24 ✓/✗/–` chip per pattern group **only in mode `active`**; badge error text unchanged (problems now prefixed) | wiring + readout (P8) | **low** — no series writes; chip is an appended span; mode `off` renders byte-identical |
| 4 | `scripts/build-config.js` | **no change** — passes any top-level section through | whole-object pipeline | none |
| 5 | `tests/sma-rsi-filter.test.js` | **new** suite, tests T29–T40 (P9) | keeps both existing suites untouched as regression oracles | none |
| 6 | `README.md` | §1 (+1 row), §2/§9: add the explicit **“run `node scripts/build-config.js` AND reload `web/index.html`”** sentence, §6 new subsection, §10 warm-up/15m/25m consequence | documentation requirement | docs only |
| 7 | `htf_sma.md` | this Part II | plan of record | docs only |

**No new dependencies, no second configuration source, no unrelated refactoring.**

### P7.1 Where the “reuse” happens (requirement: reuse the existing SMA-of-RSI)

Three concrete forms of reuse, without touching the plotted indicator:

1. **Same series, same conventions** — the gated value is the exact quantity the RSI
   sub-panel already draws (`smaNullable(rsi(closes, 14), 14)`, README §5.3), computed on
   the same HTF candles and aligned to the same bar timestamps.
2. **Same SMA code path** — the smoothing step calls the module's existing private
   `smaArray` (identical semantics to `smaNullable`), added in Part I.
3. **Proven equivalence** — test T34 extracts the *real* `rsi()` and `smaNullable()` out
   of `index.html` (the T12/T27 technique) and asserts the module's arrays are identical
   on real HTF data, so “reuse” is verified, not assumed.

The plotting functions themselves remain byte-for-byte unchanged (approved Part I Q5).

## P8. Visualization impact

**Unchanged:** marker colors/shapes, no-marker-for-`Not Matched`, grey `Unavailable`
still reserved for window history, −2 outline, LTF band windows and their behind-candles
primitive, completed-candle timing, badge wording mechanics, chart sync, all indicators,
zero `setData` in any confirmation path, the existing config-error display.

**Changed — three additive/subtractive items only:**

1. **Further rejections:** matches that pass base + slope but fail the RSI gate lose
   their marker/band exactly like other filter rejections (only ever *removals*).
2. **Readout chip** (mode `active` only, existing CSS classes):
   `A: … slope +0.342 ✓ rsi 61.24 ✓   B: … slope −0.11 ✗ rsi 61.24 ✗` — `–` when the
   value is unavailable; chip absent for mode `off` (byte-identical readout) and in
   `error` mode (the problem hint replaces the breakdown, as today).
3. **Error display trigger:** an invalid `sma_rsi_filter` section lights up the same
   badge/readout error as the slope section, with the prefixed problem text.

No buy/sell signals, no alerting, no trading logic; LTF readout row unchanged.

## P9. Test plan — new file `tests/sma-rsi-filter.test.js` (T29–T40)

No-framework style like the others; both existing suites must pass **unmodified**.
**No tests are run and no results are claimed until approval.**

| ID | Requirement covered | Assertions / fixtures |
|---|---|---|
| T29 | Strict direction gates | Fixture with base A: `rsiSma` derived from a first run, then threshold set *exactly* on it → A rejected; nudge inside → passes. Same for B with `pattern_b_min` |
| T30 | Directionality | A rejected when value ≥ `pattern_a_max`; B rejected when value ≤ `pattern_b_min`; overlap zone (35–65) never lets both patterns match (mutual exclusivity) |
| T31 | `enabled: false` bypass | Deep-equal output for `rsi-disabled` vs `rsi-absent` **with the slope filter still active**; no `rsi*` keys; slope results identical; candle rules preserved |
| T32 | Section independence | Garbage/absent/extra keys in one section never alter the other's `normalize*` result (both directions); shipped file → slope `active` + rsi `active` with exact values |
| T33 | Invalid config fails closed + visible | Mode battery (`enabled "true"/1/missing`, `period 0/9.5/"14"`, `pattern_a_max "65"/NaN/-5/101`, `pattern_b_min "35"/NaN/105`) → `error` + prefixed `problems`; `evaluate` in error never `Matched`, `reason: 'config-error'`, Unavailable precedence intact; source-extraction asserts index.html surfaces badge/readout text |
| T34 | Reuse of the existing SMA-of-RSI | Extract real `rsi()` + `smaNullable()` from `index.html`; run on real HTF closes; assert module `rsiArray` + `smaArray` output **identical element-for-element** (nulls aligned) |
| T35 | Value on the latest completed candle | `TC.latest()` entry's `conditions.rsi` equals recomputed `sma14(rsi(closes,14))[lastCompleteIndex]`; partial final candle never evaluated (no entry, no value) |
| T36 | No look-ahead | Truncation + slice properties (Part I T24 method) with both filters active; `rsiSma[k]` invariant when candles at index `> k` are mutated |
| T37 | Warm-up / missing history | No `Matched` before index `13 + period` (27 at shipped period); `rsi`/`rsiA`/`rsiB` null before that, no throw; `k < 4` still `Unavailable` |
| T38 | Combined behavior on real data | Both-on match set ⊆ slope-only ⊆ off (NIFTY + SENSEX × five HTFs); every additionally-removed match has base ∧ slope true ∧ RSI gate failed; print per-TF counts, indices rejected only by warm-up, and the 900s/1500s zero-match outcome |
| T39 | Regression gates | `node tests/confirmation.test.js` → 259/0 and `node tests/slope-filter.test.js` → 139/0, both **untouched** |
| T40 | Browser checklist (manual) | Chip renders with value; mode `off` ⇒ readout byte-identical; invalid section ⇒ badge `HTF: Config error` + prefixed hint, zero markers; toggle hides it; console clean; zero `setData`; TF lock/sync intact |

## P10. Risks, edge cases, open questions

**Risks** — R-P1 evaluator churn for a second time (mitigated: `rsiFilter` absent ⇒
byte-identical; two untouched suites as oracles); R-P2 mirror drift between module
`rsiArray` and index.html `rsi()` over future edits (mitigated by T34 extraction
proof); R-P3 readout crowding with two chips per group (mitigated: append-only, same
CSS classes, absent when off); R-P4 docs drift on the reload step (called out in three
places: P3, file table, sequence).

**Edge cases** — E-P1 15m/25m: zero matchable candles at period 14 (warm-up 27 > 25/15)
— visible outcome unchanged today (already 0 via slope filter) but it would zero them
with the slope filter off; E-P2 raising `period` to ≥ (bars − 13) darkens whole TFs;
E-P3 thresholds are validated into [0,100], so “A always passes” typos like 101 are
rejected as invalid rather than silently accepted; E-P4 long forward-filled flat runs
push Wilder RSI toward its `al === 0 → 100` branch, which then fails the A gate if
`pattern_a_max < 100` — same data the indicators already see, noted not corrected;
E-P5 both sections invalid ⇒ one error display, first problem prefixed, console lists all.

**Open questions — answered at approval (decisions incorporated):**

1. **✅(Q-P1)** `period` = SMA-of-RSI period with RSI fixed at the project-standard 14 —
   adopted, so the gated value is identical to the plotted `rsiMa14` at `period: 14`
   (proved element-for-element by T34).
2. **✅(Q-P2)** Value unavailable (index < `13 + period`): the gate **fails ⇒ `Not
   Matched`** — adopted, consistent with Part I Q2's “unavailable never matches”.
3. **✅(Q-P3)** Thresholds validated to **[0, 100]** inclusive — adopted; out-of-range
   values (e.g. the 101 typo case) are invalid config, not silent passes.
4. **✅(Q-P4)** Per-candle evaluation at the pattern's own candle index; the badge reads
   the latest eligible completed candle — confirmed as recommended.
5. **✅(Q-P5)** Shipped with `enabled: true` as proposed — confirmed.

## P11. Step-by-step implementation sequence (after approval)

**✅ All nine steps completed 2026-10-24** (two delivery notes: step 3's `opts.rsiFilter`
landed as an independent `rsi` member carried on the `opts.filter` object — same API,
keeps the T23 source anchors byte-stable; step 6's separate `RSI_FILTER` constant landed
as `SLOPE_FILTER.rsi`, attached at init for the same reason).

1. **Gate:** explicit approval of Part II + answers to Q-P1…Q-P5.
2. Add `sma_rsi_filter` to `config/htf.json` (P3) → run `node scripts/build-config.js`
   → verify `config.js` carries both sections + `sourceSha` → **reload the page**.
3. `src/confirmation.js`: private `rsiArray`, `normalizeSmaRsiFilter`, `opts.rsiFilter`
   + gate (P5) — `evaluatePattern` and all Part I exports untouched.
4. Write `tests/sma-rsi-filter.test.js` (T29–T38) → green.
5. Gates: `node tests/slope-filter.test.js` → **139/0** and
   `node tests/confirmation.test.js` → **259/0**, both unmodified (T39).
6. `web/index.html`: `RSI_FILTER` init + aggregated warn, `getStates`/`confirmFilterKey`
   extension, readout chip (P7 #3).
7. Browser verification T40 (all five TF pairs, SENSEX, toggle, error path via scratch
   config, restore, console clean).
8. README: §1/§2/§6/§9 (regen **and reload**)/§10 — renumber nothing.
9. Full run of all three suites; honest report incl. T38's per-TF counts.

## P12. Approval checkpoint

**✅ Approved 2026-10-24 — implementation authorized and completed.** The approval
answered Q-P1…Q-P5 (recorded in the Part II status block above) and confirmed P1–P11 as
written, with no amendments. The checkpoint below is retained as the gate that was
passed:

> **🛑 Stop here. Implementation must not begin until Part II is explicitly approved.**
>
> *(Historical, pre-approval: that round changed only `htf_sma.md` — no `sma_rsi_filter`
> section, validator, gate, chip, test file or README edit; the shipped configuration
> contained only `sma_slope_filter` at sourceSha `889103566c00fa22`. It now contains both
> sections at sourceSha `47913ff9bf351c2e`; Part I and Part II both green: 139/0 + 259/0
> + 133/0.)*
>
> At approval, please state:
>
> 1. **Approved or amendments** for P1–P11 as written.
> 2. Answers to **Q-P1…Q-P5** (P10) — none blocks drafting, but Q-P1 and Q-P2 change code.
> 3. Confirmation that implementation may begin (requesting this plan does **not**
>    authorize implementation).
