# HTF Candle Confirmation Visualization — Implementation Plan

> *File paths in this record (`charts/…`) refer to the project layout at the time; the code now lives in `src/`, `scripts/`, `tests/` and `web/` — see the [README](../../README.md).*

> **Historical design record** for the HTF candle-confirmation feature (Pattern A / B, zone shading). Written *before* it was built; kept for the reasoning (look-ahead, partial candles, timestamp mapping). For how things work **now**, read [../htf-pattern.md](../htf-pattern.md) and the [README](../../README.md).

> **Status: IMPLEMENTED.** Delivered as `src/confirmation.js` (pure rules),
> additions to `web/index.html` (toggle, badge, readouts, markers, −2 outline, band
> primitive) and `tests/confirmation.test.js` (259 assertions, all passing).
> Spike §5.4 executed first against the vendored build: primitive attaches, renders at
> bottom z-order *behind* the candles (81/81 candle pixels survived a full-pane fill),
> coordinate conversion and scroll-tracking confirmed, detach clean.
>
> **Terminology (updated):** this feature is **candle-pattern matching and
> visualization only — not BUY/SELL signals.** `Pattern A` is the rule set formerly
> called BUY, `Pattern B` is the rule set formerly called SELL; the comparisons are
> unchanged, only the labels are. States are `Matched`, `Not Matched` and `Unavailable`.

Written against `web/index.html` as it stands today: single-file app, Lightweight
Charts v4.2.0, `Panel` class, `HTF_OF` 5:1 lock, SMA 9 / SMA 44 / RSI 14 /
SMA-14-of-RSI overlays.

---

## 0. Two findings that must be resolved before any code is written

### Finding 1 — "existing LTF signals" do not exist in this project

Section 5 of the request says:

> "When an existing LTF signal has a valid BUY confirmation, mark it as HTF BUY
> confirmed… Keep original LTF signals visible even when confirmation fails."

There is **no signal logic anywhere in the codebase**. `web/index.html` contains only
candle building (`buildCandles`), indicators (`smaNullable`, `rsi`) and rendering
(`Panel`). No entry rule, no exit rule, no strategy object. This was confirmed when the
indicator work was delivered and is recorded in `README.md` §5.3.**RESOLVED by this update:** the feature is **candle-pattern matching and visualization
only** — there is no LTF signal gate and none is needed. The five-candle LTF highlight is
applied to **every matching HTF window**, with no LTF condition filtering it. That adds
zero trading logic, which is exactly what the "do not introduce new trading signals"
constraint requires.

If an LTF signal rule is ever supplied later, it becomes a one-function change
(`passesLtfGate`) that filters which windows are highlighted — nothing else in this plan
moves.

### Finding 2 — the final candle of every timeframe is partial

The session is 22,501 ticks (NIFTY) / 22,502 (SENSEX). Bucket counts divide with a
remainder at every timeframe, so the last bar of *every* timeframe holds one or two
seconds of data (e.g. 5m: 76 bars, the 76th spans `22500…22500`). Section 6.7 requires
these never be treated as completed candles, so the plan excludes them by an explicit
completeness test (§6.7), not by position.

---

## 1. Existing functions and sections that will be reused

All names below are real, current names in `web/index.html`.

| Existing symbol | Location | Reuse in this feature |
|---|---|---|
| `HTF_OF` | config block | **The confirmation timeframe is always `HTF_OF[ltfPanel.tfSec]`** — the confirmation can never use a different HTF than the locked panel, because the LTF panel's own dropdown is the source of truth |
| `getTicks(symbol, date)` | tick data | Untouched. Provides the flat tick arrays plus `day.sessionStart` / `day.sessionEnd` via its `meta` field |
| `buildCandles(ticks, tf)` | tick data | **Reused as-is** to produce the HTF candles. The confirmation must judge exactly the candles the user sees, so it must not have its own bucketing code |
| `smaNullable`, `rsi` | indicators | Untouched — the feature adds no new indicator maths |
| `Panel.render(fit)` | Panel class | The single existing funnel where candles are produced. Confirmation data is attached **after** the existing indicator block, as a separate step that never touches `this.series`, `this.smaSeries`, `this.sma44Series`, `this.rsiSeries`, `this.rsiMaSeries` |
| `Panel.drawLegend(bar)` / `Panel.drawRsiLegend(point)` | Panel class | Pattern reused for the new confirmation readout row; the existing legend bodies are not altered |
| `updateLockChip()` | app state | Pattern reused for the confirmation status badge (same toolbar, same styling idiom) |
| `refresh()`, `fillInstruments()`, `fillDates()`, `renderMeta()` | app state | Untouched behaviour; `refresh()` gains one trailing call |
| `tickCache` | tick data | Pattern copied for `confirmCache` (§9) |
| `linkRange`, `_crossLock`, `subscribeCrosshairMove` wiring | Panel constructor | Untouched. The new overlay adds its own subscriptions, never replaces these |
| `window.__panels` | app state | Already exposed; used by the verification scripts |

---

## 2. How HTF and LTF candles are built today, and how confirmation accesses them

Both panels build candles through the same two functions:

```
Panel.render(fit)
  └─ getTicks(app.symbol, app.date)      → { times: Float64Array, prices: Float64Array, meta }
  └─ buildCandles(ticks, this.tfSec)     → [{ time, open, high, low, close }, …]
        bucket = start + Math.floor((t - start) / tf) * tf      // start = times[0] = 09:15:00 IST
        gaps are forward-filled with a flat candle (O=H=L=C=prevClose)
```

Key properties the confirmation logic depends on:

- **Both panels call `getTicks` with the same arguments**, so `times[0]` — the bucket
  anchor — is identical for the HTF and LTF panels. That is why the 5:1 mapping yields
  exactly 5 LTF candles per HTF candle. Alignment is structural, not accidental.
- **`htfPanel.candles`** holds the HTF candles after `htfPanel.render()` runs, and
  **`ltfPanel.candles`** the LTF ones. The confirmation reads `htfPanel.candles` and
  paints onto `ltfPanel`.
- **Ordering caveat (important):** the linked-timeframe listeners call
  `htfPanel.render(true)` / `ltfPanel.render(true)` **directly**, not through
  `refresh()`. So confirmation must not be computed inside `Panel.render()` (it would
  run half-updated, with one panel stale). It is computed once, in a new
  `applyConfirmation()` invoked from `refresh()` **and** from both TF listeners — see §8.

---

## 3. Where the confirmation logic lives — and why

**Recommendation: a new pure module `src/confirmation.js`**, loaded with a third
`<script>` tag before the app script, exposing one global:

```html
<script src="lib/lightweight-charts.standalone.production.js"></script>
<script src="data.js"></script>
<script src="confirmation.js"></script>   <!-- new, pure, no DOM, no LWC -->
```

Justification:

1. **Testability is a stated requirement (§9).** The rules must be validated against
   fixtures and against a no-look-ahead property test. A pure function in a separate
   file can be `require()`d from Node and tested with the *same code the browser runs*.
   Inline in `index.html` would mean duplicating the logic in a test harness, which is
   exactly how rule implementations drift.
2. **Zero coupling.** The module takes `{ time, open, high, low, close }[]` and returns
   data. It never imports Lightweight Charts, never touches the DOM, never reads
   `window.CHART_DATA`.
3. **No build step, no modules.** A plain classic script (not `type="module"`) keeps
   `file://` operation intact — same as the other two scripts today.

The alternative — inline it in `index.html`'s existing `<script>` — is workable and
means one file fewer, but it forfeits point 1. **Awaiting your preference** (§11, Q3).

---

## 4. The rules, implemented literally

Straight transcriptions. Strict comparisons throughout. Nothing simplified, no rule
inferred from another. The former **BUY** rule set is now **Pattern A**, the former
**SELL** rule set is now **Pattern B** — the comparisons themselves are untouched; only
the names changed.

```js
// c1 = -1 (most recent completed), c2 = -2, c3 = -3, c4 = -4, c5 = -5
const isRed  = (c) => c.close < c.open;
const isGreen= (c) => c.close > c.open;

function evaluate(c1, c2, c3, c4, c5) {
  const patternA =
    c2.high > c1.high &&                                    // 1
    c2.low  > c1.low  &&                                    // 2
    isRed(c2) &&                                            // 3
    isRed(c1) &&                                            // 4
    ( (c2.high > c3.high && c2.high > c4.high && c2.high > c5.high) ||   // 5A
      (c3.high > c4.high && c3.high > c5.high) );                        // 5B

  const patternB =
    c2.high < c1.high &&                                    // 1
    c2.low  < c1.low  &&                                    // 2
    isGreen(c2) &&                                          // 3
    isGreen(c1) &&                                          // 4
    ( (c2.high < c3.high && c2.high < c4.high && c2.high < c5.high) ||   // 5A
      (c3.high < c4.high && c3.high < c5.high) );                        // 5B

  return { patternA, patternB };
}
```

Notes recorded for the approver, **not changes to the rules**:

- `patternA` and `patternB` are mutually exclusive by construction (conditions 1–2 plus
  the colour conditions cannot hold in both directions).
- **Condition 5 Option B does not reference candle −2.** As written, Pattern A can match
  via 5B even when 5A fails for −2. That is what the spec says, so that is what will be
  built. Flagging it only because it is easy to "helpfully" rewrite — it will not be.
- A **flat forward-filled candle** (from a feed gap) has `close === open`, so it is
  neither red nor green: conditions 3 and 4 fail and the state is neither Pattern A nor
  Pattern B. Missing data therefore cannot fabricate a match (§6.6).
- Comparison of a candle to itself is impossible: the indices are always five *distinct*
  candles.

Per-state classification used by the UI:

| State | Meaning |
|---|---|
| `Unavailable` | Fewer than 5 completed HTF candles, or any of the five is missing/partial |
| `Not Matched` | All five present, neither Pattern A nor Pattern B satisfied |
| `Matched` (Pattern A) | `patternA === true` |
| `Matched` (Pattern B) | `patternB === true` |

Plus a per-condition breakdown `{c1,c2,c3,c4,c5:'A'|'B'|false}` for the hover readout,
so "which condition failed" is visible (§5.3).

---

## 5. Mapping a confirmation to candles and timestamps

### 5.1 When a state becomes knowable

An HTF candle anchored at `b` with length `H` covers the tick interval `[b, b + H)` —
its last covered tick is `b + H − 1`. It is complete when that last covered tick is not
past the final tick of the session:

```
completed(i)  ⟺  htfCandles[i].time + htfSec - 1 <= sessionEndTick
```

where `sessionEndTick` is the last tick epoch of the day (`times[times.length - 1]`),
taken from `getTicks(...).meta.sessionEnd`. This single test handles session start
(insufficient history), feed gaps and the partial final candle (§6.7) uniformly.

**The `− 1` is load-bearing, and was proven rather than assumed.** An earlier draft of
this plan used `time + htfSec <= sessionEndTick`, which is off by one: it drops a
candle whose bucket is *fully* covered whenever the session ends exactly one second
before a bucket boundary. Verified against a faithful replica of `buildCandles()`:

| Probe | Span | tf | Bars | `time+tf<=end` excludes | `time+tf-1<=end` excludes | Last bar ticks |
|---|---|---|---|---|---|---|
| Session ends 1s before a boundary | 22500s | 300s | 75 | **1 (wrong — bar is complete)** | 0 | 300 (full) |
| Session ends 1s before a boundary | 22500s | 60s | 375 | **1 (wrong)** | 0 | 60 (full) |
| Session ends 1s before a boundary | 22500s | 12s | 1875 | **1 (wrong)** | 0 | 12 (full) |
| Gap swallows the final 301s | 22501s | 300s | 74 | **1 (wrong)** | 0 | 300 (full) |
| Real data (partial last bar) | 22501s | 300s | 76 | 1 | 1 | 1 (partial) |
| Real data, interior 11s gap | 22501s | 12s | 1876 | 1 | 1 | 1 (partial) |

On the two real files the two formulas happen to agree — NIFTY spans 22,501s and SENSEX
22,502s, and neither is one second short of a bucket boundary at any of the seven
timeframes — so the bug is latent, not active. It is corrected here anyway, because a
second date with a different span would otherwise silently lose a complete candle (and
with it a valid pattern window). Test **T12** locks this down.

The state produced by completed candles `k, k−1, k−2, k−3, k−4` (i.e. −1…−5) is denoted
`S_k`, and it is knowable from `C_k = htfCandles[k].time + htfSec` onward — the instant
candle `k` completes.

### 5.2 Timestamp mapping to LTF bars (by time, never by index)

The highlight for state `S_k` covers **all five LTF candles that closed inside the HTF
candle's own span, ending at its close** — the half-open window `(C_k − htfSec, C_k]`:

```
ltfClose = ltfCandle.time + ltfSec
highlight ltfCandle with S_k  ⟺  C_k - htfSec < ltfClose <= C_k
```

Example: an HTF candle closing at **10:35** (5m) against a 1m LTF highlights the five
LTF candles closing at **10:31, 10:32, 10:33, 10:34 and 10:35** — the whole window, not
just the 10:35 candle. This applies to every matching HTF window and to every supported
timeframe mapping (12s/1m, 36s/3m, 1m/5m, 3m/15m, 5m/25m).

Because both series share the 09:15 anchor and `htfSec = 5 × ltfSec`, that window always
contains exactly five LTF closes: `C_k − 4L, C_k − 3L, C_k − 2L, C_k − L, C_k`. The
mapping is computed by iterating candles and comparing timestamps — no array-index
arithmetic between the two series, per §6.2. Implementation is a two-pointer sweep over
the HTF candle list and the LTF candle list (both ascending and unique), O(n).

This replaces the earlier proposal of a single marker on the first LTF candle of each
window; the requirement is a continuous highlight across all five candles.

### 5.3 What the user sees

**HTF panel**

- The **evaluated candle −2** gets a distinct outline: a 1px box around its full
  high–low range plus a `−2` tick label, so it is clear which candle is being judged
  (mechanism in §6.9 and §8).
- **Pattern A Matched** → blue `◆ A` marker above candle −1, plus a blue badge.
- **Pattern B Matched** → amber `◆ B` marker below candle −1, plus an amber badge.
- **Not Matched** → no marker on the chart; the hover readout shows which condition
  failed.
- **Unavailable** → grey `–` marker (history too short or data missing), so "no match"
  and "cannot evaluate" stay visually distinct.
- Markers sit at candle −1 (the most recent completed candle) because that is the candle
  whose close makes the state knowable; candle −2 is separately outlined as the candle
  being judged. This HTF placement is settled — the *LTF* side is the full-window
  highlight described below.

**LTF panel — five-candle window highlight**

- A **subtle background highlight spans the entire matching LTF candle window** — all
  five candles (10:31 through 10:35 for an HTF close at 10:35), not just the final one.
  Applied to every matching HTF window and to every supported timeframe mapping.
- The highlight is painted **behind** the candles at the lowest draw order, so **candle
  colours, OHLC data, indicators and chart synchronization remain unchanged** — no series
  data is touched to render it. The mechanism is a chart primitive, verified against the
  vendored v4.2.0 build in §5.4 (a plain DOM div behind the canvas does *not* work — it is
  invisible).
- Colour semantics (neutral — this is pattern matching, not direction): Pattern A
  Matched = blue band `rgba(41,98,255,.10)`, Pattern B Matched = amber band
  `rgba(255,152,0,.10)`, `Not Matched` = no band, `Unavailable` = no band. Exact colours
  and opacity are an open decision (§11).
- Band edges align with the five-candle window, from `C_k − htfSec` to `C_k`. Because the
  band is drawn inside the chart's own coordinate system (§5.4), zooming, scrolling,
  fitting and resizing all keep it locked to those candles automatically — no manual
  repositioning and no `timeToCoordinate` bookkeeping.
- **Historical charts** show the band across all five candles once the pattern is
  evaluated. **Live operation** reveals the band only after the relevant HTF candle
  completes (§6.3) — never while it is still forming.

**Readout row** (new line above the HTF price chart, same styling as `.rsi-legend`)

```
HTF CONF · 10:35:00 · C1 ✓ C2 ✓ C3 ✓ C4 ✓ C5A ✗ C5B ✓ → Matched (Pattern A)
```

This satisfies "visually distinguish failed conditions" without overlaying text on the
candles. It updates from the existing `subscribeCrosshairMove` handler pattern (a new
handler, the existing ones are untouched).

**Toolbar badge** (next to the 🔒 chip, same idiom):

```
[HTF CONFIRMATION] checkbox   ·   badge: "HTF: Matched A · 10:35" | "HTF: Not Matched · 10:35" | "HTF: n/a"
```

The badge always reflects the **latest completed** HTF candle's state — the live edge —
while the chart markers and LTF bands show the historical states.

### 5.4 How the band is rendered — verified against the vendored v4.2.0

Requirement: the band must sit **behind** the candles, stay **visible**, and remain glued
to its five candles while the user zooms and scrolls.

**Verified constraint — a DOM element behind the canvas is invisible.** Lightweight Charts
paints an opaque background onto its own canvas (`layout.background` = `#131722`). A
runtime probe on the live page inserted a red `<div>` at `z-index:0` behind the canvases
inside `.chart`; the sampled canvas pixel was byte-identical before and after
(`[19,23,34,255]`). The chart host is `position:relative` with a transparent background,
and the seven chart canvases are absolutely positioned at `z-index:1` and `z-index:2`.
So anything under the canvas is hidden by it, and a DOM element can only appear **above**
the canvases.

**Chosen mechanism — chart primitive (confirmed present in v4.2.0).** The vendored build
exposes `series.attachPrimitive(primitive)`, whose `attached({ chart, series,
requestUpdate })` hook and `paneViews()` / `zOrder()` interface support
`zOrder: 'bottom' | 'normal' | 'top'` (all confirmed by inspecting the bundled source).
The band is drawn as a filled rectangle inside the chart canvas at bottom z-order —
genuinely behind the candle bodies and in the chart's own coordinates. Two consequences:

- **Alignment is automatic.** The renderer is invoked on every redraw with the current
  coordinate system, so zoom, scroll, fit and resize keep the band locked to its five
  candles with no `timeToCoordinate` math and no reposition handlers.
- **Nothing existing changes.** It draws no new series, sets no series data and alters no
  chart option.

One caveat is recorded honestly: the primitive renderer's exact signature differs
slightly between v4.2 and v5, so a short spike at implementation time must confirm it
before the main work starts.

**Fallback** (only if the spike proves the primitive awkward): a translucent
`rgba(41,98,255,.10)` div **above** the canvases with `pointer-events:none`. It is visible
and correctly subtle, touches no series data, and needs repositioning on
`subscribeVisibleTimeRangeChange` and resize via `timeToCoordinate`. Its drawback: it
composites over the chart, so it tints the candles inside the window slightly rather than
sitting behind them.

**Rejected:** making `layout.background` transparent and placing the band behind the
canvas. It would work, but it edits an existing chart option for cosmetic reasons,
conflicting with the "existing chart behaviour unchanged" requirement.

---

## 6. Timing and correctness requirements, one by one

### 6.1 No look-ahead bias

An LTF candle closing at `t` is highlighted by `S_k`, where `C_k` is the smallest HTF
close with `C_k >= t` — the HTF candle whose span contains that LTF close. `S_k` reads
only candles `k … k−4`, all of which completed at or before `C_k`.

Two separate things must not be conflated:

- **Coverage window** — *which* candles the band covers: the five LTF candles closing in
  `(C_k − htfSec, C_k]`. Every one of them is already closed by `C_k`.
- **Reveal time** — *when* the band appears: at `C_k`, and never before.

So the band is never "drawn from `C_k` onward" in the sense of covering later candles —
`C_k` is only the moment it becomes visible, over a window that has already finished. At
every moment the visible state uses nothing newer than the most recently completed HTF
candle: the candles under the band are past candles, and the state painted over them was
knowable at their window's close.

Formally the evaluator receives an explicit `completedUpTo` argument and refuses to
consider any candle with `time + htfSec > completedUpTo`. This is enforced *inside* the
pure function, not by the caller, so a caller mistake cannot introduce look-ahead.



**Proof strategy (§9, tests T4 and T10):** for every LTF bar time `t`, recompute the
state from a dataset truncated to `t` and assert it equals the state the app displays at
`t`; and separately assert that no band is drawn before its HTF candle completes.

### 6.2 Timestamp alignment

No index arithmetic across series. Both panels anchor buckets to `times[0]`
(= 09:15:00 IST) through the same `buildCandles`, so 5:1 holds exactly; the mapping in
§5.2 still works by timestamps alone if that ever changes, and the mapping function takes
both candle arrays as inputs rather than assuming equal spacing.

### 6.3 When a highlight becomes available relative to the LTF candles

`S_k` is knowable only at `C_k`, the moment HTF candle `k` completes — that is the
**reveal time**. The five LTF candles it highlights all **closed at or before** `C_k` —
that is the **coverage window**. The two are deliberately different: a band that appears
now and paints a window that has already finished. No future information is ever used,
because nothing under the band was still forming when the band appeared.

- **Historical charts:** once the session is fully loaded, every window shows its band
  across all five candles.
- **Live operation:** the band for window `k` is revealed at `C_k`, after the relevant
  HTF candle completes — never while that candle is still forming. An in-progress HTF
  candle produces no band at all.

Worked example: with a 1m LTF and a 5m HTF candle closing at 10:35, the band appears at
10:35 and covers the LTF candles closing 10:31–10:35. The first five LTF candles of every
session have no band until the first HTF candle completes.

### 6.4 Historical consistency

`S_k` is a pure function of the five candles behind it, and candle values never change
once their bucket is closed (`buildCandles` is deterministic and forward-fills gaps the
same way every run). Recomputing on zoom, pan, crosshair movement or toggle produces
identical results. States are cached (§9) but the cache key includes symbol, date and
HTF seconds, so it can never serve a stale combination.

### 6.5 Session boundaries

`buildCandles` is called per instrument/date, and its anchor is that day's first tick, so
buckets never span two sessions — there is no code path that could carry a candle across
days. Additionally the evaluator resets its −1…−5 window at the start of each candle
array, so the first four states of every session are `Unavailable` by construction. When
a second date is added to `input/`, each day evaluates independently; nothing bleeds
between them. (Test T6 exercises this.)

### 6.6 Feed gaps and missing history

Three distinct cases, all non-confirming:

| Case | Handling |
|---|---|
| Fully-missed bucket | `buildCandles` forward-fills a **flat** candle (O=H=L=C). Flat ⇒ neither red nor green ⇒ conditions 3/4 fail ⇒ `Not Matched`. It still occupies its slot in the −1…−5 window, so a gap does not silently shift the window onto older candles |
| Partially-missing bucket | Treated as a real candle — it has genuine O/H/L/C from the ticks that did arrive. Marked in the readout as "partial data" via the gap count already shown in the meta bar |
| Fewer than 5 completed candles | `Unavailable`, not `Not Matched` |

The evaluator marks a state `Unavailable` if any of the five candles is absent from the
array (a hole, if bucketing ever produced one) rather than substituting a neighbour.

### 6.7 Partial final candle

Enforced by the completeness test `time + htfSec - 1 <= sessionEndTick` (§5.1, which
carries the proof and the evidence table — the earlier `time + htfSec <= sessionEndTick`
was off by one and is not used). Applied to the two real files this excludes exactly the
last bar at every timeframe: 12s → 1,875 of 1,876 complete, 36s → 625, 1m → 375, 3m →
125, 5m → 75, 15m → 25, 25m → 15. That exclusion count is asserted by **T12**, not
assumed. Consequences, stated up front so the behaviour is expected rather than
surprising:

- The newest bar on the HTF chart is never outlined as "candle −2" and never carries a
  pattern marker while it is the last, incomplete bar.
- At 5m HTF the session yields **75** completed candles (76 drawn), so the live badge
  reflects the state from the 15:25 close.
- A pattern first becomes evaluable after the **first 5 completed HTF candles**, i.e.
  25 minutes into the session at 5m (09:40 IST). Before that the badge reads `n/a`.

### 6.8 Chart synchronization

The feature adds no chart options and changes none. Concretely it does **not** touch:
`CHART_OPTS`, `linkRange`, `_crossLock`, `subscribeVisibleLogicalRangeChange`,
`setCrosshairPosition`, `clearCrosshairPosition`, the fit button, or the 5:1 listeners.
The only new subscription is `subscribeVisibleTimeRangeChange` on the HTF chart, used
solely to reposition the −2 outline box (which is a DOM element, not chart state). Scroll,
zoom, crosshair mirroring and RSI panels are untouched — re-verified by test T8.

### 6.9 Performance

- Confirmation is computed **once per (symbol, date, HTF-seconds)** and cached in
  `confirmCache`, mirroring `tickCache`. Zoom/pan/crosshair/toggle never recompute it.
- HTF markers are applied with one `series.setMarkers(array)` call per panel per data
  change — the same class of operation the charts already do in `render()`. The LTF band
  is a DOM element whose `left`/`width` are set, so drawing five highlighted candles costs
  no more than drawing one.
- The LTF band is drawn by the chart primitive inside the canvas, so it needs no
  repositioning at all (§5.4). Only the −2 outline box (a DOM element) is repositioned,
  inside a single `requestAnimationFrame`-throttled handler, and it is skipped entirely
  when the toggle is off.
- No chart is rebuilt; `createChart` is called exactly twice per panel as today.
- Worst case in the current data is 1,876 LTF bars / 1,876 HTF bars (12s LTF) — the
  two-pointer sweep is linear and runs once.

### 6.10 One eligibility function, shared by the badge, the markers and the bands

The toolbar badge and the on-chart marks must never disagree, so they must not compute
eligibility separately. `src/confirmation.js` exports a single pure entry point:

```
evaluate(htfCandles, { htfSec, sessionEndTick })
  -> Map<closeTime, { state, pattern, conditions, eligibleCandleTime }>
```

Every consumer reads from that one map:

| Consumer | Reads |
|---|---|
| Toolbar badge | the entry whose `closeTime` is the largest `<= now` — i.e. the latest **eligible** candle, which is the same candle the charts use as −1 |
| HTF markers | `state` per completed candle; ineligible candles produce no entry, hence no marker |
| LTF bands | `state` of the `S_k` whose coverage window contains the LTF close |
| Hover readout | the entry for the hovered candle, including the per-condition breakdown |

Three invariants follow, each asserted by **T11**:

1. The badge never reflects a candle that carries no marker — if a candle is too
   incomplete to be outlined as −2, it is too incomplete to drive the badge.
2. No marker and no band is ever emitted for a candle absent from the map.
3. A band's reveal time equals its candle's `closeTime`; the band cannot appear while
   its candle is still forming.

The `sessionEndTick` passed in comes from `getTicks(...).meta` and is identical to the
value `buildCandles` used to form the buckets, so eligibility and bucketing can never
disagree about what the last candle is.

---

## 7. Existing indicators stay untouched

The confirmation step never writes to `this.series`, `this.smaSeries`,
`this.sma44Series`, `this.rsiSeries` or `this.rsiMaSeries`. `setMarkers` on the
candlestick series does not alter candle data, scale, colors or the SMA series, and
markers are cleared by passing `[]`. The five-candle LTF highlight is painted by the
chart primitive at bottom z-order inside the canvas (§5.4) — it changes no candle colour,
no OHLC value and no indicator. RSI panels receive no markers and no bands.

Test T7 proves this: it snapshots every series' data and options before enabling the
toggle, enables it, disables it, and deep-compares — plus compares the same snapshots
with the feature never enabled, to confirm the default page is byte-identical.

---

## 8. Files that would change, and the exact edit points

| File | Change | Why |
|---|---|---|
| `src/confirmation.js` | **New**, ~120 lines | Pure rule evaluation + window mapping. No DOM, no LWC |
| `web/index.html` | **Modified**, additive only | Load the new script; new `applyConfirmation()`; marker/overlay/badge rendering; toggle control; ~60 lines of CSS |
| `tests/confirmation.test.js` | **New**, Node asserts, no framework | Rule fixtures + no-look-ahead property test (§9) |
| `web/generated/data.js`, `scripts/build-data.js`, `README.md`, `input/*` | **Unchanged** | The existing candle data is exactly what the rules need; README is only updated after this feature ships, with separate approval |

Concrete edit points inside `index.html` (line numbers approximate, current file):

1. **`<head>`** — one `<script src="confirmation.js">` after `data.js`; new CSS block for
   `.conf-legend`, `.conf-badge`, `.conf-marker`, `.conf-box` (all prefixed, no existing
   selector touched).
2. **`<header class="toolbar">`** — add the `HTF Confirmation` checkbox and badge span
   after the `#lock` chip. Purely additive DOM.3. **`class Panel`, constructor** — add three members only: an overlay `<div>` inside
   `.chart` (positioned, `pointer-events:none`, stacked above the canvases) holding the
   −2 outline box, an empty `this.confirmMarkers = []`, and a
   `subscribeVisibleTimeRangeChange` handler that repositions that box. On the LTF panel
   only, `this.series.attachPrimitive(bandPrimitive)` registers the band renderer (§5.4).
   No existing member is reassigned and no chart option is altered.
4. **`class Panel`, new methods** — `applyConfirmMarkers(markers)`,
   `setBandWindows(windows)` (LTF panel only — it feeds the primitive's data and touches
   no series) and `drawConfirmLegend(state)`; `drawLegend`/`drawRsiLegend` are not
   modified.
5. **Module-level, after `renderMeta()`** — new `applyConfirmation()`: reads
   `htfPanel.candles` / `ltfPanel.candles`, calls the pure evaluator, distributes
   markers, updates badge and legend.
6. **`refresh()`** — one added trailing line: `applyConfirmation();`
7. **The two TF `change` listeners** — replace the direct `p.render(true)` calls with a
   shared `renderAll()` (`panels.forEach(p => p.render(true)); applyConfirmation();`).
   This is the **only** edit to existing behaviour paths, and with the toggle off the
   output is identical.
8. **New toggle listener** — sets `app.confirmOn`, and either applies the cached markers
   and bands or calls `setMarkers([])` and hides the overlay layer, band and badge. No
   recompute, no `setData`.

---

## 9. Validation plan

Node tests (no framework, plain `assert`), runnable via `node tests/confirmation.test.js`:

| # | Test | Proves |
|---|---|---|
| T1 | Hand-written fixtures: Pattern A via 5A, Pattern A via 5B, Pattern B via 5A, Pattern B via 5B, plus a case where 5A fails and 5B passes | Literal rule transcription |
| T2 | Boundary fixtures: equal highs (`High(-2) === High(-1)`), flat candle in −1 or −2, candle missing, only 4 completed candles | Strict `>` / ` <` and gap handling |
| T3 | Window mapping: synthetic 5:1 series, assert each state's band covers exactly the 5 LTF bars whose closes fall in `(C_k − htfSec, C_k]` — e.g. HTF close 10:35 ⇒ bars closing 10:31–10:35, with no bar outside that window highlighted | §5.2 timestamp mapping and the full five-candle highlight |
| T4 | **No look-ahead property test:** for every bar time `t` in a real session, recompute states from the candle array truncated to `t`; assert equality with the full-data result, and assert no band covers an LTF bar closing after `t` | §6.1, the central correctness claim |
| T5 | Golden run on real NIFTY/SENSEX data: print state transitions with timestamps; I verify a sample by hand against the raw ticks | Real-data sanity |
| T6 | Two concatenated sessions (synthetic): assert highlight windows never cross the day boundary and the first 4 states are `Unavailable` | §6.5 |
| T7 | Toggle-off invariance: snapshot all five series' data + options on both panels; toggle on → off; deep-compare; assert the band element is hidden and no candle colour or OHLC value changed; also compare against a never-toggled page | §7 |
| T8 | Interaction invariance in the browser: crosshair legend, RSI readout, scroll sync, range sync, fit button, both TF dropdowns — exercised before and after enabling/disabling, results compared; additionally assert the band stays aligned to its five candles across zoom, scroll and fit | §6.8, §5.4 |
| T9 | Performance: time `applyConfirmation()` on the 12s/12s pair (largest); assert < 20ms and confirm it runs once per data change, not per interaction | §6.9 |
| T10 | **Live reveal:** simulate an HTF candle still forming; assert no band for its window and no marker on it. Complete the candle and assert the band then appears across exactly the five LTF candles closing in `(C_k − htfSec, C_k]` | §6.3 live-operation rule |
| T11 | **Badge/chart consistency:** assert the badge state equals the state of the latest eligible candle; assert no marker or band exists for any ineligible candle; assert each band's reveal time equals its candle's `closeTime` | §6.10 single-source eligibility |
| T12 | **Completeness predicate battery:** on synthetic sessions (a) ending 1s before a bucket boundary at 12s/60s/300s, (b) with a gap swallowing the final 301s, and (c) with an interior 11s gap — assert `time + htfSec - 1 <= sessionEndTick` keeps every fully-covered candle and drops only partial ones; assert the same exclusion counts on the two real files (1,875 / 625 / 375 / 125 / 75 / 25 / 15) | §5.1 and §6.7 |

Browser checks (manual, via the existing preview tab): marker colours and positions,
badge states at session start (`n/a`) and live edge, legend readout while scrubbing, and
a console-error check after every interaction.

---

## 10. How "no change when disabled" is proven

1. **Structural:** with the toggle off, `applyConfirmation()` short-circuits before any
   chart API call; the only DOM change is hiding elements that were never created
   visibly. No `setData`, no `applyOptions`, no `setMarkers`.
2. **T7** deep-compares every series' data and options against a never-toggled baseline.
3. **T8** compares interaction behaviour before/after an on→off cycle.
4. **T4/T5** are independent of the toggle — they validate the pure module, so a bug in
   the maths cannot silently alter rendering.
5. Review diff: the delivered change touches only additive blocks; the seven edit points
   in §8 are the complete list.

---

## 11. Risks, limitations and open decisions

**Risks / limitations**

| Risk | Mitigation |
|---|---|
| ~~LTF-gate ambiguity~~ **Resolved** | No gate — the band applies to every matching HTF window (§0); a rule can be added later as a one-function change |
| The chart-primitive renderer API differs slightly between LWC v4.2 and v5, so its exact signature needs confirming in a short spike before coding | Spike first; the DOM tint fallback in §5.4 is specified and ready |
| The −2 outline is a DOM element above the canvas, so it can misalign if the chart is resized mid-frame | `requestAnimationFrame`-throttled reposition, hidden when the toggle is off; the band itself needs no repositioning (§5.4) |
| Sparse high timeframes: at 25m HTF the whole session has 15 completed candles, so at most 11 confirmation states exist | Unavoidable given a 6h15m session; documented, badge shows `n/a` early |
| Condition 5B ignoring candle −2 may be unintended in your rules | Implemented literally as specified; flagged here for your review, not changed |
| `setMarkers` replaces the whole marker array | Markers are stored per panel and reapplied in one call, so no incremental-update bugs |
| Multi-date data does not exist yet, so session-boundary behaviour is only testable on synthetic data | T6 covers it; real multi-date proof arrives when you add a second dashboard file |

**Settled by earlier updates**

- **LTF gate** — none. This is candle-pattern matching and visualization only; the
  highlight applies to every matching HTF window (§0).
- **LTF marking** — a subtle background highlight across **all five** candles of the
  matching window (e.g. 10:31 → 10:35 for an HTF close at 10:35). This replaces the
  earlier proposal of a marker on the first LTF candle of each window (§5.2, §5.3).
- **Terminology** — `Pattern A`, `Pattern B`, `Matched`, `Not Matched`, `Unavailable`.
- **Completeness predicate** — `time + htfSec - 1 <= sessionEndTick`; the earlier
  off-by-one formula is not used (§5.1, §6.7, T12).
- **Eligibility** — one pure `evaluate()` result feeds the badge, markers, bands and
  readout, so they cannot disagree (§6.10, T11).

**Decisions confirmed by the user — no open questions remain**

1. **Module layout — separate `src/confirmation.js`.** Pure rule module, no DOM, so
   the identical code the browser runs can be required from Node for tests (§3).
2. **Non-matching candles — no marker for `Not Matched`.** Failed conditions are shown in
   the hover readout instead of grey `–` markers on nearly every candle. Grey markers
   remain only for `Unavailable`, so "cannot evaluate" stays distinct from "evaluated,
   no match" (§5.3).
3. **Appearance — blue for Pattern A, amber for Pattern B, price panel only.** Bands are
   `rgba(41,98,255,.10)` and `rgba(255,152,0,.10)`, drawn behind the candles by the chart
   primitive (§5.4). The RSI sub-panel is untouched.

This plan is therefore implementation-ready, subject only to the chart-primitive
compatibility spike described in §5.4 being run before the main work starts.

**Explicitly out of scope unless you ask:** order execution, alerts, signals, strategy
logic, changes to any indicator formula, colour or period, changes to `data.js` /
`build-data.js`, and README updates.

---

*Implemented and verified. See README.md §7 for the delivered feature and its observed
behaviour, including the one verification gap (hover-driven readout) that could not be
observed in the preview environment.*

*Follow-up: `htf_sma.md` — the optional ATR-normalized SMA slope filter that can now gate
these Pattern A/B matches (config-driven, fail-closed; rules above unchanged).*
