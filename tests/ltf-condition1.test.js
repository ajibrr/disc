#!/usr/bin/env node
/**
 * ltf-condition1.test.js — LTF Condition 1: RSI 50 Cross (Continuation), see docs/design/ltf-conditions-plan.md.
 *
 * After a highlighted Pattern A / B band, every LTF candle inside the search span (the HTF
 * zone's own candles included) whose RSI 14 crosses `level` in the pattern's direction is marked (strict comparisons):
 *   A: previous RSI < level and current RSI > level
 *   B: previous RSI > level and current RSI < level
 *
 * Run: node tests/ltf-condition1.test.js
 * Node-only: no browser, no chart library.
 * The HTF regression gates are the three existing suites:
 *   confirmation.test.js (259)  slope-filter.test.js (139)  sma-rsi-filter.test.js (133)
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

/* ---------------- fixtures ---------------- */

const L = 60;                                              // 1m LTF candles for synthetic data
const candles = (n) => Array.from({ length: n }, (_, i) => ({ time: i * L }));
const CFG = { level: 50, scanCandles: 20 };
const cfgWith = (o) => Object.assign({}, CFG, o);
/** A band over candle indices [i, i+5): from = first candle time, to = HTF close. */
const band = (i, pattern) => ({ from: i * L, to: (i + 5) * L, pattern });
const ev = (rsi, windows, cfg) => TL.evaluateCondition1(candles(rsi.length), rsi, windows, cfg || CFG);
const idxOf = (marks) => marks.map((m) => m.time / L);

/** RSI that sits at 40 everywhere, with overrides: { index: value }. */
const flat = (n, base, over) => {
  const a = new Array(n).fill(base);
  Object.keys(over || {}).forEach((k) => { a[k] = over[k]; });
  return a;
};

/** RSI that is `lo` before index `at` and `hi` from `at` onward (a one-way step). */
const step = (n, lo, hi, at) => Array.from({ length: n }, (_, i) => (i < at ? lo : hi));

/* ------------------------------------------------------------------ */
console.log('\nT41 — config: off / active / error contract');
{
  const good = { condition_1_rsi_cross: { enabled: true, rsi_period: 14, level: 50, scan_candles: 20 } };
  const a = TL.normalizeCondition1(good);
  ok(a.mode === 'active' && a.cfg.rsiPeriod === 14 && a.cfg.level === 50 && a.cfg.scanCandles === 20,
     'valid section -> active with parsed values');
  ok(TL.normalizeCondition1({}).mode === 'off', 'section absent -> off');
  ok(TL.normalizeCondition1({ condition_1_rsi_cross: { enabled: false } }).mode === 'off',
     'enabled:false -> off (other fields inert)');
  ok(TL.normalizeCondition1(undefined).mode === 'error' &&
     /config not generated/.test(TL.normalizeCondition1(undefined).problems[0]),
     'missing ltf-config.js -> error "config not generated"');
  ok(TL.normalizeCondition1('x').mode === 'error', 'non-object config -> error');
  ok(TL.normalizeCondition1({ condition_1_rsi_cross: [] }).mode === 'error', 'array section -> error');
  const bad = (patch) => TL.normalizeCondition1({ condition_1_rsi_cross: Object.assign({}, good.condition_1_rsi_cross, patch) });
  for (const [name, patch, text] of [
    ['enabled not boolean', { enabled: 'yes' }, 'enabled'],
    ['rsi_period 0', { rsi_period: 0 }, 'rsi_period'],
    ['rsi_period fractional', { rsi_period: 14.5 }, 'rsi_period'],
    ['level > 100', { level: 101 }, 'level'],
    ['level negative', { level: -1 }, 'level'],
    ['level NaN', { level: NaN }, 'level'],
    ['scan_candles negative', { scan_candles: -1 }, 'scan_candles'],
    ['scan_candles fractional', { scan_candles: 2.5 }, 'scan_candles'],
  ]) {
    const r = bad(patch);
    ok(r.mode === 'error' && r.cfg === null && r.problems.some((p) => p.indexOf(text) >= 0 &&
       p.indexOf('condition_1_rsi_cross:') === 0), name + ' -> error, section-prefixed problem');
  }
  ok(bad({ scan_candles: 0 }).mode === 'active' && bad({ scan_candles: 0 }).cfg.scanCandles === 0,
     'scan_candles 0 is valid (no limit)');
  ok(bad({ level: 0 }).mode === 'active' && bad({ level: 100 }).mode === 'active', 'level 0 and 100 are valid');
  const shipped = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'ltf.json'), 'utf8'));
  ok(TL.normalizeCondition1(shipped).mode === 'active', 'shipped config/ltf.json validates active');
}

/* Band at index 10 covers candles 10..14 (the HTF zone, to = 15). Crosses on zone candles (10..14) count as well as later ones. */
const path_ = (n, pts) => {                                // piecewise-constant RSI: [[idx, value], ...]
  const a = new Array(n); let v = null, k = 0;
  for (let i = 0; i < n; i++) { while (k < pts.length && pts[k][0] <= i) v = pts[k++][1]; a[i] = v; }
  return a;
};
const jstr = (v) => JSON.stringify(v);

/* ------------------------------------------------------------------ */
console.log('\nT42 — Pattern A: previous < level and current > level');
{
  const m = ev(path_(40, [[0, 40], [17, 55]]), [band(10, 'A')]);
  ok(m.length === 1 && m[0].time === 17 * L && m[0].pattern === 'A', 'A fires on the crossing candle');
  ok(m[0].rsi === 55 && m[0].prevRsi === 40 && m[0].windowCloseTime === 15 * L,
     'mark carries rsi, prevRsi and the band close time');
  ok(ev(path_(40, [[0, 40], [17, 45]]), [band(10, 'A')]).length === 0, 'no cross -> no mark');
  ok(ev(path_(40, [[0, 55]]), [band(10, 'A')]).length === 0, 'always above: no mark (was never below)');
  ok(ev(path_(40, [[0, 40], [17, 55]]), [band(10, 'B')]).length === 0, 'cross UP does not satisfy Pattern B');
}

/* ------------------------------------------------------------------ */
console.log('\nT43 — Pattern B: previous > level and current < level');
{
  const m = ev(path_(40, [[0, 60], [17, 45]]), [band(10, 'B')]);
  ok(m.length === 1 && m[0].time === 17 * L && m[0].pattern === 'B', 'B fires on the crossing candle');
  ok(m[0].rsi === 45 && m[0].prevRsi === 60, 'mark carries rsi and prevRsi');
  ok(ev(path_(40, [[0, 60], [17, 45]]), [band(10, 'A')]).length === 0, 'cross DOWN does not satisfy Pattern A');
  ok(ev(path_(40, [[0, 60]]), [band(10, 'B')]).length === 0, 'always above: no mark');
}

/* ------------------------------------------------------------------ */
console.log('\nT44 — strict comparisons: RSI exactly at the level is neither side');
{
  ok(ev(path_(40, [[0, 49], [16, 50], [17, 51]]), [band(10, 'A')]).length === 0, '49 -> 50 -> 51 is NOT a cross (A)');
  ok(ev(path_(40, [[0, 49], [17, 50.01]]), [band(10, 'A')]).length === 1, '49 -> 50.01 is a cross (A)');
  ok(ev(path_(40, [[0, 49.99], [17, 50.01]]), [band(10, 'A')]).length === 1, '49.99 -> 50.01 is a cross (A)');
  ok(ev(path_(40, [[0, 51], [16, 50], [17, 49]]), [band(10, 'B')]).length === 0, '51 -> 50 -> 49 is NOT a cross (B)');
  ok(ev(path_(40, [[0, 51], [17, 49.99]]), [band(10, 'B')]).length === 1, '51 -> 49.99 is a cross (B)');
  ok(ev(path_(40, [[0, 50]]), [band(10, 'A')]).length === 0, 'RSI parked at exactly 50: nothing');
  ok(ev(path_(40, [[0, 40], [17, 55]]), [band(10, 'A')], cfgWith({ level: 60 })).length === 0,
     'level is honoured (55 does not cross 60)');
  ok(ev(path_(40, [[0, 40], [17, 65]]), [band(10, 'A')], cfgWith({ level: 60 })).length === 1,
     'level is honoured (65 crosses 60)');
}

/* ------------------------------------------------------------------ */
console.log('\nT45 — every cross inside the search span is marked');
{
  const two = path_(40, [[0, 40], [17, 55], [18, 40], [19, 55]]);
  const m = ev(two, [band(10, 'A')]);
  ok(idxOf(m).join() === '17,19', 'both crossings (17 and 19) are marked');
  ok(m.every((x) => x.windowCloseTime === 15 * L), 'both marks belong to the same band');
  ok(ev(path_(40, [[0, 40], [17, 55], [18, 56], [19, 57]]), [band(10, 'A')]).length === 1,
     'staying above 50 after a cross is not a new cross');
  const three = path_(40, [[0, 40], [17, 55], [18, 40], [19, 55], [20, 40], [21, 55]]);
  ok(idxOf(ev(three, [band(10, 'A')])).join() === '17,19,21', 'three crossings -> three marks');
  ok(idxOf(ev(three, [band(10, 'A')], cfgWith({ scanCandles: 10 }))).join() === '17,19',
     'crossings beyond scan_candles are not marked (span 10..19)');
  // the real-world 22-10 NIFTY case: cross (49.95 -> 50.92), dip, second cross (47.54 -> 52.02)
  const real = path_(40, [[0, 45], [16, 49.95], [17, 50.92], [18, 45.64], [19, 42.72], [20, 47.54], [21, 52.02]]);
  ok(idxOf(ev(real, [band(10, 'A')])).join() === '17,21', 'double cross after the zone -> two marks');
}

/* ------------------------------------------------------------------ */
console.log('\nT46 — crosses ON the HTF zone candles count; crosses before the zone do not');
{
  ok(ev(path_(40, [[0, 40], [9, 55], [10, 40]]), [band(10, 'A')]).length === 0, 'a cross BEFORE the band is ignored');
  const first = ev(path_(40, [[0, 40], [10, 55]]), [band(10, 'A')]);
  ok(first.length === 1 && first[0].time === 10 * L && first[0].prevRsi === 40,
     'cross ON the first zone candle counts (previous = the closed candle before the zone)');
  ok(idxOf(ev(path_(40, [[0, 40], [12, 55]]), [band(10, 'A')])).join() === '12', 'cross in the middle of the zone counts');
  ok(idxOf(ev(path_(40, [[0, 40], [14, 55]]), [band(10, 'A')])).join() === '14', 'cross ON the last zone candle counts');
  ok(idxOf(ev(path_(40, [[0, 60], [12, 45]]), [band(10, 'B')])).join() === '12', 'same for Pattern B');
  const inside = path_(40, [[0, 40], [12, 55], [13, 40], [14, 55], [15, 56]]);
  ok(idxOf(ev(inside, [band(10, 'A')])).join() === '12,14', 'two crossings inside the zone -> two marks');
  const after = ev(path_(40, [[0, 40], [15, 55]]), [band(10, 'A')]);
  ok(after.length === 1 && after[0].time === 15 * L && after[0].prevRsi === 40,
     'the first candle after the zone counts too (previous = last zone candle)');
  const mixed = ev(path_(40, [[0, 40], [12, 55], [13, 40], [17, 55]]), [band(10, 'A')]);
  ok(idxOf(mixed).join() === '12,17', 'a zone crossing and a later crossing are both marked');
  ok(ev(path_(40, [[0, 40], [0, 55]]), [{ from: 0, to: 5 * L, pattern: 'A' }]).length === 0,
     'first candle of the session has no previous: no mark');
}

/* ------------------------------------------------------------------ */
console.log('\nT47 — scan_candles (counted from the band\'s first candle, zone included)');
{
  // span with scan 6 = candles 10..15 (5 zone candles + 1 after)
  const c6 = cfgWith({ scanCandles: 6 });
  ok(ev(path_(40, [[0, 40], [15, 55]]), [band(10, 'A')], c6).length === 1, 'cross on the last allowed candle fires');
  ok(ev(path_(40, [[0, 40], [16, 55]]), [band(10, 'A')], c6).length === 0, 'cross one candle later does not');
  const c5s = cfgWith({ scanCandles: 5 });
  ok(idxOf(ev(path_(40, [[0, 40], [12, 55]]), [band(10, 'A')], c5s)).join() === '12', 'scan 5 = the zone only: a cross inside the zone fires');
  ok(ev(path_(40, [[0, 40], [15, 55]]), [band(10, 'A')], c5s).length === 0, 'scan 5: a cross just after the zone is outside the span');
  const c20 = cfgWith({ scanCandles: 20 });
  ok(ev(path_(60, [[0, 40], [29, 55]]), [band(10, 'A')], c20).length === 1, 'scan 20 reaches candle 29');
  ok(ev(path_(60, [[0, 40], [30, 55]]), [band(10, 'A')], c20).length === 0, 'scan 20 stops after candle 29');
  ok(ev(path_(60, [[0, 40], [59, 55]]), [band(10, 'A')], cfgWith({ scanCandles: 0 })).length === 1,
     'scan_candles 0 = unlimited (search reaches the last candle)');
  ok(ev(path_(17, [[0, 40], [16, 55]]), [band(10, 'A')], cfgWith({ scanCandles: 50 })).length === 1,
     'scan span longer than the session clamps at the last candle');
}

/* ------------------------------------------------------------------ */
console.log('\nT48 — multiple bands: each searches on its own; a newer band supersedes an older one');
{
  const m = ev(path_(60, [[0, 40], [17, 55], [18, 40], [37, 55]]), [band(10, 'A'), band(30, 'A')]);
  ok(idxOf(m).join() === '17,37', 'two bands -> a mark after each');
  ok(m[0].windowCloseTime === 15 * L && m[1].windowCloseTime === 35 * L, 'each mark belongs to its own band');
  // adjacent bands: the older search is cut where the newer band starts (candle 15) = its own zone end, so nothing is left
  ok(ev(path_(60, [[0, 40], [17, 55]]), [band(10, 'A'), band(15, 'B')]).length === 0,
     'cross inside the newer (B) zone belongs to neither band');
  const adj2 = ev(path_(60, [[0, 60], [22, 45]]), [band(10, 'A'), band(15, 'B')]);
  ok(adj2.length === 1 && adj2[0].pattern === 'B' && adj2[0].time === 22 * L,
     'the newer B band finds its own cross down after its zone');
  // gap between bands: the older band keeps crossings found before the newer band starts
  const gap = ev(path_(60, [[0, 40], [17, 55]]), [band(10, 'A'), band(20, 'B')]);
  ok(gap.length === 1 && gap[0].pattern === 'A' && gap[0].time === 17 * L,
     'older band keeps a cross found BEFORE the newer band starts');
  ok(ev(path_(60, [[0, 40], [17, 55]]), [band(20, 'B'), band(10, 'A')]).length === 1,
     'band order in the input does not matter');
  const unl = ev(path_(60, [[0, 40], [37, 55]]), [band(10, 'A'), band(30, 'A')], cfgWith({ scanCandles: 0 }));
  ok(unl.length === 1 && unl[0].windowCloseTime === 35 * L,
     'unlimited scan still stops at the next band; the cross belongs to that band');
}

/* ------------------------------------------------------------------ */
console.log('\nT49 — null / non-finite RSI and degenerate inputs');
{
  const prevNull = path_(40, [[0, 40], [17, 55]]); prevNull[16] = null;
  ok(ev(prevNull, [band(10, 'A')]).length === 0, 'previous RSI null (warm-up) -> no cross');
  const curNull = path_(40, [[0, 40]]); curNull[17] = null;
  ok(ev(curNull, [band(10, 'A')]).length === 0, 'current RSI null -> no cross');
  const nan = path_(40, [[0, 40]]); nan[17] = NaN;
  ok(ev(nan, [band(10, 'A')]).length === 0, 'NaN RSI never crosses');
  const brk = path_(40, [[0, 40], [17, 55], [18, 40], [19, 56]]); brk[16] = null;
  ok(idxOf(ev(brk, [band(10, 'A')])).join() === '19', 'a null breaks the pair; the search continues to the next valid crossing');
  ok(TL.evaluateCondition1([], [], [band(0, 'A')], CFG).length === 0, 'no candles -> no marks');
  ok(ev(path_(40, [[0, 40], [17, 55]]), []).length === 0, 'no windows -> no marks');
  ok(TL.evaluateCondition1(candles(5), path_(5, [[0, 40]]), [{ from: 99 * L, to: 104 * L, pattern: 'A' }], CFG).length === 0,
     'band starting after the last candle -> no marks');
  ok(idxOf(TL.evaluateCondition1(candles(12), path_(12, [[0, 40], [11, 55]]), [band(10, 'A')], CFG)).join() === '11',
     'session ends inside the zone: a cross on a zone candle is still marked');
}

/* ------------------------------------------------------------------ */
console.log('\nT50 — no look-ahead: a mark depends only on RSI at i and i-1');
{
  const base = path_(40, [[0, 40], [17, 55]]);
  const full = ev(base, [band(10, 'A')]);
  const future = base.slice(); for (let i = 18; i < 40; i++) future[i] = (i % 2 ? 10 : 90);
  const f2 = ev(future, [band(10, 'A')]);
  const upTo17 = (ms) => ms.filter((m) => m.time <= 17 * L);
  ok(jstr(upTo17(f2)) === jstr(full), 'changing every RSI after candle 17 does not change the mark at candle 17');
  ok(f2.length > full.length, 'later crossings appear as their own marks, never altering earlier ones');
  const truncated = TL.evaluateCondition1(candles(18), base.slice(0, 18), [band(10, 'A')], CFG);
  ok(jstr(full) === jstr(truncated), 'evaluating on data truncated at the crossing candle gives the same mark');
}

/* ------------------------------------------------------------------ */
console.log('\nT51 — real data: RSI source equals the plotted RSI; condition runs on every LTF pair');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const mBc = src.match(/function buildCandles\(ticks, tf\) \{[\s\S]*?\n\}/);
  const mRsi = src.match(/function rsi\(closes, period = 14\) \{[\s\S]*?\n\}/);
  ok(!!mBc && !!mRsi, 'real buildCandles() and rsi() extracted from web/index.html');
  if (!mBc || !mRsi) { console.error('  cannot continue'); process.exit(1); }
  const buildCandles = new Function('return (' + mBc[0] + ')')();
  const rsiReal = new Function('return (' + mRsi[0] + ')')();
  const HTF_OF = { 12: 60, 36: 180, 60: 300, 180: 900, 300: 1500 };
  const files = [['NIFTY_2026-10-23_DASHBOARD.json', 'nifty_seconds'],
                 ['SENSEX_2026-10-23_DASHBOARD.json', 'sensex_seconds']];
  let eqAll = true, markCount = 0, sane = true;
  for (const [file, key] of files) {
    if (!fs.existsSync(path.join(__dirname, '..', 'input', file))) { console.log('  note: input/' + file + ' is not present \u2014 skipped'); continue; }
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'input', file), 'utf8'));
    const pk = d.asset.toLowerCase();
    const ticks = { times: d[key].map((r) => r.timestamp_epoch), prices: d[key].map((r) => r[pk]) };
    const lastTick = ticks.times[ticks.times.length - 1];
    for (const ltf of Object.keys(HTF_OF).map(Number)) {
      const htf = HTF_OF[ltf];
      const lc = buildCandles(ticks, ltf);
      const closes = lc.map((x) => x.close);
      const plotted = rsiReal(closes, 14);
      const mine = TC.rsiArray(closes, 14);
      if (JSON.stringify(plotted) !== JSON.stringify(mine)) eqAll = false;
      const states = TC.evaluate(buildCandles(ticks, htf), { htfSec: htf, sessionEndTick: lastTick });
      const windows = [];
      states.forEach((s) => {
        if (s.state === TC.STATE.MATCHED) windows.push({ from: s.closeTime - htf, to: s.closeTime, pattern: s.pattern });
      });
      const marks = TL.evaluateCondition1(lc, mine, windows, { level: 50, scanCandles: 20 });
      markCount += marks.length;
      const times = new Set(lc.map((x) => x.time));
      for (const m of marks) {
        const i = lc.findIndex((x) => x.time === m.time);
        const w = windows.find((x) => x.to === m.windowCloseTime);
        const crossed = m.pattern === 'A' ? (mine[i - 1] < 50 && mine[i] > 50) : (mine[i - 1] > 50 && mine[i] < 50);
        if (!times.has(m.time) || !w || w.pattern !== m.pattern || !crossed || i < 1) sane = false;
        if (m.time < w.from) sane = false;
      }
      // marks ascend in time and every mark lies inside its own band's search span
      for (let q = 1; q < marks.length; q++) if (!(marks[q].time > marks[q - 1].time)) sane = false;
      const spanOk = marks.every((m) => {
        const w = windows.find((x) => x.to === m.windowCloseTime);
        const s0 = lc.findIndex((x) => x.time >= w.from);
        const i = lc.findIndex((x) => x.time === m.time);
        return i >= s0 && i < s0 + 20;
      });
      if (!spanOk) sane = false;
    }
  }
  ok(eqAll, 'TC.rsiArray equals the plotted rsi() element for element (NIFTY + SENSEX, all 5 LTFs)');
  ok(sane, 'every real mark is a genuine strict cross, inside its own band\'s search span (zone candles included), ascending in time');
  console.log('  info: ' + markCount + ' marks across NIFTY + SENSEX x 5 LTF pairs');
}

/* ------------------------------------------------------------------ */
console.log('\nT52 — browser wiring (static source assertions; live checks in the preview)');
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  ok(/<script src="generated\/ltf-config\.js"><\/script>/.test(html) && /<script src="\.\.\/src\/ltf-conditions\.js"><\/script>/.test(html),
     'page loads ltf-config.js and ltf-conditions.js');
  ok(/TL\.normalizeCondition1\(window\.LTF_CONFIG\)/.test(html), 'config normalized from window.LTF_CONFIG');
  ok(/TL\.runChain\(/.test(html) && /c1: LTF_COND1/.test(html), 'applyConfirmation evaluates Condition 1 through the shared chain (TL.runChain)');
  ok(/id="ltf-toggle"/.test(html), 'LTF Conditions toggle present');
  ok(/arrowUp/.test(html) && /arrowDown/.test(html), 'arrow shapes used for markers');
  console.log('  manual (done in the preview): arrows below A / above B crossing candles; readout chip; toggle clears');
  console.log('  only these arrows; invalid ltf.json -> visible config error and no arrows; all 5 pairs; NIFTY + SENSEX.');
}

/* ------------------------------------------------------------------ */
console.log('\nT47b — scan RANGE: scan_min_candles .. scan_max_candles (position 1 = the band\'s first candle)');
{
  // band starts at candle 10 (position 1 = index 10, position 5 = index 14, position 6 = index 15, position 20 = index 29)
  const good = (patch) => ({ condition_1_rsi_cross: Object.assign({ enabled: true, rsi_period: 14, level: 50, scan_min_candles: 1, scan_max_candles: 20 }, patch) });
  const n1 = TL.normalizeCondition1(good({}));
  ok(n1.mode === 'active' && n1.cfg.scanMin === 1 && n1.cfg.scanMax === 20 && n1.cfg.scanCandles === 20, 'scan_min_candles / scan_max_candles are read (and scanCandles stays the maximum)');
  ok(TL.normalizeCondition1(good({ scan_min_candles: undefined })).cfg.scanMin === 1, 'a missing scan_min_candles defaults to 1');
  ok(TL.normalizeCondition1({ condition_1_rsi_cross: { enabled: true, rsi_period: 14, level: 50, scan_candles: 15 } }).cfg.scanMax === 15, 'the older single scan_candles is still read as the maximum');
  ok(TL.normalizeCondition1(good({ scan_max_candles: 12, scan_candles: 99 })).cfg.scanMax === 12, 'scan_max_candles wins over the older scan_candles');
  for (const [name, patch, text] of [
    ['min zero', { scan_min_candles: 0 }, 'scan_min_candles'],
    ['min fractional', { scan_min_candles: 1.5 }, 'scan_min_candles'],
    ['min above max', { scan_min_candles: 8, scan_max_candles: 5 }, 'must not be larger'],
    ['max negative', { scan_max_candles: -1 }, 'scan_max_candles'],
  ]) {
    const r = TL.normalizeCondition1(good(patch));
    ok(r.mode === 'error' && r.problems.some((p) => p.indexOf(text) >= 0 && p.indexOf('condition_1_rsi_cross:') === 0), name + ' -> error, prefixed problem');
  }
  ok(TL.normalizeCondition1(good({ scan_min_candles: 5, scan_max_candles: 0 })).mode === 'active', 'a maximum of 0 (no limit) is fine with any minimum');

  // one clean crossing at a chosen index: RSI 40 before, 60 from `at` on
  const stepAt = (at) => step(60, 40, 60, at);
  const run = (at, cfg) => idxOf(ev(stepAt(at), [band(10, 'A')], cfgWith(cfg)));
  ok(run(14, { scanMin: 1, scanMax: 20 }).join() === '14', 'a crossing at position 5 passes the full range 1..20');
  ok(run(14, { scanMin: 6, scanMax: 20 }).length === 0, 'with a minimum of 6, a crossing at position 5 is too early');
  ok(run(15, { scanMin: 6, scanMax: 20 }).join() === '15', 'a crossing exactly at the minimum (position 6) passes');
  ok(run(29, { scanMin: 6, scanMax: 20 }).join() === '29', 'a crossing exactly at the maximum (position 20) passes');
  ok(run(30, { scanMin: 6, scanMax: 20 }).length === 0, 'a crossing at position 21 is too late');
  ok(run(20, { scanMin: 6, scanMax: 10 }).length === 0 && run(18, { scanMin: 6, scanMax: 10 }).join() === '18', 'a narrow range 6..10: position 11 fails, position 9 passes');
  ok(run(14, { scanMin: 1, scanMax: 20, scanCandles: 20 }).join() === '14', 'old-style config (scanCandles only) still works');
}

/* ------------------------------------------------------------------ */
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
