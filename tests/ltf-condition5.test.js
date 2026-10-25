#!/usr/bin/env node
/**
 * ltf-condition5.test.js — LTF Condition 5 (Patterns A and B): back candle distance vs E candle distance,
 * see ltf_condition5_distance_ratio.md.
 *
 *   E candle                    = the candle with the C1+C2+C3+C4 A arrow
 *   e candle distance           = E.high - (E-1).low
 *   back high                   = max(high) of the `back_candles` candles BEFORE E (E excluded, E-1 included)
 *   back candle distance        = back high - E.high
 *   keep the E candle only when   back distance  >  distance_multiplier x e distance      (strict)
 *   Pattern B is the exact mirror on the low side:
 *   e distance = (E-1).high - E.low,  back low = min(low) of the same N candles,  back distance = E.low - back low
 *
 * Run: node tests/ltf-condition5.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const TL = require('../src/ltf-conditions.js');
const TC = require('../src/confirmation.js');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.error('  ✗ FAIL — ' + label); }
}
const near = (a, b) => Math.abs(a - b) < 1e-9;

const L = 60;
const CFG = { backCandles: 20, multiplier: 2 };
const mkMark = (i, pattern) => ({ time: i * L, pattern, rsi: 55, prevRsi: 45, windowCloseTime: 0, hitTime: 0, hitValue: 70 });
/** Candles: flat at 100 (high 101, low 99) with overrides {index: {high, low}}. */
const candles = (n, over) => Array.from({ length: n }, (_, i) => Object.assign({ time: i * L, high: 101, low: 99, close: 100 }, (over || {})[i] || {}));
const ev = (cs, marks, cfg) => TL.evaluateCondition5(cs, marks, cfg || CFG);

/**
 * Scenario builder for the E candle at index 30:
 *   E.high = 110, (E-1).low = 110 - e   => e candle distance = e
 *   a candle inside the back window has high = 110 + b  => back candle distance = b
 */
function scenario(e, b, opts) {
  opts = opts || {};
  const over = {};
  over[30] = { high: 110, low: 105 };
  over[29] = { high: 109, low: 110 - e };
  over[opts.backAt === undefined ? 20 : opts.backAt] = Object.assign({}, over[opts.backAt === undefined ? 20 : opts.backAt], { high: 110 + b });
  return candles(40, over);
}

/* ------------------------------------------------------------------ */
console.log('\nT82 — config: off / active / error contract');
{
  const good = { condition_5_distance_ratio: { enabled: true, back_candles: 20, distance_multiplier: 2 } };
  const a = TL.normalizeCondition5(good);
  ok(a.mode === 'active' && a.cfg.backCandles === 20 && a.cfg.multiplier === 2, 'valid section -> active with parsed values');
  ok(TL.normalizeCondition5({}).mode === 'off', 'section absent -> off');
  ok(TL.normalizeCondition5({ condition_5_distance_ratio: { enabled: false } }).mode === 'off', 'enabled:false -> off');
  ok(TL.normalizeCondition5(undefined).mode === 'error' &&
     /config not generated/.test(TL.normalizeCondition5(undefined).problems[0]), 'missing ltf-config.js -> error "config not generated"');
  ok(TL.normalizeCondition5('x').mode === 'error', 'non-object config -> error');
  ok(TL.normalizeCondition5({ condition_5_distance_ratio: [] }).mode === 'error', 'array section -> error');
  const bad = (patch) => TL.normalizeCondition5({ condition_5_distance_ratio: Object.assign({}, good.condition_5_distance_ratio, patch) });
  for (const [name, patch, text] of [
    ['enabled not boolean', { enabled: 'yes' }, 'enabled'],
    ['back_candles 0', { back_candles: 0 }, 'back_candles'],
    ['back_candles fractional', { back_candles: 20.5 }, 'back_candles'],
    ['back_candles missing', { back_candles: undefined }, 'back_candles'],
    ['multiplier 0', { distance_multiplier: 0 }, 'distance_multiplier'],
    ['multiplier negative', { distance_multiplier: -2 }, 'distance_multiplier'],
    ['multiplier string', { distance_multiplier: '2' }, 'distance_multiplier'],
    ['multiplier NaN', { distance_multiplier: NaN }, 'distance_multiplier'],
  ]) {
    const r = bad(patch);
    ok(r.mode === 'error' && r.cfg === null && r.problems.some((p) => p.indexOf(text) >= 0 &&
       p.indexOf('condition_5_distance_ratio:') === 0), name + ' -> error, section-prefixed problem');
  }
  ok(bad({ distance_multiplier: 0.5 }).mode === 'active' && bad({ distance_multiplier: 3.25 }).cfg.multiplier === 3.25, 'fractional multipliers are valid');
  const shipped = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'ltf.json'), 'utf8'));
  const sc = TL.normalizeCondition5(shipped);
  const fileC5 = shipped.condition_5_distance_ratio;   // the shipped values are tuned in the file, so compare against it
  ok(sc.mode === 'active' && sc.cfg.backCandles === fileC5.back_candles && sc.cfg.multiplier === fileC5.distance_multiplier,
     'shipped config/ltf.json validates active and carries the file\'s back_candles / distance_multiplier');
  ok([1, 2, 3, 4].every((n) => TL['normalizeCondition' + n](shipped).mode === 'active'), 'Conditions 1-4 still validate alongside it');
}

/* ------------------------------------------------------------------ */
console.log('\nT83 — the rule: back distance > multiplier x e distance (Pattern A)');
{
  const pass5 = (e, b, cfg) => ev(scenario(e, b), [mkMark(30, 'A')], cfg).length === 1;
  ok(pass5(10, 25), 'back 25 > 2 x e 10 (=20) passes');
  ok(!pass5(10, 20), 'back exactly 2 x e (20 = 20) fails (strict)');
  ok(pass5(10, 20.01), 'back just above 2 x e passes');
  ok(!pass5(10, 15), 'back 15 < 20 fails');
  ok(pass5(15.4, 44.2), 'the NIFTY 22-10 12:58:48 numbers (e 15.40, back 44.20 > 30.80) pass');
  ok(!pass5(12.55, 7.05), 'the NIFTY 23-10 12:16:48 numbers (e 12.55, back 7.05 < 25.10) fail');
  const m = ev(scenario(10, 25), [mkMark(30, 'A')])[0];
  ok(near(m.eDistance, 10) && near(m.backDistance, 25) && m.backHigh === 135 && m.backHighTime === 20 * L && m.multiplier === 2,
     'mark carries eDistance, backDistance, backHigh, backHighTime and the multiplier');
  ok(m.rsi === 55 && m.hitValue === 70 && m.windowCloseTime === 0, 'original mark fields are carried through');
}

/* ------------------------------------------------------------------ */
console.log('\nT84 — multiplier is configurable');
{
  const run = (mult) => ev(scenario(10, 25), [mkMark(30, 'A')], { backCandles: 20, multiplier: mult }).length;
  ok(run(1) === 1 && run(2) === 1 && run(2.4) === 1, 'multipliers 1, 2 and 2.4 (threshold 24) pass back 25');
  ok(run(2.5) === 0, 'multiplier 2.5 (threshold 25) fails back 25 (strict)');
  ok(run(3) === 0, 'multiplier 3 (threshold 30) fails');
  ok(run(0.1) === 1, 'a tiny multiplier passes almost anything positive');
}

/* ------------------------------------------------------------------ */
console.log('\nT85 — back window: N candles BEFORE the E candle (E excluded, E-1 included)');
{
  const run = (backAt, n) => ev(scenario(10, 25, { backAt }), [mkMark(30, 'A')], { backCandles: n, multiplier: 2 }).length;
  ok(run(29, 20) === 1, 'E-1 (index 29) is inside the window');
  ok(run(10, 20) === 1, 'the 20th candle back (index 10) is inside a 20-candle window');
  ok(run(9, 20) === 0, 'the 21st candle back (index 9) is outside');
  ok(run(25, 5) === 1 && run(24, 5) === 0, 'back_candles 5: candle 25 counts, candle 24 does not');
  ok(run(0, 500) === 1, 'a window longer than the session clamps at candle 0');
  // the E candle itself can never be its own back high
  const over = {}; over[30] = { high: 200, low: 105 }; over[29] = { high: 109, low: 100 };
  ok(ev(candles(40, over), [mkMark(30, 'A')]).length === 0, 'E high is the highest -> back distance <= 0 -> fails');
  // candles AFTER E are never read (no look-ahead)
  const future = scenario(10, 25); future[35] = { time: 35 * L, high: 9999, low: 0, close: 100 };
  const base = scenario(10, 25);
  ok(JSON.stringify(ev(future, [mkMark(30, 'A')])) === JSON.stringify(ev(base, [mkMark(30, 'A')])), 'candles after the E candle never change the result');
  const trunc = base.slice(0, 31);
  ok(JSON.stringify(ev(trunc, [mkMark(30, 'A')])) === JSON.stringify(ev(base, [mkMark(30, 'A')])), 'data truncated at the E candle gives the same result');
  const bh = scenario(10, 25, { backAt: 20 }); bh[15] = Object.assign({}, bh[15], { high: 130 });
  ok(ev(bh, [mkMark(30, 'A')])[0].backHigh === 135, 'back high is the MAX of the window (135 beats 130)');
}

/* ------------------------------------------------------------------ */
console.log('\nT86 — e candle distance edge cases (non-positive fails)');
{
  const gap = {}; gap[30] = { high: 110, low: 105 }; gap[29] = { high: 112, low: 111 }; gap[20] = { high: 150, low: 99 };
  ok(ev(candles(40, gap), [mkMark(30, 'A')]).length === 0, 'E high below the E-1 low (negative e distance) -> fails');
  const zero = {}; zero[30] = { high: 110, low: 105 }; zero[29] = { high: 112, low: 110 }; zero[20] = { high: 150, low: 99 };
  ok(ev(candles(40, zero), [mkMark(30, 'A')]).length === 0, 'E high equal to the E-1 low (zero e distance) -> fails');
  ok(ev(candles(40, { 20: { high: 150, low: 99 } }), [mkMark(0, 'A')]).length === 0, 'mark on the very first candle has no E-1 -> fails');
  ok(ev(scenario(10, 25), [{ time: 99999, pattern: 'A' }]).length === 0, 'mark whose candle does not exist is dropped');
  ok(ev(scenario(10, 25), []).length === 0 && ev([], [mkMark(30, 'A')]).length === 0, 'no marks / no candles -> nothing');
  const early = {}; early[5] = { high: 110, low: 105 }; early[4] = { high: 109, low: 100 }; early[2] = { high: 140, low: 99 };
  ok(ev(candles(10, early), [mkMark(5, 'A')]).length === 1, 'early session (fewer than N candles before E): uses what exists');
}

/* ------------------------------------------------------------------ */
/**
 * Pattern B scenario (mirror): E candle at index 30 with E.low = 90, (E-1).high = 90 + e  => e distance = e;
 * a candle inside the back window has low = 90 - b                                   => back distance = b.
 */
function scenarioB(e, b, opts) {
  opts = opts || {};
  const at = opts.backAt === undefined ? 20 : opts.backAt;
  const over = {};
  over[30] = { high: 95, low: 90 };
  over[29] = { high: 90 + e, low: 91 };
  over[at] = Object.assign({}, over[at], { low: 90 - b });
  return candles(40, over);
}

console.log('\nT87 — Pattern B is the exact mirror (low side)');
{
  const pass5 = (e, b, cfg) => ev(scenarioB(e, b), [mkMark(30, 'B')], cfg).length === 1;
  ok(pass5(10, 25), 'B: back 25 > 2 x e 10 (=20) passes');
  ok(!pass5(10, 20), 'B: back exactly 2 x e fails (strict)');
  ok(pass5(10, 20.01), 'B: back just above 2 x e passes');
  ok(!pass5(10, 15), 'B: back 15 < 20 fails');
  ok(pass5(10, 25, { backCandles: 20, multiplier: 2.4 }) && !pass5(10, 25, { backCandles: 20, multiplier: 2.5 }), 'B: multiplier is honoured (threshold 24 passes, 25 fails)');
  const m = ev(scenarioB(10, 25), [mkMark(30, 'B')])[0];
  ok(near(m.eDistance, 10) && near(m.backDistance, 25) && m.backLow === 65 && m.backLowTime === 20 * L && m.multiplier === 2,
     'B mark carries eDistance, backDistance, backLow, backLowTime and the multiplier');
  ok(m.backHigh === undefined, 'a B mark does not carry the Pattern A fields');
  ok(m.rsi === 55 && m.hitValue === 70, 'original mark fields are carried through');

  const run = (backAt, n) => ev(scenarioB(10, 25, { backAt }), [mkMark(30, 'B')], { backCandles: n, multiplier: 2 }).length;
  ok(run(29, 20) === 1, 'B: E-1 (index 29) is inside the window');
  ok(run(10, 20) === 1 && run(9, 20) === 0, 'B: 20th candle back counts, 21st does not');
  ok(run(25, 5) === 1 && run(24, 5) === 0, 'B: back_candles 5 -> candle 25 counts, candle 24 does not');
  ok(run(0, 500) === 1, 'B: a window longer than the session clamps at candle 0');

  const lowest = {}; lowest[30] = { high: 95, low: 10 }; lowest[29] = { high: 100, low: 91 };
  ok(ev(candles(40, lowest), [mkMark(30, 'B')]).length === 0, 'B: E low is the lowest -> back distance <= 0 -> fails');
  const gap = {}; gap[30] = { high: 95, low: 90 }; gap[29] = { high: 89, low: 80 }; gap[20] = { high: 101, low: 40 };
  ok(ev(candles(40, gap), [mkMark(30, 'B')]).length === 0, 'B: (E-1).high below E.low (negative e distance) -> fails');
  const zero = {}; zero[30] = { high: 95, low: 90 }; zero[29] = { high: 90, low: 80 }; zero[20] = { high: 101, low: 40 };
  ok(ev(candles(40, zero), [mkMark(30, 'B')]).length === 0, 'B: (E-1).high equal to E.low (zero e distance) -> fails');
  const future = scenarioB(10, 25); future[35] = { time: 35 * L, high: 101, low: -9999, close: 100 };
  ok(JSON.stringify(ev(future, [mkMark(30, 'B')])) === JSON.stringify(ev(scenarioB(10, 25), [mkMark(30, 'B')])), 'B: candles after the E candle never change the result');
  ok(ev(scenarioB(10, 25), [mkMark(0, 'B')]).length === 0, 'B: mark on the very first candle has no E-1 -> fails');
}

console.log('\nT87b — Patterns A and B are judged independently; inputs are never mutated');
{
  const scA = scenario(10, 25), scB = scenarioB(10, 25);
  ok(ev(scA, [mkMark(30, 'A'), mkMark(30, 'B')]).map((x) => x.pattern).join() === 'A', 'on a candle set built for A, the B mark is judged on its own mirror numbers (and fails)');
  ok(ev(scB, [mkMark(30, 'A'), mkMark(30, 'B')]).map((x) => x.pattern).join() === 'B', 'on a candle set built for B, the A mark fails and the B mark passes');
  const input = [mkMark(30, 'A'), mkMark(30, 'B')];
  ev(scA, input);
  ok(input.every((x) => x.eDistance === undefined), 'input marks are not mutated');
}

/* ------------------------------------------------------------------ */
console.log('\nT88 — combineMarks with five kinds: still ONE entry per C1 mark');
{
  const c1 = [mkMark(1, 'A'), mkMark(2, 'A'), mkMark(3, 'A'), mkMark(4, 'A'), mkMark(5, 'A'), mkMark(6, 'B')];
  const c2 = c1.slice(1, 6).map((m) => Object.assign({}, m, { smaFast: 2, smaSlow: 1 }));
  const c3 = c2.slice(1).map((m) => Object.assign({}, m, { spreadPct: 0.01 }));
  const c4 = c3.slice(1).map((m) => Object.assign({}, m, { hitTime: 0, hitValue: 70 }));
  const c5 = [Object.assign({}, c4[1], { eDistance: 1, backDistance: 5, backHigh: 1, backHighTime: 0, multiplier: 2 })];
  const comb = TL.combineMarks(c1, c2, c3, c4, c5);
  ok(comb.length === c1.length, 'exactly one entry per C1 mark');
  ok(comb.map((m) => m.kind).join() === 'C1,C1+C2,C1+C2+C3,C1+C2+C3+C4,C1+C2+C3+C4+C5,C1+C2+C3+C4', 'kind = highest condition level reached');
  ok(comb[4].eDistance === 1 && comb[3].eDistance === undefined, 'C5 entries carry the distances; lower kinds do not');
  ok(TL.combineMarks(c1, c2, c3, c4).map((m) => m.kind).join() === 'C1,C1+C2,C1+C2+C3,C1+C2+C3+C4,C1+C2+C3+C4,C1+C2+C3+C4', 'four-argument form (no C5) behaves as before');
  ok(TL.combineMarks(c1, c2, c3, [], c5).slice(-2)[0].kind === 'C1+C2+C3', 'a C5 mark without its C4 mark is not promoted (C5 only ever refines C4)');
  const bAll = [mkMark(30, 'B')];
  const bc2 = bAll.map((m) => Object.assign({}, m, { smaFast: 1, smaSlow: 2 }));
  const bc3 = bc2.map((m) => Object.assign({}, m, { spreadPct: -0.01 }));
  const bc4 = bc3.map((m) => Object.assign({}, m, { hitTime: 0, hitValue: 20 }));
  const bc5 = ev(scenarioB(10, 25), bc4);
  ok(bc5.length === 1 && TL.combineMarks(bAll, bc2, bc3, bc4, bc5)[0].kind === 'C1+C2+C3+C4+C5', 'a Pattern B mark that passes C5 reaches C1+C2+C3+C4+C5');
  ok(TL.combineMarks(bAll, bc2, bc3, bc4, ev(scenarioB(10, 15), bc4))[0].kind === 'C1+C2+C3+C4', 'a Pattern B mark that fails C5 stays at C1+C2+C3+C4');
}

/* ------------------------------------------------------------------ */
console.log('\nT89 — real data: every C5 verdict (Pattern A and B) matches an independent brute-force computation');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const mBc = src.match(/function buildCandles\(ticks, tf\) \{[\s\S]*?\n\}/);
  if (!mBc) { ok(false, 'extract buildCandles'); process.exit(1); }
  const buildCandles = new Function('return (' + mBc[0] + ')')();
  const HTF_OF = { 12: 60, 36: 180, 60: 300, 180: 900, 300: 1500 };
  const c2cfg = { fastPeriod: 9, slowPeriod: 44 }, band = { minPct: 0, maxPct: 0.02 };
  const c4cfg = { lookback: 20, aAbove: 67.5, bBelow: 32.5 };
  let agree = true, subset = true, nA = 0, nPass = 0, nFail = 0, nB = 0, nBPass = 0, anchors = {};
  for (const [file, key] of [['NIFTY_2026-10-22_DASHBOARD.json', 'nifty_seconds'], ['SENSEX_2026-10-22_DASHBOARD.json', 'sensex_seconds'],
                             ['NIFTY_2026-10-23_DASHBOARD.json', 'nifty_seconds'], ['SENSEX_2026-10-23_DASHBOARD.json', 'sensex_seconds'],
                             ['NIFTY_2026-10-15_DASHBOARD.json', 'nifty_seconds']]) {
    if (!fs.existsSync(path.join(__dirname, '..', 'input', file))) { console.log('  note: input/' + file + ' is not present \u2014 skipped'); continue; }
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'input', file), 'utf8'));
    const pk = d.asset.toLowerCase();
    const ticks = { times: d[key].map((r) => r.timestamp_epoch), prices: d[key].map((r) => r[pk]) };
    const last = ticks.times[ticks.times.length - 1];
    for (const ltf of Object.keys(HTF_OF).map(Number)) {
      const htf = HTF_OF[ltf];
      const lc = buildCandles(ticks, ltf);
      const closes = lc.map((x) => x.close);
      const rsi = TC.rsiArray(closes, 14), rsiSma = TL.smaNullableArray(rsi, 14);
      const states = TC.evaluate(buildCandles(ticks, htf), { htfSec: htf, sessionEndTick: last });
      const wins = [];
      states.forEach((st) => { if (st.state === TC.STATE.MATCHED) wins.push({ from: st.closeTime - htf, to: st.closeTime, pattern: st.pattern }); });
      const c1 = TL.evaluateCondition1(lc, rsi, wins, { level: 50, scanCandles: 20 });
      const c2 = TL.evaluateCondition2(lc, c1, c2cfg);
      const c3 = TL.evaluateCondition3(lc, c2, band, c2cfg);
      const c4 = TL.evaluateCondition4(lc, c3, rsiSma, c4cfg);
      const c5 = TL.evaluateCondition5(lc, c4, CFG);
      for (const m of c4) {
        const i = lc.findIndex((x) => x.time === m.time);
        let want;
        if (m.pattern === 'A') {
          let mx = -Infinity; for (let j = Math.max(0, i - 20); j < i; j++) mx = Math.max(mx, lc[j].high);
          const e = lc[i].high - lc[i - 1].low, back = mx - lc[i].high;
          want = e > 0 && back > 2 * e;
        } else {
          let mn = Infinity; for (let j = Math.max(0, i - 20); j < i; j++) mn = Math.min(mn, lc[j].low);
          const e = lc[i - 1].high - lc[i].low, back = lc[i].low - mn;
          want = e > 0 && back > 2 * e;
        }
        const got = c5.some((x) => x.time === m.time && x.pattern === m.pattern);
        if (want !== got) agree = false;
        const tag = file.split('_')[0] + ' ' + file.split('_')[1] + ' ' + ltf + 's ' + new Date((m.time + 19800) * 1000).toISOString().slice(11, 19) + ' ' + m.pattern;
        anchors[tag] = got;
        if (m.pattern === 'A') { nA++; if (got) nPass++; else nFail++; }
        else { nB++; if (got) nBPass++; }
      }
      for (const m of c5) if (!c4.some((x) => x.time === m.time && x.pattern === m.pattern)) subset = false;
    }
  }
  ok(agree, 'every E candle (A and B): library verdict equals the brute-force (e > 0 and back > 2e) verdict');
  ok(subset, 'C5 marks are C4 marks (C5 only ever refines C4)');
  ok(nPass + nFail === nA && nA > 0, 'every Pattern A E candle was classified (' + nA + ': ' + nPass + ' pass, ' + nFail + ' fail)');
  ok(nBPass <= nB, 'Pattern B E candles: ' + nB + ' found, ' + nBPass + ' pass');
  const known = { 'NIFTY 2026-10-22 12s 12:58:48 A': true, 'NIFTY 2026-10-23 12s 12:16:48 A': false, 'SENSEX 2026-10-22 12s 12:58:49 A': true };
  const present = Object.keys(known).filter((k) => k in anchors);
  ok(present.every((k) => anchors[k] === known[k]), 'known examples that exist in input/ (' + present.length + ' of 3): NIFTY 22-10 12:58:48 passes, NIFTY 23-10 12:16:48 fails, SENSEX 22-10 12:58:49 passes');
  console.log('  info: Pattern A ' + nPass + ' of ' + nA + ' pass Condition 5; Pattern B ' + nBPass + ' of ' + nB + ' pass');
  Object.keys(anchors).filter((k) => / B$/.test(k)).forEach((k) => console.log('  info B: ' + k + ' -> ' + (anchors[k] ? 'passes' : 'fails')));
}

/* ------------------------------------------------------------------ */
console.log('\nT90 — browser wiring (static source assertions; live checks in the preview)');
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  ok(/TL\.normalizeCondition5\(window\.LTF_CONFIG\)/.test(html), 'config normalized from window.LTF_CONFIG');
  ok(/TL\.runChain\(/.test(html) && /c5: LTF_COND5/.test(html), 'applyConfirmation evaluates Condition 5 through the shared chain (TL.runChain)');
  ok(/chain\.marks\.map\(/.test(html) && /'C1\+C2\+C3\+C4\+C5'/.test(html), 'combined C1..C5 arrow drawn from the chain marks (one arrow per mark)');
  ok(/cond5Chip/.test(html), 'LTF readout has a C5 chip');
  console.log('  manual (done in the preview): pink C1+C2+C3+C4+C5 A / B arrows only where the back distance exceeds 2 x e distance;');
  console.log('  readout chip; LTF Conditions toggle clears all; bad condition_5 config -> visible error.');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
