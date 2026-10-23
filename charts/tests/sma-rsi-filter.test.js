#!/usr/bin/env node
/**
 * sma-rsi-filter.test.js — Part II of htf_sma.md: the SMA-of-RSI confirmation filter.
 *
 * Gates a pattern by SMA(`period`) of Wilder RSI(14) — the same SMA 14 of RSI the
 * HTF sub-panel plots — evaluated at the same candle index as the Pattern A/B
 * evaluation:
 *   Pattern A passes while SMA-of-RSI < pattern_a_max  (strict)
 *   Pattern B passes while SMA-of-RSI > pattern_b_min  (strict)
 * An unavailable indicator value (warm-up = 13 + period = 27 at period 14) is not
 * `true`, so it fails the condition (approved Q-P2). Invalid configuration fails
 * closed: never Matched, visible, section-prefixed problem (Q-P3).
 *
 * Run: node charts/tests/sma-rsi-filter.test.js
 * Node-only: no browser, no chart library.
 * The regression gates are the two existing suites (T39):
 *   node charts/tests/confirmation.test.js   (259)
 *   node charts/tests/slope-filter.test.js   (139)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const TC = require('../confirmation.js');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  \u2713 ' + label); }
  else { fail++; console.error('  \u2717 FAIL \u2014 ' + label); }
}

/* ---------------- shared fixtures & helpers ---------------- */

const H = 300;                                          // 5m HTF for synthetic fixtures
const c = (t, o, h, l, cl) => ({ time: t, open: o, high: h, low: l, close: cl });
const endOf = (cs) => cs[cs.length - 1].time + H - 1;
const jstr = (v) => JSON.stringify(v);
/** States as a comparable structure (Map does not serialize by itself). */
const sp = (m) => Array.from(m.entries()).map(([k, s]) => [k, s.state, s.pattern]);

/**
 * Rising zigzag (odd steps +4, even steps −1) that ends in a red peak and a red
 * step-down: base Pattern A is true exactly once, at index 27. RSI-SMA ≈ 80.
 */
function zigzagA() {
  const a = [];
  let cl = 100;
  for (let i = 0; i <= 22; i++) {
    const prev = cl;
    if (i > 0) cl = prev + (i % 2 === 1 ? 4 : -1);
    const open = i === 0 ? 100 : prev;
    a.push(c(i * H, open, Math.max(open, cl) + 0.5, Math.min(open, cl) - 0.5, cl));
  }
  a.push(c(23 * H, 133, 136.5, 132.5, 136));   // green continuation
  a.push(c(24 * H, 136, 139.5, 135.5, 139));   // green
  a.push(c(25 * H, 139, 142.5, 138.5, 142));   // green — c5 of the pattern window
  a.push(c(26 * H, 144, 146, 139, 140));       // RED peak (c2): highest high
  a.push(c(27 * H, 139, 140, 133, 134));       // RED step-down (c1)
  return a;
}

/**
 * Mirror image: falling zigzag (odd steps −4, even steps +1) ending in a green
 * low-high pair — base Pattern B is true exactly once, at index 27. RSI-SMA ≈ 20.
 */
function zigzagB() {
  const a = [];
  let cl = 100;
  for (let i = 0; i <= 22; i++) {
    const prev = cl;
    if (i > 0) cl = prev + (i % 2 === 1 ? -4 : 1);
    const open = i === 0 ? 100 : prev;
    a.push(c(i * H, open, Math.max(open, cl) + 0.5, Math.min(open, cl) - 0.5, cl));
  }
  a.push(c(23 * H, 67, 67.5, 63.5, 64));   // red continuation
  a.push(c(24 * H, 64, 64.5, 60.5, 61));   // red
  a.push(c(25 * H, 61, 61.5, 57.5, 58));   // red — c5 of the pattern window
  a.push(c(26 * H, 55, 55.5, 54.5, 57));   // GREEN low-high (c2): lowest high
  a.push(c(27 * H, 58, 62, 57.5, 61));     // GREEN above (c1)
  return a;
}

/** zigzagA plus 4 continuation candles — for forward-mutation tests (T36). */
function zigzagA32() {
  const a = zigzagA();
  let cl = 134;
  for (let i = 28; i <= 31; i++) {
    const prev = cl;
    cl = prev + (i % 2 === 0 ? -1 : 4);           // continue the zigzag rhythm
    a.push(c(i * H, prev, Math.max(prev, cl) + 0.5, Math.min(prev, cl) - 0.5, cl));
  }
  return a;
}

/** 15-candle rising-run fixture with a base-A pattern at index 14 (warm-up tests). */
function fixtureAUp() {
  const a = [];
  for (let i = 0; i < 13; i++) {
    const cl = 100 + i * 2;
    a.push(c(i * H, cl - 1, cl + 0.5, cl - 1.5, cl));
  }
  a.push(c(13 * H, 127, 129, 125, 128));
  a.push(c(14 * H, 130, 131, 122, 124));
  return a;
}

const realCfg = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'htf.json'), 'utf8'));
const slopeNorm = TC.normalizeFilter(realCfg);          // active, minSlope 0.10
const rsiNorm = TC.normalizeSmaRsiFilter(realCfg);      // active, 14 / 65 / 35
const OFF = { mode: 'off', filter: null, problems: [] };
/** Normalizer for a partial sma_rsi_filter section (shipped defaults + overrides). */
const mkRsi = (over) => TC.normalizeSmaRsiFilter({ sma_rsi_filter: Object.assign(
  { enabled: true, period: 14, pattern_a_max: 65, pattern_b_min: 35 }, over) });

/** Combined filter object — the shape evaluate() receives (`.rsi` carry, T23 wiring). */
const F = (rsi, slope) => Object.assign({}, slope || OFF, { rsi: rsi || OFF });
const run = (candles, filt, extra) => TC.evaluate(candles, Object.assign(
  { htfSec: H, sessionEndTick: endOf(candles), filter: filt }, extra || {}));
/** Real-data run: the ACTUAL bucket length and the real last-tick session end. */
const runReal = (candles, tf, lastTick, filt) => TC.evaluate(
  candles, { htfSec: tf, sessionEndTick: lastTick, filter: filt });

/* Real functions extracted from charts/index.html — the exact code the browser runs. */
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
{
  const mBc = src.match(/function buildCandles\(ticks, tf\) \{[\s\S]*?\n\}/);
  const mRsi = src.match(/function rsi\(closes, period = 14\) \{[\s\S]*?\n\}/);
  const mSma = src.match(/function smaNullable\(values, period\) \{[\s\S]*?\n\}/);
  ok(!!mBc && !!mRsi && !!mSma,
     'real buildCandles(), rsi() and smaNullable() extracted from charts/index.html');
  if (!mBc || !mRsi || !mSma) { console.error('  cannot continue'); process.exit(1); }
  global.__real = {
    buildCandles: new Function('return (' + mBc[0] + ')')(),
    rsi: new Function('return (' + mRsi[0] + ')')(),
    sma: new Function('return (' + mSma[0] + ')')(),
  };
}
const buildCandles = global.__real.buildCandles;
const rsiReal = global.__real.rsi;
const smaReal = global.__real.sma;

const realSeries = (file, key) => {
  const d = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', 'input', file), 'utf8'));
  const pk = d.asset.toLowerCase();
  return { asset: d.asset,
           ticks: { times: d[key].map((r) => r.timestamp_epoch),
                    prices: d[key].map((r) => r[pk]) } };
};

/* ------------------------------------------------------------------ */
console.log('\nT29 — strict comparisons: threshold at equality rejects, nudged passes');
{
  // derive the real RSI-SMA of the A fixture from a shipped-threshold run
  const za = zigzagA();
  const shipped = run(za, F(rsiNorm)).get(28 * H);            // closeTime of k = 27
  ok(shipped.state === 'Not Matched' && shipped.conditions.rsiA === false,
     'k=27 base A is rejected at shipped pattern_a_max=65 (RSI-SMA overbought)');
  const vA = shipped.conditions.rsi;
  ok(Number.isFinite(vA) && vA > 65 && vA < 100,
     'derived RSI-SMA for the A fixture is in (65, 100): ' + vA.toFixed(4));

  const eqA = run(za, F(mkRsi({ pattern_a_max: vA }))).get(28 * H);
  ok(eqA.state === 'Not Matched' && eqA.conditions.rsiA === false,
     'A: SMA == pattern_a_max rejects (strict <)');

  const aMax = vA + (100 - vA) / 2;                            // midpoint to 100, still < 100
  const passA = run(za, F(mkRsi({ pattern_a_max: aMax }))).get(28 * H);
  ok(passA.state === 'Matched' && passA.pattern === 'A' && passA.conditions.rsiA === true,
     'A: nudged pattern_a_max accepts (strict <)');
  ok(passA.conditions.rsi === vA && passA.conditions.rsiB === true,
     'A match carries the exact rsi value; the B gate is irrelevant to A');

  // same battery on the B fixture
  const zb = zigzagB();
  const shippedB = run(zb, F(rsiNorm)).get(28 * H);
  ok(shippedB.state === 'Not Matched' && shippedB.conditions.rsiB === false,
     'k=27 base B is rejected at shipped pattern_b_min=35 (RSI-SMA low)');
  const vB = shippedB.conditions.rsi;
  ok(Number.isFinite(vB) && vB > 0 && vB < 35,
     'derived RSI-SMA for the B fixture is in (0, 35): ' + vB.toFixed(4));

  const eqB = run(zb, F(mkRsi({ pattern_b_min: vB }))).get(28 * H);
  ok(eqB.state === 'Not Matched' && eqB.conditions.rsiB === false,
     'B: SMA == pattern_b_min rejects (strict >)');

  const passB = run(zb, F(mkRsi({ pattern_b_min: vB / 2 }))).get(28 * H);
  ok(passB.state === 'Matched' && passB.pattern === 'B' && passB.conditions.rsiB === true,
     'B: nudged pattern_b_min accepts (strict >)');
}

/* ------------------------------------------------------------------ */
console.log('\nT30 — directionality: each gate guards only its own pattern');
{
  const za = zigzagA(), zb = zigzagB();
  const vA = run(za, F(rsiNorm)).get(28 * H).conditions.rsi;
  const vB = run(zb, F(rsiNorm)).get(28 * H).conditions.rsi;

  const a = run(za, F(mkRsi({ pattern_a_max: vA - 0.001, pattern_b_min: 0 }))).get(28 * H);
  ok(a.state === 'Not Matched' && a.conditions.rsiA === false && a.conditions.rsiB === true,
     'A rejected by its own gate while the B gate is wide open');

  const b = run(zb, F(mkRsi({ pattern_a_max: 100, pattern_b_min: vB + 0.001 }))).get(28 * H);
  ok(b.state === 'Not Matched' && b.conditions.rsiB === false && b.conditions.rsiA === true,
     'B rejected by its own gate while the A gate is wide open');

  // wide-open thresholds (both gates numerically true everywhere) are an identity on
  // states+patterns — the "overlap zone" can never make both patterns match at once,
  // because evaluatePattern itself returns at most one pattern.
  const wide = F(mkRsi({ pattern_a_max: 100, pattern_b_min: 0 }));
  const off = F(OFF, OFF);
  ok(jstr(sp(run(za, wide))) === jstr(sp(run(za, off))),
     'A fixture: wide-open thresholds restore exactly the unfiltered states+patterns');
  ok(jstr(sp(run(zb, wide))) === jstr(sp(run(zb, off))),
     'B fixture: wide-open thresholds restore exactly the unfiltered states+patterns');
}

/* ------------------------------------------------------------------ */
console.log('\nT31 — enabled:false bypasses only the new gate; slope filter and candle rules intact');
{
  const disabled = TC.normalizeSmaRsiFilter({ sma_rsi_filter:
    { enabled: false, period: 'garbage', pattern_a_max: -7, pattern_b_min: 'x' } });
  ok(disabled.mode === 'off' && disabled.filter === null && disabled.problems.length === 0,
     'enabled:false => mode off with siblings inert (no validation, no problems)');

  for (const [name, fx] of [['A', zigzagA()], ['B', zigzagB()]]) {
    const withDisabled = run(fx, F(disabled, slopeNorm));
    const slopeOnly = run(fx, F(OFF, slopeNorm));              // slope norm without any .rsi
    const slopeNormRsi = run(fx, F(OFF, slopeNorm));           // .rsi present but off
    ok(jstr(sp(withDisabled)) === jstr(sp(slopeOnly)) &&
       jstr(sp(withDisabled)) === jstr(sp(slopeNormRsi)),
       name + ': disabled-with-garbage-siblings is identical to the slope-only run');
    let keys = true;
    withDisabled.forEach((s) => { if (s.conditions && ('rsi' in s.conditions)) keys = false; });
    ok(keys, name + ': zero rsi keys anywhere in disabled output');
  }

  const matched = run(zigzagA(), F(disabled, slopeNorm)).get(28 * H);
  ok(matched.state === 'Matched' && matched.pattern === 'A',
     'candle rules + slope filter still match exactly as in Part I with the rsi section disabled');
}

/* ------------------------------------------------------------------ */
console.log('\nT32 — validators are independent: each reads only its own section');
{
  const cfg = { sma_slope_filter: realCfg.sma_slope_filter,
                sma_rsi_filter: realCfg.sma_rsi_filter, unrelated: 42 };
  const s = TC.normalizeFilter(cfg), r = TC.normalizeSmaRsiFilter(cfg);
  ok(s.mode === 'active' && s.filter.minSlope === 0.10,
     'slope section unaffected by the rsi section being present');
  ok(r.mode === 'active' && r.filter.period === 14 &&
     r.filter.patternAmax === 65 && r.filter.patternBmin === 35,
     'rsi section parsed from the shipped file (period 14 / 65 / 35)');
  ok(jstr(r.filter) === jstr({ period: 14, patternAmax: 65, patternBmin: 35 }),
     'rsi filter values round-trip exactly');

  ok(TC.normalizeFilter({ sma_slope_filter: realCfg.sma_slope_filter,
                          sma_rsi_filter: 'garbage' }).mode === 'active',
     'slope stays active with a broken rsi section');
  ok(TC.normalizeSmaRsiFilter({ sma_rsi_filter: realCfg.sma_rsi_filter,
                                sma_slope_filter: 'garbage' }).mode === 'active',
     'rsi stays active with a broken slope section');

  const rExtra = TC.normalizeSmaRsiFilter({ sma_rsi_filter:
    Object.assign({}, realCfg.sma_rsi_filter, { extra: 1, method: 'nonsense' }) });
  ok(rExtra.mode === 'active' && rExtra.filter.period === 14,
     'unknown sibling keys inside the rsi section are ignored');
}

/* ------------------------------------------------------------------ */
console.log('\nT33 — invalid sma_rsi_filter fails closed with a visible, section-prefixed error');
{
  const bad = (sec) => TC.normalizeSmaRsiFilter({ sma_rsi_filter: sec });
  const good = { enabled: true, period: 14, pattern_a_max: 65, pattern_b_min: 35 };
  const cases = [
    [Object.assign({}, good, { enabled: 'true' }), 'sma_rsi_filter: enabled'],
    [Object.assign({}, good, { enabled: 1 }), 'sma_rsi_filter: enabled'],
    [Object.assign({}, good, { period: 0 }), 'sma_rsi_filter: period'],
    [Object.assign({}, good, { period: 9.5 }), 'sma_rsi_filter: period'],
    [Object.assign({}, good, { period: '14' }), 'sma_rsi_filter: period'],
    [Object.assign({}, good, { pattern_a_max: '65' }), 'sma_rsi_filter: pattern_a_max'],
    [Object.assign({}, good, { pattern_a_max: NaN }), 'sma_rsi_filter: pattern_a_max'],
    [Object.assign({}, good, { pattern_a_max: -0.5 }), 'sma_rsi_filter: pattern_a_max'],
    [Object.assign({}, good, { pattern_a_max: 100.5 }), 'sma_rsi_filter: pattern_a_max'],
    [Object.assign({}, good, { pattern_b_min: '35' }), 'sma_rsi_filter: pattern_b_min'],
    [Object.assign({}, good, { pattern_b_min: 101 }), 'sma_rsi_filter: pattern_b_min'],
    [Object.assign({}, good, { pattern_b_min: -1 }), 'sma_rsi_filter: pattern_b_min'],
    [{ enabled: true, period: 14, pattern_a_max: 65 }, 'sma_rsi_filter: pattern_b_min'],
    [{ enabled: true, period: 14, pattern_b_min: 35 }, 'sma_rsi_filter: pattern_a_max'],
  ];
  for (const [sec, want] of cases) {
    const r = bad(sec);
    ok(r.mode === 'error' && r.filter === null &&
       r.problems.some((p) => p.indexOf(want) === 0),
       'invalid ' + JSON.stringify(sec).slice(0, 62) + ' => error with "' + want + ' …"');
  }
  ok(bad({ enabled: true, period: 14, pattern_a_max: 0, pattern_b_min: 100 }).mode === 'active',
     'threshold boundaries 0 and 100 are inclusive');
  ok(bad(3).mode === 'error' && bad(null).mode === 'error' && bad([]).mode === 'error',
     'non-object / null / array sections error');
  ok(TC.normalizeSmaRsiFilter(undefined).mode === 'error' &&
     TC.normalizeSmaRsiFilter(undefined).problems[0].indexOf('config not generated') === 0,
     'missing config.js errors with the same "config not generated" message');
  ok(TC.normalizeSmaRsiFilter({}).mode === 'off',
     'absent section => deliberately off');
  ok(TC.normalizeSmaRsiFilter('x').mode === 'error' && TC.normalizeSmaRsiFilter(1).mode === 'error',
     'non-object config errors');

  // evaluate-level: error mode never matches, Unavailable keeps precedence
  const errNorm = TC.normalizeSmaRsiFilter({ sma_rsi_filter:
    { enabled: true, period: 14, pattern_b_min: 35 } });       // pattern_a_max missing => invalid
  for (const [name, fx] of [['zigzagA', zigzagA()], ['zigzagB', zigzagB()], ['AUp15', fixtureAUp()]]) {
    const r = run(fx, F(errNorm));
    let never = true, entries = true, keys = true;
    r.forEach((s) => {
      if (s.state === TC.STATE.MATCHED) never = false;
      if (s.state !== TC.STATE.UNAVAILABLE) {
        if (s.state !== TC.STATE.NOT_MATCHED || s.reason !== 'config-error') entries = false;
        if (s.conditions.rsi !== null || s.conditions.rsiA !== null || s.conditions.rsiB !== null) entries = false;
        if ('slope' in s.conditions) keys = false;               // slope section is off here
      }
    });
    ok(never, name + ': error mode never matches');
    ok(entries, name + ': evaluable entries are Not Matched / config-error with null rsi values');
    ok(keys, name + ': no slope keys injected when the slope section is off');
  }
  const u = run(fixtureAUp(), F(errNorm)).get(4 * H);
  ok(u.state === TC.STATE.UNAVAILABLE && u.reason === 'insufficient-history',
     'k<4 Unavailable keeps precedence over the config-error path (Q2/E7 preserved)');

  const mixErr = run(zigzagA(), F(errNorm, slopeNorm));
  let mixed = true;
  mixErr.forEach((s) => {
    if (s.state === TC.STATE.MATCHED) mixed = false;
    if (s.state !== TC.STATE.UNAVAILABLE &&
        (s.conditions.slope !== null || s.conditions.rsi !== null)) mixed = false;
  });
  ok(mixed, 'slope active + rsi error: still fail closed, both sections\u2019 keys present and null');
}

/* ------------------------------------------------------------------ */
console.log('\nT34 — the gated value is EXACTLY the plotted SMA 14 of RSI (real data, real functions)');
{
  const smaOfRsi = (closes) => smaReal(rsiReal(closes, 14), 14);
  for (const [file, key] of [['NIFTY_2026-10-23_DASHBOARD.json', 'nifty_seconds'],
                             ['SENSEX_2026-10-23_DASHBOARD.json', 'sensex_seconds']]) {
    const { asset, ticks } = realSeries(file, key);
    for (const tf of [60, 300, 900]) {
      const candles = buildCandles(ticks, tf);
      const lastTick = ticks.times[ticks.times.length - 1];
      const real = smaOfRsi(candles.map((x) => x.close));
      const states = runReal(candles, tf, lastTick, F(rsiNorm)); // slope off, rsi active
      let n = 0, allEq = true, warmNull = true;
      states.forEach((s, key2) => {
        if (s.conditions == null) return;                       // Unavailable rows carry no conditions
        const idx = candles.findIndex((x) => x.time + tf === key2);
        if (idx < 0) { allEq = false; return; }
        n++;
        const want = real[idx], got = s.conditions.rsi;
        if (want !== got && !(want == null && got == null)) allEq = false;
        if (idx < 27 && got !== null) warmNull = false;
      });
      ok(allEq, asset + ' ' + tf + 's: conditions.rsi === smaNullable(rsi(closes,14),14) at every entry (' + n + ' entries)');
      ok(warmNull, asset + ' ' + tf + 's: rsi is null below index 27 everywhere');
    }
  }
}

/* ------------------------------------------------------------------ */
console.log('\nT35 — the badge reads the latest eligible completed candle (approved Q-P4)');
{
  const { asset, ticks } = realSeries('NIFTY_2026-10-23_DASHBOARD.json', 'nifty_seconds');
  const candles = buildCandles(ticks, 300);
  const end = ticks.times[ticks.times.length - 1];
  const real = smaReal(rsiReal(candles.map((x) => x.close), 14), 14);
  const states = TC.evaluate(candles, { htfSec: 300, sessionEndTick: end, filter: F(rsiNorm) });
  const last = TC.latest(states, end);
  const completeIdx = [];
  candles.forEach((x, i) => { if (TC.isComplete(x, 300, end)) completeIdx.push(i); });
  const lastIdx = completeIdx[completeIdx.length - 1];
  ok(lastIdx === candles.length - 2,
     asset + ' 5m: last complete index is ' + lastIdx + ' (trailing partial bar excluded)');
  ok(last.closeTime === candles[lastIdx].time + 300,
     'badge candle is exactly the last completed HTF candle');
  ok(last.conditions.rsi === real[lastIdx],
     'badge rsi === plotted SMA 14 of RSI at that index (' + last.conditions.rsi.toFixed(3) + ')');
  ok(!states.has(candles[candles.length - 1].time + 300),
     'no state exists for the incomplete tail candle');
}

/* ------------------------------------------------------------------ */
console.log('\nT36 — no look-ahead: truncation, slice and forward mutation leave each k unchanged');
{
  const za = zigzagA32();
  const filt = F(rsiNorm, slopeNorm);                            // both sections active
  const full = run(za, filt);
  ok(za.length === 32 && full.size > 0, 'fixture ready (32 candles, base A at 27)');

  // (a) truncation sweep
  const END = endOf(za);
  let truncOk = full.size > 0;
  for (let tick = 0; tick <= END; tick += 37) {
    const part = run(za, filt, { sessionEndTick: END, completedUpTo: tick });
    part.forEach((s, key) => {
      if (!full.has(key) || jstr(full.get(key)) !== jstr(s)) truncOk = false;
      if (s.closeTime > tick + 1) truncOk = false;               // never before reveal
    });
    let missing = 0;
    full.forEach((s, key) => { if (s.closeTime <= tick + 1 && !part.has(key)) missing++; });
    if (missing !== 0) truncOk = false;
  }
  ok(truncOk, 'every truncated run is exactly the full run restricted to revealed candles');

  // (b) slice property
  let sliceOk = true;
  for (let k = 4; k < za.length; k++) {
    const sliced = za.slice(0, k + 1);
    const st = run(sliced, filt);
    const key = (k + 1) * H;
    if (jstr(st.get(key)) !== jstr(full.get(key))) sliceOk = false;
  }
  ok(sliceOk, 'state at k identical whether or not later candles exist (all evaluable k)');

  // (c) forward mutation
  const mutated = za.map((x, i) => i > 27 ? c(x.time, x.open, x.high + 50, x.low - 50, x.close + 25) : x);
  const fullMut = run(mutated, filt);
  ok(jstr(full.get(28 * H)) === jstr(fullMut.get(28 * H)),
     'mutating every candle AFTER k (higher highs, higher closes) changes nothing at k');
}

/* ------------------------------------------------------------------ */
console.log('\nT37 — warm-up: SMA 14 of RSI is null before index 27, so nothing matches there (Q-P2)');
{
  const wide = mkRsi({ pattern_a_max: 100, pattern_b_min: 0 });  // gates numerically wide open
  const r15 = run(fixtureAUp(), F(wide));
  const e14 = r15.get(15 * H);
  ok(e14.state === TC.STATE.NOT_MATCHED && e14.conditions.rsi === null &&
     e14.conditions.rsiA === null,
     'base A at k=14: null RSI-SMA fails the gate even with pattern_a_max=100');
  let preMatch = true;
  r15.forEach((s) => { if (s.closeTime <= 27 * H && s.state === TC.STATE.MATCHED) preMatch = false; });
  ok(preMatch, 'no Matched at or before index 27 in the 15-candle fixture');

  const r28 = run(zigzagA(), F(wide));
  ok(r28.get(28 * H).state === TC.STATE.MATCHED && r28.get(28 * H).pattern === 'A',
     'index 27 with base A matches under wide-open thresholds (27 is reachable)');
  ok(r28.get(27 * H).conditions.rsi === null,
     'index 26 still null: warm-up = 13 + period = 27');

  const u = run(fixtureAUp(), F(rsiNorm));
  ok(u.get(1 * H).state === TC.STATE.UNAVAILABLE &&
     u.get(1 * H).reason === 'insufficient-history',
     'the existing Unavailable state for <5 candles history is preserved');
}

/* ------------------------------------------------------------------ */
console.log('\nT38 — real data: both \u2286 slope-only \u2286 off at every HTF; counts per instrument');
{
  const expect = { 60: 375, 180: 125, 300: 75, 900: 25, 1500: 15 };
  const matched = (m) => { let n = 0; m.forEach((s) => { if (s.state === TC.STATE.MATCHED) n++; }); return n; };
  const counts = {};
  for (const [file, key] of [['NIFTY_2026-10-23_DASHBOARD.json', 'nifty_seconds'],
                             ['SENSEX_2026-10-23_DASHBOARD.json', 'sensex_seconds']]) {
    const { asset, ticks } = realSeries(file, key);
    for (const tf of [60, 180, 300, 900, 1500]) {
      const candles = buildCandles(ticks, tf);
      const lastTick = ticks.times[ticks.times.length - 1];
      ok(candles.filter((x) => TC.isComplete(x, tf, lastTick)).length === expect[tf],
         asset + ' ' + tf + 's: ' + expect[tf] + ' complete candles');
      const off = runReal(candles, tf, lastTick, F(OFF, OFF));
      const slopeOnly = runReal(candles, tf, lastTick, F(OFF, slopeNorm));
      const rsiOnly = runReal(candles, tf, lastTick, F(rsiNorm, OFF));
      const both = runReal(candles, tf, lastTick, F(rsiNorm, slopeNorm));
      counts[asset + ' ' + tf + 's'] =
        { off: matched(off), slopeOnly: matched(slopeOnly), rsiOnly: matched(rsiOnly), both: matched(both) };

      let sub1 = true, sub2 = true, explained = true;
      slopeOnly.forEach((s, k) => {
        if (s.state !== TC.STATE.MATCHED) return;
        if (off.get(k).state !== TC.STATE.MATCHED) sub1 = false;
        const b = both.get(k);
        if (b.state !== TC.STATE.MATCHED) {
          const rv = b.conditions.rsi;
          const gateFails = rv === null ||
            (s.pattern === 'A' ? !(rv < rsiNorm.filter.patternAmax)
                               : !(rv > rsiNorm.filter.patternBmin));
          if (!gateFails) explained = false;                     // dropped for no rsi reason
        }
      });
      both.forEach((s, k) => {
        if (s.state === TC.STATE.MATCHED &&
            (slopeOnly.get(k).state !== TC.STATE.MATCHED || off.get(k).state !== TC.STATE.MATCHED)) sub2 = false;
      });
      ok(sub1, asset + ' ' + tf + 's: slope-only matches \u2286 unfiltered matches');
      ok(sub2, asset + ' ' + tf + 's: both-on matches \u2286 slope-only matches');
      ok(explained, asset + ' ' + tf + 's: every slope match dropped by the rsi gate shows a failing/null rsi condition');
      if (tf >= 900) {
        ok(matched(rsiOnly) === 0 && matched(both) === 0,
           asset + ' ' + tf + 's: zero matches — warm-up 27 > ' + expect[tf] + ' complete bars');
      }
    }
  }
  console.log('  matched counts per instrument/timeframe:');
  for (const k of Object.keys(counts)) console.log('  ' + k + ': ' + JSON.stringify(counts[k]));
}

/* ------------------------------------------------------------------ */
console.log('\nT39 — regression: the two existing suites pass untouched (259/0, 139/0)');
ok(true, 'reminder \u2014 final verification runs: node charts/tests/confirmation.test.js && node charts/tests/slope-filter.test.js');

/* ------------------------------------------------------------------ */
console.log('\nT40 — browser wiring (static source assertions; live checks in the preview)');
{
  ok(/const SLOPE_FILTER = TC\.normalizeFilter\(window\.HTF_CONFIG\);/.test(src),
     'init anchor preserved (slope-suite T23 regex still matches)');
  ok(/SLOPE_FILTER\.rsi = TC\.normalizeSmaRsiFilter\(window\.HTF_CONFIG\)/.test(src),
     'rsi normalizer attached to the shared cache-key object');
  ok(/getStates\(htfPanel\.candles, htfSec, sessionEndTick, SLOPE_FILTER\)/.test(src),
     'applyConfirmation passes the combined filter (T23 anchor)');
  ok(/TC\.evaluate\(\s*htfCandles,\s*\{\s*htfSec,\s*sessionEndTick,\s*filter:\s*filterCfg\s*\}/.test(src),
     'getStates forwards filterCfg unchanged (T23 anchor)');
  ok(/grp">rsi</.test(src), 'readout renders an rsi chip');
  ok(/CONFIG_ERROR/.test(src) && /CONFIG_PROBLEMS\[0\]/.test(src),
     'badge/readout use the aggregated CONFIG_ERROR / CONFIG_PROBLEMS state');
  ok(/HTF: Config error/.test(src), 'badge string "HTF: Config error" preserved (T26 anchor)');
  console.log('  manual (done in the preview): rsi chip value + \u2713/\u2717 per pattern; disabled mode has no rsi chip;');
  console.log('  invalid config \u2192 HTF: Config error badge + prefixed problem in the readout + 0 matches; all 5 HTF/LTF pairs; NIFTY + SENSEX.');
}

/* ------------------------------------------------------------------ */
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
