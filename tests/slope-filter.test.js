/**
 * slope-filter.test.js — no framework; run with:  node tests/slope-filter.test.js
 *
 * Covers plan tests T13–T28 (htf_sma.md §9): the ATR-normalized SMA slope filter,
 * its three-mode configuration contract (off / active / fail-closed error), and the
 * no-look-ahead guarantees of the slope.
 *
 * Fixtures keep the BASE pattern and the SLOPE independently controllable: slope is
 * analytic on linear runs — SMA9[k] − SMA9[k−3] = (closes[k−2..k] − closes[k−5..k−3])/9 —
 * so a 15-candle fixture has slope decided entirely by six closes, while the two
 * red/green stepping candles at indices 13/14 decide the base pattern.
 *
 * Like the baseline suite, T23/T27 EXTRACT the real buildCandles() out of
 * web/index.html so wiring and bucketing can never silently drift from the app.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const TC = require('../src/confirmation.js');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; }
  else { fail++; console.error('  FAIL: ' + name); }
}
function eq(got, want, name) {
  ok(JSON.stringify(got) === JSON.stringify(want),
     name + '\n         want ' + JSON.stringify(want) + '\n         got  ' + JSON.stringify(got));
}

const H = 300;                                  // 5m HTF
function c(time, o, h, l, cl) { return { time, open: o, high: h, low: l, close: cl }; }
function end15(a) { return a[a.length - 1].time + H - 1; }
function jstr(m) { return JSON.stringify(Array.from(m)); }

/** Shipped config through the real validator (htf_sma.md §3.1 / Q5). */
function viaConfig(min) {
  return TC.normalizeFilter({ sma_slope_filter: {
    enabled: true, method: 'atr_normalized',
    sma_period: 9, atr_period: 14, lookback_candles: 3, minimum_slope: min,
  } });
}
const ERR = { mode: 'error', filter: null, problems: ['x'] };

/* ------------------------------------------------------------------ */
/* Fixtures — 15 candles each (slopeMinIndex = 14 is the first with    */
/* a slope), base pattern decided at indices 13/14 (= −2/−1).          */

/** Rising run + two red stepping-down candles → base A, slope ≈ +1.61. */
function fixtureAUp() {
  const a = [];
  for (let i = 0; i <= 9; i++) {
    const cl = 100 + 2 * i;
    a.push(c(i * H, cl - 1, cl + 0.5, cl - 1.5, cl));
  }
  a.push(c(10 * H, 119, 120.5, 118.5, 120));
  a.push(c(11 * H, 121, 122.5, 120.5, 122));
  a.push(c(12 * H, 123, 127, 122.5, 126));
  a.push(c(13 * H, 128, 130, 123, 124));    // red, highest high → 5A true
  a.push(c(14 * H, 123.5, 124, 119, 120));  // red, stepped down → base A
  return a;
}

/** Falling run + two green stepping-up candles → base B, slope ≈ −2.52. */
function fixtureBDown() {
  const a = [];
  for (let i = 0; i <= 11; i++) {
    const cl = 300 - 10 * i;
    a.push(c(i * H, cl + 1, cl + 1.5, cl - 0.5, cl));
  }
  a.push(c(12 * H, 181, 181.5, 179.5, 180));
  a.push(c(13 * H, 170, 176, 169, 175));    // green, lowest high of 10..13
  a.push(c(14 * H, 177, 186, 176.5, 185));  // green, stepped up → base B
  return a;
}

/** base A but NEGATIVE slope (spike peak at 13 over a hard decline). */
function fixtureANegative() {
  const a = [];
  for (let i = 0; i <= 9; i++) {
    const cl = 320 - 10 * i;
    a.push(c(i * H, cl + 1, cl + 1.5, cl - 0.5, cl));
  }
  a.push(c(10 * H, 221, 221.5, 219.5, 220));
  a.push(c(11 * H, 211, 211.5, 209.5, 210));
  a.push(c(12 * H, 201, 201.5, 199.5, 200));
  a.push(c(13 * H, 195, 260, 145, 150));    // red, spike peak → 5A true
  a.push(c(14 * H, 148, 155, 95, 100));     // red, stepped down → base A
  return a;
}

/** base B but POSITIVE slope (deep dip at 13 under a strong rise). */
function fixtureBPositive() {
  const a = [];
  for (let i = 0; i <= 11; i++) {
    const cl = 100 + 2 * i;
    a.push(c(i * H, cl - 1, cl + 0.5, cl - 1.5, cl));
  }
  a.push(c(12 * H, 123, 127, 122.5, 126));
  a.push(c(13 * H, 115, 119.5, 114, 119));  // green, lowest high of 10..13
  a.push(c(14 * H, 120, 141, 119.5, 140));  // green, stepped up → base B
  return a;
}

/** 8 candles: base A at k=5 — before slopeMinIndex, so no slope can exist. */
function earlyPattern() {
  const a = [];
  for (let i = 0; i <= 3; i++) a.push(c(i * H, 99, 100 + i, 98, 100)); // highs 100..103
  a.push(c(4 * H, 108, 110, 103, 104));    // red, peak high 110 → 5A (c2 of window)
  a.push(c(5 * H, 103, 104, 98, 99));      // red, stepped down (c1 of window)
  a.push(c(6 * H, 99, 100, 98, 99));
  a.push(c(7 * H, 99, 100, 98, 99));
  return a;
}

const baseA = (cd) => cd.c1 && cd.red2 && cd.red1 && (cd.c5aA || cd.c5bA);
const baseB = (cd) => cd.c2 && cd.green2 && cd.green1 && (cd.c5aB || cd.c5bB);

/* ------------------------------------------------------------------ */
console.log('T13 — Pattern A passes with a sufficiently positive slope');
{
  const v = TC.evaluate(fixtureAUp(), { htfSec: H, sessionEndTick: 15 * H - 1, filter: viaConfig(0.10) })
    .get(15 * H);
  ok(v && v.state === TC.STATE.MATCHED && v.pattern === 'A', 'base A + positive slope matches (state=' +
     (v && v.state) + ', pattern=' + (v && v.pattern) + ')');
  ok(v && v.conditions.slopeA === true && v.conditions.slopeB === false, 'slopeA true / slopeB false recorded');
  ok(v && Number.isFinite(v.conditions.slope) && v.conditions.slope > 0.10,
     'slope above shipped threshold (got ' + (v && v.conditions.slope && v.conditions.slope.toFixed(4)) + ')');
}

/* ------------------------------------------------------------------ */
console.log('T14 — Pattern B passes with a sufficiently negative slope');
{
  const v = TC.evaluate(fixtureBDown(), { htfSec: H, sessionEndTick: 15 * H - 1, filter: viaConfig(0.10) })
    .get(15 * H);
  ok(v && v.state === TC.STATE.MATCHED && v.pattern === 'B', 'base B + negative slope matches (state=' +
     (v && v.state) + ', pattern=' + (v && v.pattern) + ')');
  ok(v && v.conditions.slopeB === true && v.conditions.slopeA === false, 'slopeB true / slopeA false recorded');
  ok(v && Number.isFinite(v.conditions.slope) && v.conditions.slope < -0.10,
     'slope below −threshold (got ' + (v && v.conditions.slope && v.conditions.slope.toFixed(4)) + ')');
}

/* ------------------------------------------------------------------ */
console.log('T15 — wrong slope direction rejects the relevant pattern');
{
  const a = TC.evaluate(fixtureANegative(), { htfSec: H, sessionEndTick: 15 * H - 1, filter: viaConfig(0.10) })
    .get(15 * H);
  ok(a && a.state === TC.STATE.NOT_MATCHED && a.pattern === null, 'A-shape with negative slope → Not Matched');
  ok(a && baseA(a.conditions), 'base A rules were all true (recorded)');
  ok(a && a.conditions.slopeA === false && Number.isFinite(a.conditions.slope),
     'slope recorded, gate false (got ' + (a && a.conditions.slope) + ')');

  const b = TC.evaluate(fixtureBPositive(), { htfSec: H, sessionEndTick: 15 * H - 1, filter: viaConfig(0.10) })
    .get(15 * H);
  ok(b && b.state === TC.STATE.NOT_MATCHED && b.pattern === null, 'B-shape with positive slope → Not Matched');
  ok(b && baseB(b.conditions), 'base B rules were all true (recorded)');
  ok(b && b.conditions.slopeB === false && Number.isFinite(b.conditions.slope), 'slope recorded, gate false');
}

/* ------------------------------------------------------------------ */
console.log('T16 — equality with the threshold never passes (strict)');
{
  const END = 15 * H - 1;
  const run = (fx, min) => TC.evaluate(fx, { htfSec: H, sessionEndTick: END, filter: viaConfig(min) }).get(15 * H);

  // A: derive the real slope, then set the threshold exactly on it
  const sA = run(fixtureAUp(), 0.10).conditions.slope;
  ok(Number.isFinite(sA) && sA > 0.10, 'A fixture slope above shipped threshold (' + sA.toFixed(4) + ')');
  const eqA = run(fixtureAUp(), sA);
  ok(eqA.state === TC.STATE.NOT_MATCHED && eqA.conditions.slopeA === false, 'A: slope === +threshold fails');
  const nearA = run(fixtureAUp(), sA - Math.abs(sA) * 1e-9);
  ok(nearA.state === TC.STATE.MATCHED && nearA.conditions.slopeA === true, 'A: marginally below threshold passes');

  // B: threshold exactly −slope
  const sB = run(fixtureBDown(), 0.10).conditions.slope;
  ok(Number.isFinite(sB) && sB < -0.10, 'B fixture slope below −threshold (' + sB.toFixed(4) + ')');
  const eqB = run(fixtureBDown(), -sB);
  ok(eqB.state === TC.STATE.NOT_MATCHED && eqB.conditions.slopeB === false, 'B: slope === −threshold fails');
  const nearB = run(fixtureBDown(), (-sB) * (1 - 1e-9));
  ok(nearB.state === TC.STATE.MATCHED && nearB.conditions.slopeB === true, 'B: marginally below |threshold| passes');
}

/* ------------------------------------------------------------------ */
console.log('T17 — neutral slopes are rejected when enabled');
{
  const END = 15 * H - 1;
  const run = (fx, min) => TC.evaluate(fx, { htfSec: H, sessionEndTick: END, filter: viaConfig(min) }).get(15 * H);

  const sA = run(fixtureAUp(), 0.10).conditions.slope;
  const nA = run(fixtureAUp(), Math.abs(sA) + 1);          // |slope| < min ⇒ neutral
  ok(nA && nA.state === TC.STATE.NOT_MATCHED && nA.pattern === null, 'A: neutral slope → Not Matched');
  ok(nA && nA.conditions.slopeA === false && nA.conditions.slopeB === false, 'A: both gates false');

  const sB = run(fixtureBDown(), 0.10).conditions.slope;
  const nB = run(fixtureBDown(), Math.abs(sB) + 1);
  ok(nB && nB.state === TC.STATE.NOT_MATCHED && nB.pattern === null, 'B: neutral slope → Not Matched');
  ok(nB && nB.conditions.slopeA === false && nB.conditions.slopeB === false, 'B: both gates false');
}

/* ------------------------------------------------------------------ */
console.log('T18 — changing minimum_slope in config/htf.json changes evaluation');
{
  const cfgPath = path.join(__dirname, '..', 'config', 'htf.json');
  const realCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const n1 = TC.normalizeFilter(realCfg);
  ok(n1.mode === 'active', 'committed config normalizes to active (got ' + n1.mode + ')');
  // minSlope is compared against the file itself: the shipped threshold was retuned
  // 0.10 → 0.25 by explicit decision, and the round-trip guard should track the file
  eq(n1.filter, { smaPeriod: 9, atrPeriod: 14, lookback: 3,
                  minSlope: realCfg.sma_slope_filter.minimum_slope },
     'six shipped values round-trip (Q5)');

  const END = 15 * H - 1;
  const withShip = TC.evaluate(fixtureAUp(), { htfSec: H, sessionEndTick: END, filter: n1 }).get(15 * H);
  ok(withShip.state === TC.STATE.MATCHED,
     'fixture matches at the configured minimum_slope ' + realCfg.sma_slope_filter.minimum_slope);

  const mutated = JSON.parse(JSON.stringify(realCfg));     // in-memory change, file untouched
  mutated.sma_slope_filter.minimum_slope = 3.0;
  const n2 = TC.normalizeFilter(mutated);
  ok(n2.mode === 'active', 'mutated config still valid');
  const raised = TC.evaluate(fixtureAUp(), { htfSec: H, sessionEndTick: END, filter: n2 }).get(15 * H);
  ok(raised.state === TC.STATE.NOT_MATCHED && raised.conditions.slopeA === false,
     'raising minimum_slope to 3.0 rejects the same candle');
}

/* ------------------------------------------------------------------ */
console.log('T19 — disabled filter preserves original pattern results (Q3 carve-out)');
{
  const x = fixtureAUp();
  const opts = { htfSec: H, sessionEndTick: 15 * H - 1 };
  const none = TC.evaluate(x, opts);
  ok(none.size === 15 && Array.from(none.values()).some(v => v.state === TC.STATE.MATCHED),
     'unfiltered fixture yields a Matched state (baseline)');

  const offCfg = TC.normalizeFilter({ sma_slope_filter: { enabled: false } });
  const offGarbage = TC.normalizeFilter({ sma_slope_filter: {
    enabled: false, sma_period: 0, method: 'nope', minimum_slope: -5, lookback_candles: 0 } });
  const absent = TC.normalizeFilter({});
  ok(offCfg.mode === 'off' && offGarbage.mode === 'off' && absent.mode === 'off',
     'disabled / absent section both normalize to off');

  eq(jstr(TC.evaluate(x, Object.assign({}, opts, { filter: offCfg }))), jstr(none),
     'enabled:false output deep-equals no-filter');
  eq(jstr(TC.evaluate(x, Object.assign({}, opts, { filter: offGarbage }))), jstr(none),
     'enabled:false with garbage siblings still equals no-filter (fields inert)');
  eq(jstr(TC.evaluate(x, Object.assign({}, opts, { filter: absent }))), jstr(none),
     'absent section equals no-filter');
  ok(jstr(none).indexOf('"slope') === -1, 'no slope keys when off');
}

/* ------------------------------------------------------------------ */
console.log('T20 — missing SMA/ATR history handled safely');
{
  const r = TC.evaluate(earlyPattern(), { htfSec: H, sessionEndTick: 8 * H - 1, filter: viaConfig(0.10) });
  ok(r.size === 8, '8 entries for 8 complete candles');
  for (const k of [0, 1, 2, 3]) {
    const v = r.get((k + 1) * H);
    ok(v && v.state === TC.STATE.UNAVAILABLE && v.reason === 'insufficient-history',
       'k=' + k + ' stays Unavailable (window history, Q2)');
  }
  const k4 = r.get(5 * H);
  ok(k4 && k4.state !== TC.STATE.UNAVAILABLE, 'k=4 window is evaluable');
  const k5 = r.get(6 * H);
  ok(k5 && k5.state === TC.STATE.NOT_MATCHED && k5.pattern === null, 'k=5 (base A) → Not Matched under filter');
  ok(k5 && k5.conditions.slope === null && k5.conditions.slopeA === null, 'slope null before warm-up');
  ok(k5 && k5.conditions.c5aA === true, 'window really evaluated (5A recorded true)');
  ok(Array.from(r.values()).every(v => v.state !== TC.STATE.MATCHED),
     'nothing can match before slopeMinIndex=14');
}

/* ------------------------------------------------------------------ */
console.log('T21 — zero / non-finite / malformed data handled safely');
{
  // (a) all-flat candles → every TR 0 → ATR 0 → slope null, never matches
  const flat = [];
  for (let i = 0; i < 15; i++) flat.push(c(i * H, 100, 100, 100, 100));
  const rf = TC.evaluate(flat, { htfSec: H, sessionEndTick: 15 * H - 1, filter: viaConfig(0.10) });
  ok(Array.from(rf.values()).every(v => v.state !== TC.STATE.MATCHED), 'ATR 0: never matches');
  const f14 = rf.get(15 * H);
  ok(f14 && f14.conditions && f14.conditions.slope === null, 'ATR 0: slope null (not ±Infinity)');

  // (b) NaN close poisons TR + SMA windows → all slopes null, nothing non-finite stored
  const nan = fixtureAUp();
  nan[10].close = NaN;
  const rn = TC.evaluate(nan, { htfSec: H, sessionEndTick: 15 * H - 1, filter: viaConfig(0.10) });
  ok(Array.from(rn.values()).every(v =>
     !v.conditions || v.conditions.slope === null || Number.isFinite(v.conditions.slope)),
     'no NaN/Infinity in any slope value');
  ok(Array.from(rn.values()).every(v => v.state !== TC.STATE.MATCHED), 'NaN data: never matches');
  const n14 = rn.get(15 * H);
  ok(n14 && n14.conditions.slope === null && n14.conditions.slopeA === null,
     'NaN in seed window: slope null, gate null');

  // (c) malformed candle (high < low) inside the seed window → null, no throw
  const inv = fixtureAUp();
  inv[12].high = 100; inv[12].low = 200;
  const ri = TC.evaluate(inv, { htfSec: H, sessionEndTick: 15 * H - 1, filter: viaConfig(0.10) });
  const i14 = ri.get(15 * H);
  ok(i14 && i14.state === TC.STATE.NOT_MATCHED && i14.conditions.slope === null,
     'inverted candle → slope null, Not Matched, no throw');
}

/* ------------------------------------------------------------------ */
console.log('T22 — three-mode fail-closed battery (Q3)');
{
  const V = () => ({ enabled: true, method: 'atr_normalized',
                     sma_period: 9, atr_period: 14, lookback_candles: 3, minimum_slope: 0.10 });
  const cases = [
    { n: 'missing config.js (undefined)', raw: undefined, want: 'error', has: 'config not generated' },
    { n: 'null config', raw: null, want: 'error', has: 'config not generated' },
    { n: 'non-object config', raw: 'x', want: 'error', has: 'JSON object' },
    { n: 'section absent', raw: {}, want: 'off' },
    { n: 'section null', raw: { sma_slope_filter: null }, want: 'error', has: 'must be an object' },
    { n: 'deliberately disabled', raw: { sma_slope_filter: { enabled: false } }, want: 'off' },
    { n: 'disabled + garbage siblings', raw: { sma_slope_filter: {
        enabled: false, sma_period: 0, method: 'x', minimum_slope: -1 } }, want: 'off' },
    { n: 'enabled "true"', raw: { sma_slope_filter: Object.assign(V(), { enabled: 'true' }) },
      want: 'error', has: 'enabled' },
    { n: 'enabled 1', raw: { sma_slope_filter: Object.assign(V(), { enabled: 1 }) },
      want: 'error', has: 'enabled' },
    { n: 'enabled missing', raw: { sma_slope_filter: (() => { const s = V(); delete s.enabled; return s; })() },
      want: 'error', has: 'enabled' },
    { n: 'bad method', raw: { sma_slope_filter: Object.assign(V(), { method: 'zscore' }) },
      want: 'error', has: 'method' },
    { n: 'sma_period 0', raw: { sma_slope_filter: Object.assign(V(), { sma_period: 0 }) },
      want: 'error', has: 'sma_period' },
    { n: 'sma_period 9.5', raw: { sma_slope_filter: Object.assign(V(), { sma_period: 9.5 }) },
      want: 'error', has: 'sma_period' },
    { n: 'sma_period "9"', raw: { sma_slope_filter: Object.assign(V(), { sma_period: '9' }) },
      want: 'error', has: 'sma_period' },
    { n: 'atr_period -1', raw: { sma_slope_filter: Object.assign(V(), { atr_period: -1 }) },
      want: 'error', has: 'atr_period' },
    { n: 'lookback 0', raw: { sma_slope_filter: Object.assign(V(), { lookback_candles: 0 }) },
      want: 'error', has: 'lookback' },
    { n: 'minimum_slope "0.1"', raw: { sma_slope_filter: Object.assign(V(), { minimum_slope: '0.1' }) },
      want: 'error', has: 'minimum_slope' },
    { n: 'minimum_slope NaN', raw: { sma_slope_filter: Object.assign(V(), { minimum_slope: NaN }) },
      want: 'error', has: 'minimum_slope' },
    { n: 'minimum_slope -0.5', raw: { sma_slope_filter: Object.assign(V(), { minimum_slope: -0.5 }) },
      want: 'error', has: 'minimum_slope' },
    { n: 'valid example', raw: { sma_slope_filter: V() }, want: 'active' },
    { n: 'unknown extra keys tolerated', raw: { other: 1, sma_slope_filter: Object.assign(V(), { future: 7 }) },
      want: 'active' },
  ];
  for (const t of cases) {
    const r = TC.normalizeFilter(t.raw);
    ok(r.mode === t.want, t.n + ': mode ' + t.want + ' (got ' + r.mode +
       (r.problems.length ? '; problems: ' + r.problems.join('; ') : '') + ')');
    if (t.has) ok(r.problems.join('; ').indexOf(t.has) !== -1, t.n + ': problem mentions "' + t.has + '"');
    if (t.want === 'error') ok(r.problems.length > 0 && r.filter === null, t.n + ': problems, no filter');
    if (t.want === 'active') ok(r.filter && r.filter.minSlope === 0.10, t.n + ': filter round-trips');
  }

  // error mode: a candle that WOULD match must not match; Unavailable keeps precedence
  const v = TC.evaluate(fixtureAUp(), { htfSec: H, sessionEndTick: 15 * H - 1, filter: TC.normalizeFilter(undefined) });
  const e14 = v.get(15 * H);
  ok(e14 && e14.state === TC.STATE.NOT_MATCHED && e14.pattern === null && e14.reason === 'config-error',
     'error mode: would-match candle → Not Matched + config-error reason');
  ok(e14 && e14.conditions.slope === null && e14.conditions.slopeA === null && e14.conditions.slopeB === null,
     'error mode: slope fields null');
  ok(e14 && baseA(e14.conditions), 'error mode: base booleans still recorded for the readout');
  ok(v.get(H).state === TC.STATE.UNAVAILABLE && v.get(H).reason === 'insufficient-history',
     'error mode: session-start Unavailable unchanged (Q2)');
  ok(Array.from(v.values()).every(x => x.state !== TC.STATE.MATCHED),
     'error mode: never Matched anywhere (fail closed)');
}

/* ------------------------------------------------------------------ */
console.log('T23 — slope uses the HTF series passed to evaluate, not LTF');
{
  // (a) unit: changing a candle inside the SMA window of k changes the slope
  const before = TC.evaluate(fixtureAUp(), { htfSec: H, sessionEndTick: 15 * H - 1, filter: viaConfig(0.10) })
    .get(15 * H).conditions.slope;
  const mutated = fixtureAUp();
  mutated[3] = c(3 * H, 155, 157, 154, 156);   // index 3 sits in SMA9[11]'s window
  const after = TC.evaluate(mutated, { htfSec: H, sessionEndTick: 15 * H - 1, filter: viaConfig(0.10) })
    .get(15 * H).conditions.slope;
  ok(Number.isFinite(before) && Number.isFinite(after) && before !== after,
     'slope recomputed from the candles handed to evaluate (before ' + before.toFixed(4) +
     ' vs after ' + after.toFixed(4) + ')');

  // (b) wiring: index.html must feed HTF candles and forward the filter
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  ok(/getStates\(htfPanel\.candles,\s*htfSec,\s*sessionEndTick,\s*SLOPE_FILTER\)/.test(src),
     'applyConfirmation calls getStates with htfPanel.candles (HTF) + SLOPE_FILTER');
  ok(!/getStates\(ltfPanel\.candles/.test(src), 'getStates is never called with LTF candles');
  ok(/TC\.evaluate\(\s*htfCandles,\s*\{\s*htfSec,\s*sessionEndTick,\s*filter:\s*filterCfg\s*\}/.test(src),
     'normalized filter forwarded to TC.evaluate');
}

/* ------------------------------------------------------------------ */
console.log('T24 — no look-ahead: completed candles only (active + error)');
{
  const htf = fixtureAUp();
  const END = 15 * H - 1;
  const act = viaConfig(0.10);

  // (a) truncation property, active mode
  const full = TC.evaluate(htf, { htfSec: H, sessionEndTick: END, filter: act });
  let all1 = true, all2 = true;
  for (let t = 0; t <= END; t += 37) {
    const cut = TC.evaluate(htf, { htfSec: H, sessionEndTick: END, completedUpTo: t, filter: act });
    cut.forEach((v, key) => {
      if (v.candleTime + H - 1 > t) all1 = false;
      const f2 = full.get(key);
      if (!f2 || f2.state !== v.state || f2.pattern !== v.pattern ||
          (v.conditions ? v.conditions.slope : null) !== (f2.conditions ? f2.conditions.slope : null)) all2 = false;
    });
  }
  ok(all1, 'no active-filter entry uses a candle not complete at t');
  ok(all2, 'truncated active results equal full-data results on shared keys');

  // (b) slice property: removing all later candles changes nothing at k
  let sliceOk = true;
  for (let k = 4; k < htf.length; k++) {
    const sliced = htf.slice(0, k + 1);
    const r = TC.evaluate(sliced, { htfSec: H, sessionEndTick: end15(sliced), filter: act }).get((k + 1) * H);
    const f2 = full.get((k + 1) * H);
    if (!r || !f2 || r.state !== f2.state || r.pattern !== f2.pattern ||
        (r.conditions ? r.conditions.slope : null) !== (f2.conditions ? f2.conditions.slope : null)) sliceOk = false;
  }
  ok(sliceOk, 'state at k identical when every candle after k is removed');

  // (c) slope at k ignores candles beyond k, even in a longer series
  const long = fixtureAUp();
  long.push(c(15 * H, 131, 133, 130, 132));
  long.push(c(16 * H, 133, 135, 132, 134));
  long.push(c(17 * H, 135, 137, 134, 136));
  const END2 = end15(long);
  const b0 = TC.evaluate(long, { htfSec: H, sessionEndTick: END2, filter: act }).get(15 * H);
  const mutated = long.map(x => Object.assign({}, x));
  mutated[16] = c(16 * H, 900, 950, 890, 940);
  const b1 = TC.evaluate(mutated, { htfSec: H, sessionEndTick: END2, filter: act }).get(15 * H);
  ok(b0 && b1 && b0.conditions.slope === b1.conditions.slope && b0.state === b1.state,
     'slope and state at k=14 unaffected by candles at index 16');

  // (d) error mode: truncation still clean, never Matched
  let errOk = true;
  for (let t = 0; t <= END; t += 61) {
    TC.evaluate(htf, { htfSec: H, sessionEndTick: END, completedUpTo: t, filter: ERR })
      .forEach(v => { if (v.candleTime + H - 1 > t || v.state === TC.STATE.MATCHED) errOk = false; });
  }
  ok(errOk, 'error mode: no look-ahead entry, never Matched');
}

/* ------------------------------------------------------------------ */
console.log('T25 — mode off is byte-identical; baseline suite runs separately');
{
  const x = fixtureAUp();
  const opts = { htfSec: H, sessionEndTick: 15 * H - 1 };
  const none = TC.evaluate(x, opts);
  const explicitOff = TC.evaluate(x, Object.assign({}, opts, {
    filter: { mode: 'off', filter: null, problems: [] } }));
  eq(jstr(explicitOff), jstr(none), 'explicit mode-off == absent filter option');
  const offKey = Array.from(none.values()).find(v => v.state === TC.STATE.UNAVAILABLE);
  ok(offKey && offKey.reason === 'insufficient-history', 'Unavailable reason unchanged when off');
  console.log('  (baseline gate runs separately: node tests/confirmation.test.js → expect 259/0)');
}

/* ------------------------------------------------------------------ */
console.log('T26 — browser checklist (manual, run after index.html wiring)');
{
  // Structural preconditions the Node side can assert:
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  ok(/HTF: Config error/.test(src), 'badge config-error text present in index.html');
  ok(/slopeChip|slope/.test(src) && /drawConfirmLegend/.test(src), 'readout wiring present in index.html');
  console.log('  manual: (1) config enabled:false → UI byte-identical to pre-change');
  console.log('  manual: (2) enabled:true → only removals + slope chips; all five TF pairs; SENSEX');
  console.log('  manual: (3) scratch-invalid config via build-config.js arg → badge "HTF: Config error",');
  console.log('           readout shows problem, no match markers; restore real config afterwards');
  console.log('  manual: (4) toggle off hides everything incl. error; console clean; zero setData');
}

/* ------------------------------------------------------------------ */
console.log('T27 + T28 — real data: monotonicity, counts, warm-up (NIFTY/SENSEX)');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const m = src.match(/function buildCandles\(ticks, tf\) \{[\s\S]*?\n\}/);
  ok(!!m, 'buildCandles() extracted from web/index.html');
  if (!m) { console.error('  cannot continue without the real buildCandles'); process.exit(1); }
  // eslint-disable-next-line no-new-func
  const buildCandles = new Function('return (' + m[0] + ')')();

  const realCfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'htf.json'), 'utf8'));
  const norm = TC.normalizeFilter(realCfg);
  ok(norm.mode === 'active', 'real config active for real-data runs');
  const min = norm.filter.minSlope;

  const slopeMinIdx = Math.max(norm.filter.smaPeriod - 1 + norm.filter.lookback, norm.filter.atrPeriod);
  ok(slopeMinIdx === 14, 'shipped warm-up: slopeMinIndex = 14');

  const idxOf = new Map();
  let grandOk = true, grandSubset = true;

  for (const [file, key] of [['NIFTY_2026-10-23_DASHBOARD.json', 'nifty_seconds'],
                             ['SENSEX_2026-10-23_DASHBOARD.json', 'sensex_seconds']]) {
    if (!fs.existsSync(path.join(__dirname, '..', 'input', file))) { console.log('  note: input/' + file + ' is not present \u2014 skipped'); continue; }
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'input', file), 'utf8'));
    const pk = d.asset.toLowerCase();
    const t = { times: d[key].map(r => r.timestamp_epoch), prices: d[key].map(r => r[pk]) };
    const end = t.times[t.times.length - 1];

    for (const tf of [60, 180, 300, 900, 1500]) {
      const candles = buildCandles(t, tf);
      idxOf.clear();
      candles.forEach((cc, i) => idxOf.set(cc.time, i));
      const off = TC.evaluate(candles, { htfSec: tf, sessionEndTick: end });
      const on = TC.evaluate(candles, { htfSec: tf, sessionEndTick: end, filter: norm });

      ok(off.size === on.size, d.asset + ' ' + tf + 's: identical entry set (' + off.size + ')');

      let offM = 0, onM = 0, removed = 0, matchable = 0;
      on.forEach((v, k) => {
        const o = off.get(k);
        if (!o) { grandSubset = false; return; }
        const idx = idxOf.get(k - tf);
        if (idx != null && idx >= slopeMinIdx) matchable++;
        if (o.state === TC.STATE.MATCHED) offM++;
        if (v.state === TC.STATE.MATCHED) {
          onM++;
          if (o.state !== TC.STATE.MATCHED) grandSubset = false;
          if (idx != null && idx < slopeMinIdx) grandOk = false;     // T28 warm-up
        } else if (o.state === TC.STATE.MATCHED) {
          removed++;
          const cd = v.conditions;
          if (!cd || !baseA(cd) && !baseB(cd)) grandSubset = false;  // base rules held
          const gateFailed = cd && (cd.slope === null ||
            (o.pattern === 'A' ? !(cd.slope > min) : !(cd.slope < -min)));
          if (!gateFailed) grandSubset = false;
        }
      });

      console.log('  ' + d.asset + ' ' + String(tf).padEnd(4) + 's: unfiltered ' + offM +
                  ' → filtered ' + onM + ' (removed ' + removed + ', matchable ≥14: ' + matchable + ')');

      if (tf === 1500) {
        const survivors = [];
        on.forEach((v, k) => {
          if (v.state === TC.STATE.MATCHED) survivors.push('index ' + idxOf.get(k - tf) + ' (' + v.pattern + ')');
        });
        ok(matchable === 1, d.asset + ' 25m: exactly 1 matchable candle (index ≥ 14), got ' + matchable);
        console.log('    25m survivors: ' + (survivors.length ? survivors.join(', ') : 'none') +
                    ' — session has 15 complete bars, only index 14 is matchable (§4.2/E4)');
      }
    }
  }
  ok(grandSubset, 'T27: enabled match set ⊆ unfiltered match set, every removal gate-failed');
  ok(grandOk, 'T28: no Matched state before slopeMinIndex=14');
}

/* ------------------------------------------------------------------ */
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
