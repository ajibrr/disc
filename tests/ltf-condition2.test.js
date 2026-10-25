#!/usr/bin/env node
/**
 * ltf-condition2.test.js — LTF Condition 2: SMA trend filter on Condition 1, see docs/design/ltf-conditions-plan.md.
 *
 * Keeps a Condition 1 mark only when, on that same candle:
 *   C2 A (Pattern A mark): SMA fast  >  SMA slow   (strict)
 *   C2 B (Pattern B mark): SMA fast  <  SMA slow   (strict)
 * Defaults are SMA 9 / SMA 44 (the two averages the LTF chart plots).
 *
 * Run: node tests/ltf-condition2.test.js
 * Node-only: no browser, no chart library.
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
const C = (closes) => closes.map((c, i) => ({ time: i * L, close: c }));
const mk = (i, pattern) => ({ time: i * L, pattern, rsi: 55, prevRsi: 45, windowCloseTime: 0 });
const CFG = { fastPeriod: 2, slowPeriod: 4 };               // small periods keep the fixtures readable
const times = (ms) => ms.map((m) => m.time / L).join();

/* ------------------------------------------------------------------ */
console.log('\nT53 — config: off / active / error contract');
{
  const good = { condition_2_sma_trend: { enabled: true, fast_period: 9, slow_period: 44 } };
  const a = TL.normalizeCondition2(good);
  ok(a.mode === 'active' && a.cfg.fastPeriod === 9 && a.cfg.slowPeriod === 44, 'valid section -> active with parsed values');
  ok(TL.normalizeCondition2({}).mode === 'off', 'section absent -> off');
  ok(TL.normalizeCondition2({ condition_2_sma_trend: { enabled: false } }).mode === 'off', 'enabled:false -> off');
  ok(TL.normalizeCondition2(undefined).mode === 'error' &&
     /config not generated/.test(TL.normalizeCondition2(undefined).problems[0]), 'missing ltf-config.js -> error "config not generated"');
  ok(TL.normalizeCondition2('x').mode === 'error', 'non-object config -> error');
  ok(TL.normalizeCondition2({ condition_2_sma_trend: [] }).mode === 'error', 'array section -> error');
  const bad = (patch) => TL.normalizeCondition2({ condition_2_sma_trend: Object.assign({}, good.condition_2_sma_trend, patch) });
  for (const [name, patch, text] of [
    ['enabled not boolean', { enabled: 1 }, 'enabled'],
    ['fast_period 0', { fast_period: 0 }, 'fast_period'],
    ['fast_period fractional', { fast_period: 9.5 }, 'fast_period'],
    ['slow_period missing', { slow_period: undefined }, 'slow_period'],
    ['slow_period negative', { slow_period: -44 }, 'slow_period'],
    ['fast equal to slow', { fast_period: 44 }, 'smaller'],
    ['fast larger than slow', { fast_period: 50 }, 'smaller'],
  ]) {
    const r = bad(patch);
    ok(r.mode === 'error' && r.cfg === null && r.problems.some((p) => p.indexOf(text) >= 0 &&
       p.indexOf('condition_2_sma_trend:') === 0), name + ' -> error, section-prefixed problem');
  }
  const shipped = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'ltf.json'), 'utf8'));
  const sc = TL.normalizeCondition2(shipped);
  ok(sc.mode === 'active' && sc.cfg.fastPeriod === 9 && sc.cfg.slowPeriod === 44, 'shipped config/ltf.json = SMA 9 / SMA 44, active');
  ok(TL.normalizeCondition1(shipped).mode === 'active', 'Condition 1 section still validates alongside it');
}

/* ------------------------------------------------------------------ */
console.log('\nT54 — C2 A: Pattern A mark kept only when SMA fast > SMA slow');
{
  const up = C([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);            // rising: fast above slow
  const down = C([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);          // falling: fast below slow
  const m = TL.evaluateCondition2(up, [mk(8, 'A')], CFG);
  ok(m.length === 1 && m[0].time === 8 * L && m[0].pattern === 'A', 'A kept when fast > slow (rising)');
  ok(m[0].smaFast > m[0].smaSlow && Math.abs(m[0].smaFast - 8.5) < 1e-9 && Math.abs(m[0].smaSlow - 7.5) < 1e-9,
     'mark carries the SMA values (fast 8.5, slow 7.5)');
  ok(m[0].rsi === 55 && m[0].prevRsi === 45, 'original C1 fields are carried through');
  ok(TL.evaluateCondition2(down, [mk(8, 'A')], CFG).length === 0, 'A dropped when fast < slow (falling)');
}

/* ------------------------------------------------------------------ */
console.log('\nT55 — C2 B: Pattern B mark kept only when SMA fast < SMA slow');
{
  const up = C([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const down = C([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  const m = TL.evaluateCondition2(down, [mk(8, 'B')], CFG);
  ok(m.length === 1 && m[0].pattern === 'B' && m[0].smaFast < m[0].smaSlow, 'B kept when fast < slow (falling)');
  ok(TL.evaluateCondition2(up, [mk(8, 'B')], CFG).length === 0, 'B dropped when fast > slow (rising)');
  ok(TL.evaluateCondition2(up, [mk(8, 'A'), mk(9, 'B')], CFG).length === 1 &&
     TL.evaluateCondition2(up, [mk(8, 'A'), mk(9, 'B')], CFG)[0].pattern === 'A',
     'in one run each mark is judged by its own pattern');
}

/* ------------------------------------------------------------------ */
console.log('\nT56 — strict comparisons and warm-up');
{
  const flatC = C([5, 5, 5, 5, 5, 5, 5, 5]);
  ok(TL.evaluateCondition2(flatC, [mk(6, 'A')], CFG).length === 0, 'fast == slow: A dropped (strict)');
  ok(TL.evaluateCondition2(flatC, [mk(6, 'B')], CFG).length === 0, 'fast == slow: B dropped (strict)');
  const up = C([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  ok(TL.evaluateCondition2(up, [mk(2, 'A')], CFG).length === 0, 'slow SMA not defined yet (index 2 < 3): dropped');
  ok(TL.evaluateCondition2(up, [mk(3, 'A')], CFG).length === 1, 'first index where both SMAs exist (3) can pass');
  ok(TL.evaluateCondition2(up, [mk(0, 'A')], CFG).length === 0, 'index 0: dropped');
  const sma = TL.smaArray([1, 2, 3, 4, 5], 3);
  ok(sma[0] === null && sma[1] === null && sma[2] === 2 && sma[3] === 3 && sma[4] === 4, 'smaArray: null until `period` values, then the mean');
}

/* ------------------------------------------------------------------ */
console.log('\nT57 — only filters C1; never creates marks; degenerate inputs');
{
  const up = C([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  ok(TL.evaluateCondition2(up, [], CFG).length === 0, 'no C1 marks -> no C2 marks');
  ok(TL.evaluateCondition2([], [mk(8, 'A')], CFG).length === 0, 'no candles -> no C2 marks');
  ok(TL.evaluateCondition2(up, [{ time: 99999, pattern: 'A' }], CFG).length === 0, 'mark whose candle does not exist is dropped');
  const input = [mk(5, 'A'), mk(7, 'A'), mk(9, 'B')];
  const out = TL.evaluateCondition2(up, input, CFG);
  ok(times(out) === '5,7' && out.every((o) => input.some((i) => i.time === o.time)), 'output is a subset of the input marks, same order');
  ok(input.every((i) => i.smaFast === undefined), 'input marks are not mutated');
}

/* ------------------------------------------------------------------ */
console.log('\nT58 — no look-ahead: only closes up to the marked candle matter');
{
  const base = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const m1 = TL.evaluateCondition2(C(base), [mk(6, 'A')], CFG);
  const wild = base.slice(0, 7).concat([500, -500, 500]);   // change every close after candle 6
  const m2 = TL.evaluateCondition2(C(wild), [mk(6, 'A')], CFG);
  ok(JSON.stringify(m1) === JSON.stringify(m2), 'changing every later close does not change the verdict or the SMA values');
  const m3 = TL.evaluateCondition2(C(base.slice(0, 7)), [mk(6, 'A')], CFG);
  ok(JSON.stringify(m1) === JSON.stringify(m3), 'evaluating on data truncated at the marked candle gives the same result');
}

/* ------------------------------------------------------------------ */
console.log('\nT58b \u2014 combined C1 AND C2: one entry per C1 mark');
{
  const up = C([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const c1 = [mk(2, 'A'), mk(6, 'A'), mk(8, 'B'), mk(9, 'A')];
  const c2 = TL.evaluateCondition2(up, c1, CFG);                // 2 -> warm-up drop, 6 ok, 8(B) fails, 9 ok
  const comb = TL.combineMarks(c1, c2);
  ok(comb.length === c1.length, 'exactly one entry per C1 mark (no duplicates when both pass)');
  ok(comb.map((m) => m.kind).join() === 'C1,C1+C2,C1,C1+C2', 'kind is C1+C2 only where C2 also passed, C1 elsewhere');
  ok(comb.map((m) => m.time / L).join() === '2,6,8,9', 'ascending by time');
  ok(comb[1].smaFast > comb[1].smaSlow && comb[0].smaFast === undefined, 'C1+C2 entries carry SMA values; C1-only entries do not');
  ok(TL.combineMarks(c1, []).every((m) => m.kind === 'C1'), 'no C2 marks (C2 off / none pass) -> all C1');
  ok(TL.combineMarks([], c2).length === 0, 'no C1 marks -> nothing (C2 can never create a mark)');
  const same = [mk(6, 'A'), Object.assign(mk(6, 'B'), {})];
  ok(TL.combineMarks(same, [Object.assign({}, same[0], { smaFast: 2, smaSlow: 1 })]).map((m) => m.kind).join() === 'C1+C2,C1',
     'A and B on the same candle are matched by pattern, not just time');
}

/* ------------------------------------------------------------------ */
console.log('\nT59 — real data: SMAs equal the plotted ones; C2 runs on every LTF pair');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const mBc = src.match(/function buildCandles\(ticks, tf\) \{[\s\S]*?\n\}/);
  const mSma = src.match(/function smaNullable\(values, period\) \{[\s\S]*?\n\}/);
  ok(!!mBc && !!mSma, 'real buildCandles() and smaNullable() extracted from web/index.html');
  if (!mBc || !mSma) { console.error('  cannot continue'); process.exit(1); }
  const buildCandles = new Function('return (' + mBc[0] + ')')();
  const smaPlotted = new Function('return (' + mSma[0] + ')')();
  const HTF_OF = { 12: 60, 36: 180, 60: 300, 180: 900, 300: 1500 };
  const c2cfg = { fastPeriod: 9, slowPeriod: 44 };
  let eq = true, sane = true, c1Total = 0, c2Total = 0;
  for (const [file, key] of [['NIFTY_2026-10-23_DASHBOARD.json', 'nifty_seconds'], ['SENSEX_2026-10-23_DASHBOARD.json', 'sensex_seconds']]) {
    if (!fs.existsSync(path.join(__dirname, '..', 'input', file))) { console.log('  note: input/' + file + ' is not present \u2014 skipped'); continue; }
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'input', file), 'utf8'));
    const pk = d.asset.toLowerCase();
    const ticks = { times: d[key].map((r) => r.timestamp_epoch), prices: d[key].map((r) => r[pk]) };
    const last = ticks.times[ticks.times.length - 1];
    for (const ltf of Object.keys(HTF_OF).map(Number)) {
      const htf = HTF_OF[ltf];
      const lc = buildCandles(ticks, ltf);
      const closes = lc.map((x) => x.close);
      for (const p of [9, 44]) {
        const a = TL.smaArray(closes, p), b = smaPlotted(closes, p);
        for (let i = 0; i < a.length; i++) {
          if ((a[i] === null) !== (b[i] === null) || (a[i] !== null && Math.abs(a[i] - b[i]) > 1e-6)) eq = false;
        }
      }
      const states = TC.evaluate(buildCandles(ticks, htf), { htfSec: htf, sessionEndTick: last });
      const wins = [];
      states.forEach((s) => { if (s.state === TC.STATE.MATCHED) wins.push({ from: s.closeTime - htf, to: s.closeTime, pattern: s.pattern }); });
      const c1 = TL.evaluateCondition1(lc, TC.rsiArray(closes, 14), wins, { level: 50, scanCandles: 20 });
      const c2 = TL.evaluateCondition2(lc, c1, c2cfg);
      c1Total += c1.length; c2Total += c2.length;
      const fast = smaPlotted(closes, 9), slow = smaPlotted(closes, 44);
      for (const m of c2) {
        const i = lc.findIndex((x) => x.time === m.time);
        const good = m.pattern === 'A' ? fast[i] > slow[i] : fast[i] < slow[i];
        if (!good || !c1.some((x) => x.time === m.time && x.pattern === m.pattern)) sane = false;
      }
      // every dropped C1 mark must genuinely fail the test (or have no slow SMA yet)
      for (const m of c1) {
        if (c2.some((x) => x.time === m.time)) continue;
        const i = lc.findIndex((x) => x.time === m.time);
        const failsTest = fast[i] === null || slow[i] === null ||
          (m.pattern === 'A' ? !(fast[i] > slow[i]) : !(fast[i] < slow[i]));
        if (!failsTest) sane = false;
      }
    }
  }
  ok(eq, 'smaArray equals the plotted smaNullable (SMA 9 and SMA 44; NIFTY + SENSEX, all 5 LTFs)');
  ok(sane, 'every C2 mark is a C1 mark that passes its test; every dropped C1 mark genuinely fails it');
  ok(c2Total <= c1Total, 'C2 never has more marks than C1 (' + c2Total + ' of ' + c1Total + ')');
}

/* ------------------------------------------------------------------ */
console.log('\nT60 — browser wiring (static source assertions; live checks in the preview)');
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  ok(/TL\.normalizeCondition2\(window\.LTF_CONFIG\)/.test(html), 'config normalized from window.LTF_CONFIG');
  ok(/TL\.runChain\(/.test(html) && /c2: LTF_COND2/.test(html), 'applyConfirmation evaluates Condition 2 through the shared chain (TL.runChain)');
  ok(/'C1\+C2'/.test(html) && /chain\.marks\.map\(/.test(html), 'combined C1+C2 arrow drawn from the chain marks (one arrow, not two)');
  ok(/cond2Chip/.test(html), 'LTF readout has a C2 chip');
  console.log('  manual (done in the preview): C2 arrow beside the C1 arrow only where SMA 9/44 agree; readout chip;');
  console.log('  LTF Conditions toggle clears C1 and C2; invalid condition_2 config -> visible error; all 5 pairs; NIFTY + SENSEX.');
}

/* ------------------------------------------------------------------ */
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
