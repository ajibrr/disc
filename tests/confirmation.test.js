/**
 * confirmation.test.js — no framework; run with:  node tests/confirmation.test.js
 *
 * Covers plan tests T1, T2, T3, T4, T6, T11, T12 (CandleImplementionplan.md §9).
 *
 * Note on T12: rather than trust a copy of the bucketing logic, these tests EXTRACT the
 * real buildCandles() out of web/index.html and execute it. If that extraction ever
 * fails the suite fails loudly, so the tests can never silently drift from the app.
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

const H = 300, L = 60;                       // 5m HTF / 1m LTF
const END = 1792749600;                      // a session end tick
function c(time, o, h, l, cl) { return { time, open: o, high: h, low: l, close: cl }; }

/* ------------------------------------------------------------------ */
console.log('T1 — literal rule transcription');
{
  // oldest .. newest: c5,c4,c3,c2,c1
  const mk = (a5, a4, a3, a2, a1) => [a5, a4, a3, a2, a1];

  const viaA = TC.evaluatePattern(
    c(0, 100, 108, 85, 90),   // -1 red
    c(-H, 105, 110, 90, 95),  // -2 red, high 110
    c(-2*H, 95, 102, 90, 100),
    c(-3*H, 95, 101, 90, 100),
    c(-4*H, 95, 100, 90, 100));
  ok(viaA.patternA === true && viaA.patternB === false, 'Pattern A matches via 5A');

  const aVia5B = TC.evaluatePattern(
    c(0, 98, 103, 85, 90),
    c(-H, 100, 104, 90, 92),   // 5A fails: 104 !> 105
    c(-2*H, 95, 105, 90, 100),
    c(-3*H, 95, 99, 90, 100),
    c(-4*H, 95, 100, 90, 100));
  ok(aVia5B.patternA === true, 'Pattern A matches via 5B when 5A fails');
  ok(aVia5B.conditions.c5aA === false && aVia5B.conditions.c5bA === true, '5A false / 5B true recorded');

  const bViaA = TC.evaluatePattern(
    c(0, 94, 106, 91, 100),    // -1 green
    c(-H, 95, 104, 90, 100),   // -2 green
    c(-2*H, 95, 108, 90, 100),
    c(-3*H, 95, 106, 90, 100),
    c(-4*H, 95, 105, 90, 100));
  ok(bViaA.patternB === true && bViaA.patternA === false, 'Pattern B matches via 5A');

  const bVia5B = TC.evaluatePattern(
    c(0, 93, 106, 91, 99),
    c(-H, 92, 103, 90, 100),   // 5A fails: 103 !< 95
    c(-2*H, 90, 95, 88, 94),
    c(-3*H, 90, 102, 88, 99),
    c(-4*H, 90, 100, 88, 98));
  ok(bVia5B.patternB === true, 'Pattern B matches via 5B when 5A fails');

  const none = TC.evaluatePattern(
    c(0, 100, 108, 85, 90),
    c(-H, 105, 110, 90, 95),
    c(-2*H, 95, 115, 90, 100),  // 5A fails (110 !> 115)
    c(-3*H, 95, 116, 90, 100),  // 5B fails (115 !> 116)
    c(-4*H, 95, 117, 90, 100));
  ok(none.patternA === false && none.patternB === false, 'Neither pattern when both 5A and 5B fail');
}

/* ------------------------------------------------------------------ */
console.log('T2 — strict comparisons, flat candles, short history');
{
  const eqHigh = TC.evaluatePattern(
    c(0, 100, 108, 85, 90),
    c(-H, 105, 108, 90, 95),   // high equal to -1's high
    c(-2*H, 95, 102, 90, 100),
    c(-3*H, 95, 101, 90, 100),
    c(-4*H, 95, 100, 90, 100));
  ok(eqHigh.patternA === false, 'Equal highs fail condition 1 strictly');

  const flatC1 = TC.evaluatePattern(
    c(0, 100, 108, 85, 100),   // flat: close == open
    c(-H, 105, 110, 90, 95),
    c(-2*H, 95, 102, 90, 100),
    c(-3*H, 95, 101, 90, 100),
    c(-4*H, 95, 100, 90, 100));
  ok(flatC1.patternA === false && flatC1.patternB === false, 'Flat -1 candle matches neither pattern');

  const flatC2 = TC.evaluatePattern(
    c(0, 100, 108, 85, 90),
    c(-H, 95, 110, 90, 95),    // forward-filled gap candle: flat
    c(-2*H, 95, 102, 90, 100),
    c(-3*H, 95, 101, 90, 100),
    c(-4*H, 95, 100, 90, 100));
  ok(flatC2.patternA === false && flatC2.patternB === false, 'Flat -2 (gap) candle matches neither');

  // only 4 completed candles => every entry Unavailable
  const four = [c(0,1,1,1,1), c(H,2,2,2,2), c(2*H,3,3,3,3), c(3*H,4,4,4,4)];
  const r = TC.evaluate(four, { htfSec: H, sessionEndTick: 4*H - 1 });
  eq(r.size, 4, 'Four completed candles produce four entries');
  ok(Array.from(r.values()).every(v => v.state === TC.STATE.UNAVAILABLE),
     'All four are Unavailable (insufficient history)');
}

/* ------------------------------------------------------------------ */
console.log('T3 — window mapping covers exactly the five candles');
{
  // 8 HTF candles; put the match at k=4 so the full -1..-5 window exists
  const htf = [];
  for (let k = 0; k < 8; k++) htf.push(c(k*H, 95, 100, 90, 100));
  htf[4] = c(4*H, 100, 108, 85, 90);     // -1 red, high 108, low 85
  htf[3] = c(3*H, 105, 110, 90, 95);     // -2 red, high 110 > 108, low 90 > 85
  htf[2] = c(2*H, 95, 102, 90, 100);     // -3
  htf[1] = c(1*H, 95, 101, 90, 100);     // -4
  htf[0] = c(0,    95, 100, 90, 100);     // -5

  const states = TC.evaluate(htf, { htfSec: H, sessionEndTick: 8*H - 1 });
  const matched = Array.from(states.values()).filter(s => s.state === TC.STATE.MATCHED);
  eq(matched.length, 1, 'Exactly one matched state');
  eq(matched[0].closeTime, 5*H, 'Matched state closes at 5*H');
  eq(matched[0].pattern, 'A', 'It is Pattern A');

  const ltf = [];
  for (let n = 0; n < 40; n++) ltf.push(c(n*L, 100, 101, 99, 100));
  const bands = TC.mapToLtf(ltf, states, { htfSec: H, ltfSec: L });
  // mapToLtf returns a state for every LTF bar inside SOME window (incl. Not Matched /
  // Unavailable); only Matched ones draw a band, so filter first.
  const times = Array.from(bands.entries())
    .filter(([, s]) => s.state === TC.STATE.MATCHED)
    .map(([t]) => t).sort((a, b) => a - b);
  // window for closeTime 1500 is (1200, 1500] => closes 1260..1500 => bar times 1200..1440
  eq(times, [1200, 1260, 1320, 1380, 1440],
     'Band covers exactly the five LTF bars in (C_k - H, C_k]');
  eq(times.length, 5, 'Exactly five LTF bars highlighted');
}

/* ------------------------------------------------------------------ */
console.log('T4 — no look-ahead (property test)');
{
  const htf = [];
  for (let k = 0; k < 12; k++) htf.push(c(k*H, 100 + k, 101 + k, 99 + k, 100 + k));
  htf[7] = c(7*H, 100, 108, 85, 90);
  htf[6] = c(6*H, 105, 110, 90, 95);
  htf[5] = c(5*H, 95, 102, 90, 100);
  htf[4] = c(4*H, 95, 101, 90, 100);
  htf[3] = c(3*H, 95, 100, 90, 100);
  const END2 = 12*H - 1;

  for (let t = 0; t <= END2; t += 37) {
    const cut = TC.evaluate(htf, { htfSec: H, sessionEndTick: END2, completedUpTo: t });
    // 1. nothing emitted whose candle was not yet complete at t
    let ok1 = true;
    cut.forEach(v => { if (v.candleTime + H - 1 > t) ok1 = false; });
    ok(ok1, 'no entry at t=' + t + ' uses a candle not complete by t');

    // 2. equals the full-data result restricted to those keys
    const full = TC.evaluate(htf, { htfSec: H, sessionEndTick: END2 });
    let ok2 = true;
    cut.forEach((v, k) => {
      const f = full.get(k);
      if (!f || f.state !== v.state || f.pattern !== v.pattern) ok2 = false;
    });
    ok(ok2, 'truncated result at t=' + t + ' matches full-data result');
  }

  // bands never cover an LTF bar closing after t
  const ltf = [];
  for (let n = 0; n < 12*5; n++) ltf.push(c(n*L, 100, 101, 99, 100));
  let ok3 = true;
  for (let t = 0; t <= END2; t += 61) {
    const cut = TC.evaluate(htf, { htfSec: H, sessionEndTick: END2, completedUpTo: t });
    const bands = TC.mapToLtf(ltf, cut, { htfSec: H, ltfSec: L });
    bands.forEach((s, ltc) => { if (ltc + L > t + H) ok3 = false; });
  }
  ok(ok3, 'no band covers an LTF bar closing beyond t + htfSec');
}

/* ------------------------------------------------------------------ */
console.log('T6 — session boundaries never bleed');
{
  const session = (off) => {
    const a = [];
    for (let k = 0; k < 8; k++) a.push(c(off + k*H, 100, 101, 99, 100));
    a[5] = c(off + 5*H, 100, 108, 85, 90);
    a[4] = c(off + 4*H, 105, 110, 90, 95);
    a[3] = c(off + 3*H, 95, 102, 90, 100);
    a[2] = c(off + 2*H, 95, 101, 90, 100);
    a[1] = c(off + 1*H, 95, 100, 90, 100);
    return a;
  };
  const day1 = session(0), day2 = session(100000);
  const end1 = day1[7].time + H - 1, end2 = day2[7].time + H - 1;

  const s1 = TC.evaluate(day1, { htfSec: H, sessionEndTick: end1 });
  const s2 = TC.evaluate(day2, { htfSec: H, sessionEndTick: end2 });

  ok(Array.from(s1.keys()).every(k => k <= day1[7].time + H), 'Day 1 states stay inside day 1');
  ok(Array.from(s2.keys()).every(k => k >= day2[0].time), 'Day 2 states stay inside day 2');

  const firstFour = s1.get(day1[0].time + H);
  ok(firstFour && firstFour.state === TC.STATE.UNAVAILABLE, 'First candle of the day is Unavailable');
  ok(s1.get(day1[3].time + H).state === TC.STATE.UNAVAILABLE, 'Fourth candle of the day is Unavailable');
  ok(s1.get(day1[4].time + H).state !== TC.STATE.UNAVAILABLE, 'Fifth candle is evaluable');
  ok(s2.get(day2[4].time + H).state !== TC.STATE.UNAVAILABLE, 'Day 2 evaluates independently');
}

/* ------------------------------------------------------------------ */
console.log('T11 — badge / chart single-source eligibility');
{
  const htf = [];
  for (let k = 0; k < 6; k++) htf.push(c(k*H, 100, 101, 99, 100));
  htf[4] = c(4*H, 100, 108, 85, 90);
  htf[3] = c(3*H, 105, 110, 90, 95);
  htf[2] = c(2*H, 95, 102, 90, 100);
  htf[1] = c(1*H, 95, 101, 90, 100);
  htf[0] = c(0,    95, 100, 90, 100);
  const END3 = 5*H + 199;   // session ends mid-bucket => the last candle is PARTIAL

  const states = TC.evaluate(htf, { htfSec: H, sessionEndTick: END3 });

  // the final (partial) candle must produce no entry at all
  ok(!states.has(6*H), 'Partial final candle produces no entry');

  // badge = latest eligible, and it is the same entry the charts use as -1
  const badge = TC.latest(states, END3 + 1);
  ok(badge && badge.closeTime === 4*H + H, 'Badge reads the latest completed candle (5*H)');
  ok(badge.state === TC.STATE.MATCHED && badge.pattern === 'A', 'Badge agrees with the matched state');

  // a band's reveal time equals its candle closeTime
  const ltf = [];
  for (let n = 0; n < 30; n++) ltf.push(c(n*L, 100, 101, 99, 100));
  const bands = TC.mapToLtf(ltf, states, { htfSec: H, ltfSec: L });
  let revealOk = true;
  bands.forEach(s => { if (s.closeTime !== s.candleTime + H) revealOk = false; });
  ok(revealOk, 'Every banded state carries closeTime = candleTime + htfSec');

  // no band for any LTF bar closing after the reveal
  let noAhead = true;
  bands.forEach((s, ltc) => { if (ltc + L > s.closeTime) noAhead = false; });
  ok(noAhead, 'No LTF bar is banded before its reveal time');
}

/* ------------------------------------------------------------------ */
console.log('T12 — completeness predicate against the REAL buildCandles()');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const m = src.match(/function buildCandles\(ticks, tf\) \{[\s\S]*?\n\}/);
  ok(!!m, 'buildCandles() extracted from web/index.html');
  if (!m) { console.error('  cannot continue without the real buildCandles'); process.exit(1); }
  // eslint-disable-next-line no-new-func
  const buildCandles = new Function('return (' + m[0] + ')')();

  const START = 1792727100;
  function ticks(span, gapAt, gapLen) {
    const times = [], prices = [];
    for (let i = 0; i < span; i++) {
      if (gapAt != null && i >= gapAt && i < gapAt + gapLen) continue;
      times.push(START + i); prices.push(100 + Math.sin(i / 7));
    }
    return { times, prices };
  }
  function run(span, tf, gapAt, gapLen) {
    const t = ticks(span, gapAt, gapLen);
    const end = t.times[t.times.length - 1];
    const candles = buildCandles(t, tf);
    const complete = candles.filter(c0 => TC.isComplete(c0, tf, end));
    const dropped = candles.filter(c0 => !TC.isComplete(c0, tf, end));
    return { t, end, candles, complete, dropped };
  }
  const allDroppedAreTrailing = (r) =>
    r.dropped.length === 0 ||
    r.candles.slice(r.candles.length - r.dropped.length).every(c0 => !TC.isComplete(c0, H, r.end));

  // (a) session ends 1s before a boundary => last bucket is FULL, must be kept
  for (const tf of [12, 60, 300]) {
    const r = run(22500, tf);
    const last = r.candles[r.candles.length - 1];
    const ticksInLast = r.t.times.filter(x => x >= last.time && x < last.time + tf).length;
    ok(ticksInLast === tf && r.dropped.length === 0,
       'tf=' + tf + ': fully-covered last bucket kept (ticks=' + ticksInLast + ', dropped=' + r.dropped.length + ')');
  }

  // (b) real-data shape: span 22501 => exactly the trailing bar is partial
  for (const tf of [12, 36, 60, 180, 300, 900, 1500]) {
    const r = run(22501, tf);
    ok(r.dropped.length === 1 && allDroppedAreTrailing(r),
       'tf=' + tf + ': exactly one trailing partial bar dropped');
    ok(r.complete.length === r.candles.length - 1, 'tf=' + tf + ': all other bars kept');
  }

  // (c) interior 11s gap: forward-filled bars are complete and must be kept
  {
    const r = run(22501, 12, 1000, 11);
    ok(r.dropped.length === 1, '12s with interior gap: only the trailing bar dropped');
    ok(r.complete.length === r.candles.length - 1, '12s with interior gap: filled bars kept');
  }

  // (d) gap swallows the final 301s => last real bar is FULL, must be kept
  {
    const r = run(22501, 300, 22200, 301);
    ok(r.dropped.length === 0,
       '5m with tail gap: fully-covered last bar kept (dropped=' + r.dropped.length + ')');
  }

  // (e) counts on the two real files
  for (const [file, key] of [['NIFTY_2026-10-23_DASHBOARD.json', 'nifty_seconds'],
                             ['SENSEX_2026-10-23_DASHBOARD.json', 'sensex_seconds']]) {
    if (!fs.existsSync(path.join(__dirname, '..', 'input', file))) { console.log('  note: input/' + file + ' is not present \u2014 skipped'); continue; }
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'input', file), 'utf8'));
    const pk = d.asset.toLowerCase();
    const t = { times: d[key].map(r => r.timestamp_epoch), prices: d[key].map(r => r[pk]) };
    const end = t.times[t.times.length - 1];
    const expect = { 12: 1875, 36: 625, 60: 375, 180: 125, 300: 75, 900: 25, 1500: 15 };
    for (const tf of Object.keys(expect)) {
      const candles = buildCandles(t, Number(tf));
      const complete = candles.filter(c0 => TC.isComplete(c0, Number(tf), end));
      ok(complete.length === expect[tf],
         d.asset + ' ' + tf + 's: ' + complete.length + ' complete (expected ' + expect[tf] + ')');
    }
  }
}

/* ------------------------------------------------------------------ */
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
