#!/usr/bin/env node
/**
 * ltf-condition4.test.js — LTF Condition 4: SMA-of-RSI extreme in the previous candles, see ltf.md.
 *
 * Keeps a C1+C2+C3 mark only when ANY ONE of the `lookback` candles immediately BEFORE the marked
 * candle (itself excluded) has SMA(14) of RSI(14):
 *   Pattern A: > 67.5        Pattern B: < 32.5        (strict)
 *
 * Run: node tests/ltf-condition4.test.js
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

const L = 60;
const CFG = { rsiPeriod: 14, smaPeriod: 14, lookback: 20, aAbove: 67.5, bBelow: 32.5 };
const candles = (n) => Array.from({ length: n }, (_, i) => ({ time: i * L, close: 100 }));
const mk = (i, pattern) => ({ time: i * L, pattern, rsi: 55, prevRsi: 45, windowCloseTime: 0, spreadPct: 0.01 });
/** SMA-of-RSI series: `base` everywhere, with overrides { index: value }. */
const series = (n, base, over) => { const a = new Array(n).fill(base); Object.keys(over || {}).forEach((k) => { a[k] = over[k]; }); return a; };
const ev = (n, marks, sma, cfg) => TL.evaluateCondition4(candles(n), marks, sma, cfg || CFG);

/* ------------------------------------------------------------------ */
console.log('\nT74 — config: off / active / error contract');
{
  const good = { condition_4_rsi_sma_extreme: { enabled: true, rsi_period: 14, sma_period: 14, lookback_candles: 20, pattern_a_above: 67.5, pattern_b_below: 32.5 } };
  const a = TL.normalizeCondition4(good);
  ok(a.mode === 'active' && a.cfg.rsiPeriod === 14 && a.cfg.smaPeriod === 14 && a.cfg.lookback === 20 &&
     a.cfg.aAbove === 67.5 && a.cfg.bBelow === 32.5, 'valid section -> active with parsed values');
  ok(TL.normalizeCondition4({}).mode === 'off', 'section absent -> off');
  ok(TL.normalizeCondition4({ condition_4_rsi_sma_extreme: { enabled: false } }).mode === 'off', 'enabled:false -> off');
  ok(TL.normalizeCondition4(undefined).mode === 'error' &&
     /config not generated/.test(TL.normalizeCondition4(undefined).problems[0]), 'missing ltf-config.js -> error "config not generated"');
  ok(TL.normalizeCondition4('x').mode === 'error', 'non-object config -> error');
  ok(TL.normalizeCondition4({ condition_4_rsi_sma_extreme: [] }).mode === 'error', 'array section -> error');
  const bad = (patch) => TL.normalizeCondition4({ condition_4_rsi_sma_extreme: Object.assign({}, good.condition_4_rsi_sma_extreme, patch) });
  for (const [name, patch, text] of [
    ['enabled not boolean', { enabled: 1 }, 'enabled'],
    ['rsi_period 0', { rsi_period: 0 }, 'rsi_period'],
    ['rsi_period fractional', { rsi_period: 14.5 }, 'rsi_period'],
    ['sma_period negative', { sma_period: -1 }, 'sma_period'],
    ['lookback 0', { lookback_candles: 0 }, 'lookback_candles'],
    ['lookback missing', { lookback_candles: undefined }, 'lookback_candles'],
    ['pattern_a_above > 100', { pattern_a_above: 101 }, 'pattern_a_above'],
    ['pattern_a_above NaN', { pattern_a_above: NaN }, 'pattern_a_above'],
    ['pattern_b_below negative', { pattern_b_below: -1 }, 'pattern_b_below'],
    ['pattern_b_below string', { pattern_b_below: '32.5' }, 'pattern_b_below'],
    ['thresholds equal', { pattern_b_below: 67.5 }, 'smaller'],
    ['thresholds crossed', { pattern_b_below: 80 }, 'smaller'],
  ]) {
    const r = bad(patch);
    ok(r.mode === 'error' && r.cfg === null && r.problems.some((p) => p.indexOf(text) >= 0 &&
       p.indexOf('condition_4_rsi_sma_extreme:') === 0), name + ' -> error, section-prefixed problem');
  }
  const shipped = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'ltf.json'), 'utf8'));
  const sc = TL.normalizeCondition4(shipped);
  ok(sc.mode === 'active' && sc.cfg.lookbackMin === 1 && sc.cfg.lookbackMax === 20 && sc.cfg.aMin === 67.5 && sc.cfg.aMax === 100 && sc.cfg.bMin === 0 && sc.cfg.bMax === 32.5,
     'shipped config/ltf.json = candles 1..20 back, A 67.5..100 / B 0..32.5, active');
  ok([1, 2, 3].every((n) => TL['normalizeCondition' + n](shipped).mode === 'active'), 'Conditions 1-3 still validate alongside it');
}

/* ------------------------------------------------------------------ */
console.log('\nT75 — Pattern A: any one of the previous 20 candles > 67.5');
{
  const N = 60, I = 40;                                           // mark at index 40 => window 20..39
  const run = (over) => ev(N, [mk(I, 'A')], series(N, 50, over)).length;
  ok(run({ 30: 67.51 }) === 1, 'one candle at 67.51 inside the window passes');
  ok(run({ 30: 67.5 }) === 0, 'exactly 67.50 fails (strict)');
  ok(run({}) === 0, 'no candle above the threshold fails');
  ok(run({ 39: 80 }) === 1, 'the candle immediately before the mark counts');
  ok(run({ 20: 80 }) === 1, 'the 20th candle back (index 20) counts');
  ok(run({ 19: 80 }) === 0, 'the 21st candle back (index 19) does NOT count');
  ok(run({ 40: 80 }) === 0, 'the marked candle itself does NOT count (Q2)');
  ok(run({ 41: 99, 50: 99 }) === 0, 'candles AFTER the mark never count (no look-ahead)');
  ok(run({ 25: 10 }) === 0, 'a very low value does not help Pattern A');
  const m = ev(N, [mk(I, 'A')], series(N, 50, { 28: 70, 33: 69 }))[0];
  ok(m.hitTime === 33 * L && m.hitValue === 69, 'hit fields point at the MOST RECENT qualifying candle');
  ok(m.rsi === 55 && m.spreadPct === 0.01 && m.windowCloseTime === 0, 'original mark fields are carried through');
}

/* ------------------------------------------------------------------ */
console.log('\nT76 — Pattern B: any one of the previous 20 candles < 32.5');
{
  const N = 60, I = 40;
  const run = (over) => ev(N, [mk(I, 'B')], series(N, 50, over)).length;
  ok(run({ 30: 32.49 }) === 1, 'one candle at 32.49 inside the window passes');
  ok(run({ 30: 32.5 }) === 0, 'exactly 32.50 fails (strict)');
  ok(run({}) === 0, 'no candle below the threshold fails');
  ok(run({ 39: 10 }) === 1, 'the candle immediately before the mark counts');
  ok(run({ 20: 10 }) === 1, 'the 20th candle back counts');
  ok(run({ 19: 10 }) === 0, 'the 21st candle back does NOT count');
  ok(run({ 40: 10 }) === 0, 'the marked candle itself does NOT count');
  ok(run({ 30: 90 }) === 0, 'a very high value does not help Pattern B');
  const both = series(N, 50, { 30: 80, 31: 10 });
  ok(ev(N, [mk(I, 'A'), mk(I, 'B')], both).map((x) => x.pattern).join() === 'A,B', 'A and B are judged by their own direction');
  ok(ev(N, [mk(I, 'A')], series(N, 50, { 31: 10 })).length === 0 && ev(N, [mk(I, 'B')], series(N, 50, { 31: 80 })).length === 0,
     'an A-extreme never satisfies B and vice versa');
}

/* ------------------------------------------------------------------ */
console.log('\nT77 — lookback is configurable; early session; warm-up; degenerate inputs');
{
  const N = 60;
  ok(ev(N, [mk(40, 'A')], series(N, 50, { 35: 80 }), Object.assign({}, CFG, { lookback: 5 })).length === 1, 'lookback 5: hit 5 candles back passes');
  ok(ev(N, [mk(40, 'A')], series(N, 50, { 34: 80 }), Object.assign({}, CFG, { lookback: 5 })).length === 0, 'lookback 5: hit 6 candles back fails');
  ok(ev(N, [mk(40, 'A')], series(N, 50, { 20: 80 }), Object.assign({}, CFG, { lookback: 50 })).length === 1, 'lookback 50 reaches further back');
  ok(ev(N, [mk(40, 'A')], series(N, 50, { 0: 80 }), Object.assign({}, CFG, { lookback: 500 })).length === 1, 'lookback beyond the session clamps at candle 0');
  ok(ev(N, [mk(10, 'A')], series(N, 50, { 2: 80 })).length === 1, 'early session (fewer than 20 candles before): uses what exists');
  ok(ev(N, [mk(0, 'A')], series(N, 80, {})).length === 0, 'mark on the very first candle: nothing before it -> fails');
  const warm = series(N, null, {}); warm[30] = 80;
  ok(ev(N, [mk(40, 'A')], warm).length === 1, 'null values are skipped; a later valid value still counts');
  ok(ev(N, [mk(40, 'A')], series(N, null, {})).length === 0, 'all values null (still warming up) -> fails');
  ok(ev(N, [mk(40, 'A')], series(N, 50, { 30: NaN })).length === 0, 'NaN never passes');
  ok(ev(N, [mk(40, 'A')], series(N, 50, { 30: Infinity })).length === 0, 'non-finite never passes');
  ok(ev(N, [], series(N, 80, {})).length === 0, 'no C3 marks -> no C4 marks');
  ok(TL.evaluateCondition4([], [mk(1, 'A')], [], CFG).length === 0, 'no candles -> no C4 marks');
  ok(ev(N, [{ time: 99999, pattern: 'A' }], series(N, 80, {})).length === 0, 'mark whose candle does not exist is dropped');
  const input = [mk(40, 'A')];
  const out = ev(N, input, series(N, 50, { 30: 80 }));
  ok(out.length === 1 && out[0].time === input[0].time && input[0].hitTime === undefined, 'output is a subset of the input and the input is not mutated');
}

/* ------------------------------------------------------------------ */
console.log('\nT78 — smaNullableArray mirrors the plotted smaNullable');
{
  const r = TL.smaNullableArray([null, null, 1, 2, 3, 4], 3);
  ok(r[0] === null && r[1] === null && r[2] === null && r[3] === null, 'null until a full window of non-null values exists');
  ok(r[4] === 2 && r[5] === 3, 'then the plain mean (2, 3)');
  ok(TL.smaNullableArray([1, 2, 3], 5).every((v) => v === null), 'period longer than the data -> all null');
  const rsi = TC.rsiArray(Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5), 14);
  const sm = TL.smaNullableArray(rsi, 14);
  ok(sm.findIndex((v) => v !== null) === 27, 'SMA 14 of RSI 14 first exists at index 27 (the 28th candle)');
}

/* ------------------------------------------------------------------ */
console.log('\nT79 — combineMarks with four kinds: still ONE entry per C1 mark');
{
  const c1 = [mk(1, 'A'), mk(2, 'A'), mk(3, 'A'), mk(4, 'A'), mk(5, 'B')];
  const c2 = c1.slice(1, 4).map((m) => Object.assign({}, m, { smaFast: 2, smaSlow: 1 }));
  const c3 = c2.slice(1).map((m) => Object.assign({}, m, { spreadPct: 0.01 }));
  const c4 = [Object.assign({}, c3[1], { hitTime: 0, hitValue: 70 })];
  const comb = TL.combineMarks(c1, c2, c3, c4);
  ok(comb.length === c1.length, 'exactly one entry per C1 mark');
  ok(comb.map((m) => m.kind).join() === 'C1,C1+C2,C1+C2+C3,C1+C2+C3+C4,C1', 'kind = highest condition level the candle reached');
  ok(comb[3].hitValue === 70 && comb[2].hitValue === undefined, 'C1+C2+C3+C4 entries carry the hit fields; lower kinds do not');
  ok(TL.combineMarks(c1, c2, c3).map((m) => m.kind).join() === 'C1,C1+C2,C1+C2+C3,C1+C2+C3,C1', 'three-argument form (no C4) behaves as before');
  ok(TL.combineMarks(c1, c2).map((m) => m.kind).join() === 'C1,C1+C2,C1+C2,C1+C2,C1', 'two-argument form behaves as before');
  ok(TL.combineMarks(c1, c2, [], c4).map((m) => m.kind).join() === 'C1,C1+C2,C1+C2,C1+C2,C1', 'a C4 mark without its C3 mark is not promoted (C4 only ever refines C3)');
}

/* ------------------------------------------------------------------ */
console.log('\nT80 — real data: SMA-of-RSI equals the plotted line; every kept / dropped mark is classified correctly');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const mBc = src.match(/function buildCandles\(ticks, tf\) \{[\s\S]*?\n\}/);
  const mSma = src.match(/function smaNullable\(values, period\) \{[\s\S]*?\n\}/);
  const mRsi = src.match(/function rsi\(closes, period = 14\) \{[\s\S]*?\n\}/);
  if (!mBc || !mSma || !mRsi) { ok(false, 'extract page functions'); process.exit(1); }
  const buildCandles = new Function('return (' + mBc[0] + ')')();
  const smaPlotted = new Function('return (' + mSma[0] + ')')();
  const rsiPlotted = new Function('return (' + mRsi[0] + ')')();
  const HTF_OF = { 12: 60, 36: 180, 60: 300, 180: 900, 300: 1500 };
  const c2cfg = { fastPeriod: 9, slowPeriod: 44 }, band = { minPct: 0, maxPct: 0.02 };
  let eq = true, keptOk = true, droppedOk = true, subset = true, n3 = 0, n4 = 0, hitOk = true;
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
      const mine = TL.smaNullableArray(TC.rsiArray(closes, 14), 14);
      const plotted = smaPlotted(rsiPlotted(closes, 14), 14);
      for (let i = 0; i < mine.length; i++) {
        if ((mine[i] === null) !== (plotted[i] === null) || (mine[i] !== null && Math.abs(mine[i] - plotted[i]) > 1e-9)) eq = false;
      }
      const states = TC.evaluate(buildCandles(ticks, htf), { htfSec: htf, sessionEndTick: last });
      const wins = [];
      states.forEach((st) => { if (st.state === TC.STATE.MATCHED) wins.push({ from: st.closeTime - htf, to: st.closeTime, pattern: st.pattern }); });
      const c1 = TL.evaluateCondition1(lc, TC.rsiArray(closes, 14), wins, { level: 50, scanCandles: 20 });
      const c2 = TL.evaluateCondition2(lc, c1, c2cfg);
      const c3 = TL.evaluateCondition3(lc, c2, band, c2cfg);
      const c4 = TL.evaluateCondition4(lc, c3, mine, CFG);
      n3 += c3.length; n4 += c4.length;
      const expect = (m) => {                                    // independent brute-force classification
        const i = lc.findIndex((x) => x.time === m.time);
        for (let j = Math.max(0, i - 20); j < i; j++) {
          const v = plotted[j];
          if (v !== null && (m.pattern === 'A' ? v > 67.5 : v < 32.5)) return true;
        }
        return false;
      };
      for (const m of c4) {
        if (!expect(m)) keptOk = false;
        if (!c3.some((x) => x.time === m.time && x.pattern === m.pattern)) subset = false;
        const hj = lc.findIndex((x) => x.time === m.hitTime), mi = lc.findIndex((x) => x.time === m.time);
        if (!(hj >= mi - 20 && hj < mi) || mine[hj] !== m.hitValue) hitOk = false;
      }
      for (const m of c3) if (!c4.some((x) => x.time === m.time && x.pattern === m.pattern) && expect(m)) droppedOk = false;
    }
  }
  ok(eq, 'SMA-of-RSI used by C4 equals the plotted SMA 14 of RSI (NIFTY + SENSEX, all 5 LTFs)');
  ok(keptOk, 'every kept C4 mark has a genuine extreme in the previous 20 candles (brute-force check)');
  ok(droppedOk, 'every dropped C3 mark genuinely has no extreme in the previous 20 candles');
  ok(hitOk, 'hitTime / hitValue point at a real candle inside the look-back');
  ok(subset && n4 <= n3, 'C4 is a subset of C3 (' + n4 + ' of ' + n3 + ')');
  console.log('  info: C3 ' + n3 + ' -> C4 ' + n4 + ' marks across NIFTY + SENSEX x 5 LTF pairs');
}

/* ------------------------------------------------------------------ */
console.log('\nT81 — browser wiring (static source assertions; live checks in the preview)');
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  ok(/TL\.normalizeCondition4\(window\.LTF_CONFIG\)/.test(html), 'config normalized from window.LTF_CONFIG');
  ok(/TL\.runChain\(/.test(html) && /c4: LTF_COND4/.test(html), 'applyConfirmation evaluates Condition 4 through the shared chain (TL.runChain)');
  ok(/chain\.marks\.map\(/.test(html) && /'C1\+C2\+C3\+C4'/.test(html), 'combined C1+C2+C3+C4 arrow drawn from the chain marks (one arrow per mark)');
  ok(/cond4Chip/.test(html), 'LTF readout has a C4 chip');
  console.log('  manual (done in the preview): green/red C1+C2+C3+C4 arrow only where C1-C3 hold and an SMA-RSI extreme preceded;');
  console.log('  readout chip; LTF Conditions toggle clears all; invalid condition_4 config -> visible error; all 5 pairs; NIFTY + SENSEX.');
}

/* ------------------------------------------------------------------ */
console.log('\nT82 — C4 RANGES: look-back min / max, Pattern A band, Pattern B band');
{
  const base = { enabled: true, rsi_period: 14, sma_period: 14, lookback_min_candles: 1, lookback_max_candles: 20,
                 pattern_a_min: 67.5, pattern_a_max: 100, pattern_b_min: 0, pattern_b_max: 32.5 };
  const norm = (patch) => TL.normalizeCondition4({ condition_4_rsi_sma_extreme: Object.assign({}, base, patch) });
  const n = norm({});
  ok(n.mode === 'active' && n.cfg.lookbackMin === 1 && n.cfg.lookbackMax === 20 && n.cfg.aMin === 67.5 && n.cfg.aMax === 100 && n.cfg.bMin === 0 && n.cfg.bMax === 32.5,
     'the shipped-style range keys are read');
  ok(n.cfg.lookback === 20 && n.cfg.aAbove === 67.5 && n.cfg.bBelow === 32.5, 'the older names stay as aliases (maximum / A minimum / B maximum)');
  const old = TL.normalizeCondition4({ condition_4_rsi_sma_extreme: { enabled: true, rsi_period: 14, sma_period: 14, lookback_candles: 20, pattern_a_above: 67.5, pattern_b_below: 32.5 } });
  ok(old.mode === 'active' && old.cfg.lookbackMax === 20 && old.cfg.lookbackMin === 1 && old.cfg.aMin === 67.5 && old.cfg.aMax === 100 && old.cfg.bMax === 32.5 && old.cfg.bMin === 0,
     'an older config with lookback_candles / pattern_a_above / pattern_b_below still works, with the other edges open (1, 100, 0)');
  ok(norm({ lookback_max_candles: 12, lookback_candles: 99 }).cfg.lookbackMax === 12, 'the new key wins over the older one');
  for (const [name, patch, text] of [
    ['look-back min 0', { lookback_min_candles: 0 }, 'lookback_min_candles'],
    ['look-back min above max', { lookback_min_candles: 9, lookback_max_candles: 5 }, 'must not be larger'],
    ['A max not above A min', { pattern_a_max: 67.5 }, 'pattern_a_max'],
    ['A max above 100', { pattern_a_max: 101 }, 'pattern_a_max'],
    ['B min not below B max', { pattern_b_min: 32.5 }, 'pattern_b_min'],
    ['B min negative', { pattern_b_min: -1 }, 'pattern_b_min'],
    ['B max not below A min', { pattern_b_max: 70 }, 'smaller'],
  ]) {
    const r = norm(patch);
    ok(r.mode === 'error' && r.cfg === null && r.problems.some((p) => p.indexOf(text) >= 0 && p.indexOf('condition_4_rsi_sma_extreme:') === 0), name + ' -> error, prefixed problem');
  }

  const N = 60, I = 40;
  const cfg = (o) => Object.assign({}, n.cfg, o);
  const run = (pat, over, o) => ev(N, [mk(I, pat)], series(N, 50, over), cfg(o)).length;
  // look-back window: candles lookbackMin .. lookbackMax before the mark (index 39 = 1 back, 30 = 10 back, 20 = 20 back)
  ok(run('A', { 39: 80 }, { lookbackMin: 5 }) === 0, 'min 5: the candle just before the mark (1 back) is excluded');
  ok(run('A', { 35: 80 }, { lookbackMin: 5 }) === 1, 'min 5: the 5th candle back (index 35) counts');
  ok(run('A', { 34: 80 }, { lookbackMin: 5 }) === 1, 'min 5: an older candle (6 back) counts');
  ok(run('A', { 28: 80 }, { lookbackMin: 5, lookbackMax: 10 }) === 0, 'range 5..10: the 12th candle back is too old');
  ok(run('A', { 30: 80 }, { lookbackMin: 5, lookbackMax: 10 }) === 1, 'range 5..10: the 10th candle back (index 30) counts');
  ok(run('A', { 38: 80 }, { lookbackMin: 5, lookbackMax: 10 }) === 0, 'range 5..10: the 2nd candle back is too recent');
  const hit = ev(N, [mk(I, 'A')], series(N, 50, { 36: 80, 33: 90 }), cfg({ lookbackMin: 5, lookbackMax: 10 }))[0];
  ok(hit.hitTime === 33 * L && hit.hitValue === 90, 'the most recent qualifying candle INSIDE the window is reported (index 33; index 36 is only 4 back, so outside a minimum of 5)');
  // Pattern A band: a_min < v <= a_max
  ok(run('A', { 30: 75 }, { aMin: 67.5, aMax: 80 }) === 1, 'A band 67.5..80: 75 passes');
  ok(run('A', { 30: 85 }, { aMin: 67.5, aMax: 80 }) === 0, 'A band 67.5..80: 85 is above the band and fails');
  ok(run('A', { 30: 80 }, { aMin: 67.5, aMax: 80 }) === 1, 'the upper edge of the A band is inclusive (80 passes)');
  ok(run('A', { 30: 67.5 }, { aMin: 67.5, aMax: 80 }) === 0, 'the lower edge of the A band is exclusive (67.5 fails)');
  ok(run('A', { 30: 85, 31: 72 }, { aMin: 67.5, aMax: 80 }) === 1, 'another candle inside the band still lets the mark pass (any one candle)');
  // Pattern B band: b_min <= v < b_max
  ok(run('B', { 30: 25 }, { bMin: 20, bMax: 32.5 }) === 1, 'B band 20..32.5: 25 passes');
  ok(run('B', { 30: 15 }, { bMin: 20, bMax: 32.5 }) === 0, 'B band 20..32.5: 15 is below the band and fails');
  ok(run('B', { 30: 20 }, { bMin: 20, bMax: 32.5 }) === 1, 'the lower edge of the B band is inclusive (20 passes)');
  ok(run('B', { 30: 32.5 }, { bMin: 20, bMax: 32.5 }) === 0, 'the upper edge of the B band is exclusive (32.5 fails)');
  ok(run('A', { 30: 75 }, {}) === 1 && run('B', { 30: 25 }, {}) === 1, 'with the shipped open edges (100 / 0) the behaviour is exactly as before');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
