#!/usr/bin/env node
/**
 * ltf-condition6.test.js — LTF Condition 6: risk range (config/ltf.json -> condition_6_risk_range).
 *
 *   The risk of a trade is the E candle distance. A C5 mark survives only when  min_risk_points <= eDistance < max_risk_points,
 *   the same range for Pattern A (long) and Pattern B (short). It sits after C5 in the chain, so the full signal
 *   becomes C1+C2+C3+C4+C5+C6 and every trade's risk is inside the range.
 *
 * Run: node tests/ltf-condition6.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const TL = require('../src/ltf-conditions.js');
const TS = require('../src/strategies.js');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.error('  ✗ FAIL — ' + label); }
}
const root = path.join(__dirname, '..');
const shipped = JSON.parse(fs.readFileSync(path.join(root, 'config', 'ltf.json'), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));

console.log('\nT130 — configuration (off / active / error, fail closed)');
{
  const n = TL.normalizeCondition6(shipped);
  ok(n.mode === 'active' && n.cfg.minRisk === 3.5 && n.cfg.maxRisk === 8, 'shipped config/ltf.json: active, min_risk_points 3.5, max_risk_points 8');
  ok(TL.normalizeCondition6({}).mode === 'off', 'section absent -> off');
  ok(TL.normalizeCondition6({ condition_6_risk_range: { enabled: false, min_risk_points: 2, max_risk_points: 6 } }).mode === 'off', 'enabled:false -> off');
  ok(TL.normalizeCondition6(null).mode === 'error' && TL.normalizeCondition6(7).mode === 'error', 'missing / non-object config -> error');
  ok(TL.normalizeCondition6({ condition_6_max_risk: { enabled: true, max_risk_points: 5 } }).mode === 'off', 'the old condition_6_max_risk section is no longer read (a stale key cannot switch the rule on)');
  for (const [name, patch, text] of [
    ['enabled not boolean', { enabled: 'yes' }, 'enabled'],
    ['zero maximum', { max_risk_points: 0 }, 'max_risk_points'],
    ['negative maximum', { max_risk_points: -1 }, 'max_risk_points'],
    ['string maximum', { max_risk_points: '6' }, 'max_risk_points'],
    ['missing maximum', { max_risk_points: undefined }, 'max_risk_points'],
    ['negative minimum', { min_risk_points: -0.5 }, 'min_risk_points'],
    ['string minimum', { min_risk_points: '2' }, 'min_risk_points'],
    ['missing minimum', { min_risk_points: undefined }, 'min_risk_points'],
    ['maximum equal to minimum', { min_risk_points: 6, max_risk_points: 6 }, 'greater than'],
    ['maximum below minimum', { min_risk_points: 7, max_risk_points: 6 }, 'greater than'],
  ]) {
    const r = TL.normalizeCondition6({ condition_6_risk_range: Object.assign({ enabled: true, min_risk_points: 2, max_risk_points: 6 }, patch) });
    ok(r.mode === 'error' && r.cfg === null && r.problems.some((p) => p.indexOf(text) >= 0 && p.indexOf('condition_6_risk_range:') === 0), name + ' -> error, prefixed problem');
  }
  ok(TL.normalizeCondition6({ condition_6_risk_range: { enabled: true, min_risk_points: 0, max_risk_points: 6 } }).mode === 'active', 'a minimum of 0 is allowed (then only the maximum matters)');
}

console.log('\nT131 — the rule: min <= eDistance < max, both patterns');
{
  const marks = [
    { time: 1, pattern: 'A', eDistance: 1.9 }, { time: 2, pattern: 'A', eDistance: 2 }, { time: 3, pattern: 'A', eDistance: 5.9 },
    { time: 4, pattern: 'B', eDistance: 1.9 }, { time: 5, pattern: 'B', eDistance: 2 }, { time: 6, pattern: 'B', eDistance: 6 },
    { time: 7, pattern: 'A' }, { time: 8, pattern: 'B', eDistance: NaN }, { time: 9, pattern: 'A', eDistance: 12 }, { time: 10, pattern: 'B', eDistance: 3.5 },
  ];
  const out = TL.evaluateCondition6(marks, { minRisk: 2, maxRisk: 6 });
  ok(out.map((m) => m.time).join() === '2,3,5,10', 'passes 2 (lower edge inclusive), 5.9, 2 and 3.5; fails 1.9, 6 (upper edge exclusive), 12, missing and NaN');
  ok(out.filter((m) => m.pattern === 'A').length === 2 && out.filter((m) => m.pattern === 'B').length === 2, 'the same range applies to long (A) and short (B)');
  ok(TL.evaluateCondition6([], { minRisk: 2, maxRisk: 6 }).length === 0 && TL.evaluateCondition6(null, { minRisk: 2, maxRisk: 6 }).length === 0, 'empty / missing input gives nothing and never throws');
  ok(TL.evaluateCondition6(marks, { minRisk: 0, maxRisk: 100 }).length === 8, 'a minimum of 0 and a big maximum lets every mark with a usable distance through (8 of 10)');
}

console.log('\nT132 — combineMarks and runChain');
{
  const mk = (t, p) => ({ time: t, pattern: p, windowCloseTime: 100 });
  const c1 = [mk(1, 'A'), mk(2, 'B'), mk(3, 'A')];
  const c5 = [Object.assign(mk(1, 'A'), { eDistance: 3 }), Object.assign(mk(2, 'B'), { eDistance: 9 })];
  const c6 = [c5[0]];
  const comb = TL.combineMarks(c1, c1, c1, c1, c5, c6);
  ok(comb.map((m) => m.kind).join() === 'C1+C2+C3+C4+C5+C6,C1+C2+C3+C4+C5,C1+C2+C3+C4',
     'a mark in C6 is C1..C6, a C5-only mark stays C1..C5, one that never reached C5 stays at its level');
  ok(TL.combineMarks(c1, c1, c1, c1, c5).map((m) => m.kind).join() === 'C1+C2+C3+C4+C5,C1+C2+C3+C4+C5,C1+C2+C3+C4', 'without C6 the kinds are exactly as before (C6 is optional)');
  const src = fs.readFileSync(path.join(root, 'src', 'ltf-conditions.js'), 'utf8');
  ok(/a6 = a5 && active\(cfgs\.c6\)/.test(src) && /fullKind/.test(src), 'runChain only applies C6 on top of an active C5 and names the full-signal kind');
  const off = TL.runChain([], [], { c1: { mode: 'off' } }, () => []);
  ok(off.fullKind === null && Array.isArray(off.c6), 'an inactive chain has no full kind and an empty c6');
}

console.log('\nT133 — SB_Bhanusali trades only C6 signals, so every trade risks less than the limit');
{
  const reg = TS.normalizeRegistry(JSON.parse(fs.readFileSync(path.join(root, 'config', 'strategies.json'), 'utf8')));
  const sb = reg.byName.SB_Bhanusali;
  const marks = [
    { time: 1, kind: 'C1+C2+C3+C4+C5+C6', pattern: 'A', eDistance: 3 },
    { time: 2, kind: 'C1+C2+C3+C4+C5', pattern: 'B', eDistance: 9 },
  ];
  const withC6 = TS.signalsFor(sb, { chain: { marks, fullKind: 'C1+C2+C3+C4+C5+C6' } });
  ok(withC6.length === 1 && withC6[0].time === 1, 'with C6 active only the C1..C6 mark is a signal (the C1..C5 mark with risk 9 is not traded)');
  const noC6 = TS.signalsFor(sb, { chain: { marks: [{ time: 2, kind: 'C1+C2+C3+C4+C5', pattern: 'B', eDistance: 9 }], fullKind: 'C1+C2+C3+C4+C5' } });
  ok(noC6.length === 1, 'with C6 off (fullKind C1..C5) the C1..C5 mark is the signal as before');
}

console.log('\nT134 — wiring (static source assertions)');
{
  const html = fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8');
  const bt = fs.readFileSync(path.join(root, 'scripts', 'run-backtest.js'), 'utf8');
  ok(/TL\.normalizeCondition6\(window\.LTF_CONFIG\)/.test(html) && /c6: LTF_COND6/.test(html), 'the page normalizes C6 and passes it to the shared chain');
  ok(/C1\+C2\+C3\+C4\+C5\+C6/.test(html), 'the page draws a C1..C6 arrow');
  ok(/c6: TL\.normalizeCondition6\(ltfCfgRaw\)/.test(bt), 'the back-test runner passes C6 to the chain');
  const pine = fs.readFileSync(path.join(root, 'pine', 'htf_ltf_strategy.pine'), 'utf8');
  ok(/minRisk/.test(pine) && /maxRisk/.test(pine), 'the Pine port has the min and max risk inputs');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
