#!/usr/bin/env node
/**
 * ltf-condition3.test.js — LTF Condition 3: SMA spread band on C1 + C2, see ltf.md.
 *
 * Keeps a C2 mark only when the SMA fast/slow spread % on that candle lies in a band next to zero:
 *   Pattern A:  min_pct <  spread <= max_pct          (shipped: 0 < x <= +0.020)
 *   Pattern B: -max_pct <= spread <  -min_pct         (shipped: -0.020 <= x < 0)
 *
 * Run: node tests/ltf-condition3.test.js
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
const C2CFG = { fastPeriod: 2, slowPeriod: 4 };
const BAND = { minPct: 0, maxPct: 0.02 };
const candles = (closes) => closes.map((c, i) => ({ time: i * L, close: c }));
const mk = (i, pattern) => ({ time: i * L, pattern, rsi: 55, prevRsi: 45, windowCloseTime: 0 });
const ev = (closes, marks, band) => TL.evaluateCondition3(candles(closes), marks, band || BAND, C2CFG);

/**
 * Closes whose SMA2/SMA4 spread at the LAST index equals `pct` (percent) exactly:
 * [x, x, a, b] with SMA4 = S, SMA2 = (a+b)/2 = S*(1+pct/100). Pick S = 1000.
 * Using a=b=v makes SMA2 = v; then SMA4 = (x+x+v+v)/4 = (x+v)/2 = 1000 => x = 2000 - v.
 */
function withSpread(pct) {
  const v = 1000 * (1 + pct / 100);
  const x = 2000 - v;
  return [x, x, v, v];
}

/* ------------------------------------------------------------------ */
console.log('\nT65 — config: off / active / error contract');
{
  const good = { condition_3_spread_band: { enabled: true, min_pct: 0, max_pct: 0.02 } };
  const a = TL.normalizeCondition3(good);
  ok(a.mode === 'active' && a.cfg.minPct === 0 && a.cfg.maxPct === 0.02, 'valid section -> active with parsed values');
  ok(TL.normalizeCondition3({}).mode === 'off', 'section absent -> off');
  ok(TL.normalizeCondition3({ condition_3_spread_band: { enabled: false } }).mode === 'off', 'enabled:false -> off');
  ok(TL.normalizeCondition3(undefined).mode === 'error' &&
     /config not generated/.test(TL.normalizeCondition3(undefined).problems[0]), 'missing ltf-config.js -> error "config not generated"');
  ok(TL.normalizeCondition3('x').mode === 'error', 'non-object config -> error');
  ok(TL.normalizeCondition3({ condition_3_spread_band: [] }).mode === 'error', 'array section -> error');
  const bad = (patch) => TL.normalizeCondition3({ condition_3_spread_band: Object.assign({}, good.condition_3_spread_band, patch) });
  for (const [name, patch, text] of [
    ['enabled not boolean', { enabled: 'yes' }, 'enabled'],
    ['min_pct negative', { min_pct: -0.01 }, 'min_pct'],
    ['min_pct not a number', { min_pct: '0' }, 'min_pct'],
    ['max_pct zero', { max_pct: 0 }, 'max_pct'],
    ['max_pct negative', { max_pct: -0.02 }, 'max_pct'],
    ['max_pct NaN', { max_pct: NaN }, 'max_pct'],
    ['max_pct missing', { max_pct: undefined }, 'max_pct'],
    ['max equal to min', { min_pct: 0.02 }, 'greater than'],
    ['max below min', { min_pct: 0.05 }, 'greater than'],
  ]) {
    const r = bad(patch);
    ok(r.mode === 'error' && r.cfg === null && r.problems.some((p) => p.indexOf(text) >= 0 &&
       p.indexOf('condition_3_spread_band:') === 0), name + ' -> error, section-prefixed problem');
  }
  const shipped = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'ltf.json'), 'utf8'));
  const sc = TL.normalizeCondition3(shipped);
  ok(sc.mode === 'active' && sc.cfg.minPct === 0 && sc.cfg.maxPct === 0.02, 'shipped config/ltf.json = 0 .. 0.020 %, active');
  ok(TL.normalizeCondition1(shipped).mode === 'active' && TL.normalizeCondition2(shipped).mode === 'active',
     'Conditions 1 and 2 still validate alongside it');
}

/* ------------------------------------------------------------------ */
console.log('\nT66 — test fixture sanity: withSpread() really produces the spread asked for');
{
  for (const p of [0.01, 0.02, 0.0201, -0.015, 0.5]) {
    const c = candles(withSpread(p)).map((x) => x.close);
    const f = TL.smaArray(c, 2), s = TL.smaArray(c, 4);
    ok(near(TL.spreadPct(f, s)[3], p), 'spread of the fixture = ' + p + ' %');
  }
}

/* ------------------------------------------------------------------ */
console.log('\nT67 — Pattern A: 0 < spread <= +0.020 (lower exclusive, upper inclusive)');
{
  const pass3 = (p) => ev(withSpread(p), [mk(3, 'A')]).length === 1;
  ok(pass3(0.01), 'inside the band (+0.010 %) passes');
  ok(pass3(0.0001), 'just above 0 passes');
  ok(pass3(0.02), 'exactly the upper edge (+0.020 %) passes');
  ok(!pass3(0.0201), 'just above the upper edge fails');
  ok(!pass3(0.5), 'far above fails (averages already far apart)');
  ok(!pass3(0), 'exactly 0 fails (lower edge exclusive)');
  ok(!pass3(-0.01), 'negative spread fails for Pattern A');
  const m = ev(withSpread(0.01), [mk(3, 'A')])[0];
  ok(near(m.spreadPct, 0.01) && m.pattern === 'A' && m.rsi === 55 && m.prevRsi === 45, 'mark carries spreadPct and the original fields');
}

/* ------------------------------------------------------------------ */
console.log('\nT68 — Pattern B: -0.020 <= spread < 0 (mirror)');
{
  const pass3 = (p) => ev(withSpread(p), [mk(3, 'B')]).length === 1;
  ok(pass3(-0.01), 'inside the band (-0.010 %) passes');
  ok(pass3(-0.0001), 'just below 0 passes');
  ok(pass3(-0.02), 'exactly the lower limit (-0.020 %) passes');
  ok(!pass3(-0.0201), 'just beyond the limit fails');
  ok(!pass3(-0.5), 'far below fails');
  ok(!pass3(0), 'exactly 0 fails');
  ok(!pass3(0.01), 'positive spread fails for Pattern B');
  ok(ev(withSpread(0.01), [mk(3, 'A'), mk(3, 'B')]).map((x) => x.pattern).join() === 'A',
     'A and B on the same candle are judged by their own sign');
}

/* ------------------------------------------------------------------ */
console.log('\nT69 — configurable band, warm-up, and only-filters-C2 behaviour');
{
  const wide = { minPct: 0.01, maxPct: 0.05 };
  ok(ev(withSpread(0.03), [mk(3, 'A')], wide).length === 1, 'wider band: +0.030 passes');
  ok(ev(withSpread(0.005), [mk(3, 'A')], wide).length === 0, 'min_pct honoured: +0.005 is below the band floor');
  ok(ev(withSpread(0.01), [mk(3, 'A')], wide).length === 0, 'floor is exclusive: exactly min_pct fails');
  ok(ev(withSpread(-0.03), [mk(3, 'B')], wide).length === 1, 'wider band mirrors for B (-0.030 passes)');
  ok(ev(withSpread(-0.005), [mk(3, 'B')], wide).length === 0, 'B floor mirrors (-0.005 fails)');
  ok(ev(withSpread(0.01), [mk(2, 'A')]).length === 0, 'SMA 4 not defined yet (index 2): dropped');
  ok(ev(withSpread(0.01), []).length === 0, 'no C2 marks -> no C3 marks');
  ok(TL.evaluateCondition3([], [mk(3, 'A')], BAND, C2CFG).length === 0, 'no candles -> no C3 marks');
  ok(ev(withSpread(0.01), [{ time: 99999, pattern: 'A' }]).length === 0, 'mark whose candle does not exist is dropped');
  const input = [mk(3, 'A')];
  const out = ev(withSpread(0.01), input);
  ok(out.length === 1 && out[0].time === input[0].time && input[0].spreadPct === undefined, 'output is a subset of the input and the input is not mutated');
}

/* ------------------------------------------------------------------ */
console.log('\nT70 — no look-ahead: only closes up to the marked candle matter');
{
  const base = withSpread(0.01).concat([5, 5000, 1, 99999]);
  const m1 = ev(base, [mk(3, 'A')]);
  const m2 = ev(withSpread(0.01), [mk(3, 'A')]);
  ok(JSON.stringify(m1) === JSON.stringify(m2) && m1.length === 1, 'changing every later close does not change the verdict or the spread value');
}

/* ------------------------------------------------------------------ */
console.log('\nT71 — combineMarks with three kinds: still ONE entry per C1 mark');
{
  const c1 = [mk(1, 'A'), mk(2, 'A'), mk(3, 'A'), mk(4, 'B')];
  const c2 = [Object.assign({}, c1[1], { smaFast: 2, smaSlow: 1 }), Object.assign({}, c1[2], { smaFast: 2, smaSlow: 1 })];
  const c3 = [Object.assign({}, c2[1], { spreadPct: 0.01 })];
  const comb = TL.combineMarks(c1, c2, c3);
  ok(comb.length === c1.length, 'exactly one entry per C1 mark');
  ok(comb.map((m) => m.kind).join() === 'C1,C1+C2,C1+C2+C3,C1', 'kind = highest condition level the candle reached');
  ok(comb[2].spreadPct === 0.01 && comb[1].spreadPct === undefined, 'C1+C2+C3 entries carry spreadPct; C1+C2 entries do not');
  ok(TL.combineMarks(c1, c2).map((m) => m.kind).join() === 'C1,C1+C2,C1+C2,C1', 'two-argument form (no C3) behaves as before');
  ok(TL.combineMarks(c1, [], c3).every((m) => m.kind === 'C1'), 'a C3 mark without its C2 mark is not promoted (C3 only ever refines C2)');
  ok(TL.combineMarks(c1, c2, []).map((m) => m.kind).join() === 'C1,C1+C2,C1+C2,C1', 'no C3 marks -> kinds stop at C1+C2');
}

/* ------------------------------------------------------------------ */
console.log('\nT72 — real data: C3 spread equals the histogram value and lies in the band');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const mBc = src.match(/function buildCandles\(ticks, tf\) \{[\s\S]*?\n\}/);
  const mSma = src.match(/function smaNullable\(values, period\) \{[\s\S]*?\n\}/);
  if (!mBc || !mSma) { ok(false, 'extract page functions'); process.exit(1); }
  const buildCandles = new Function('return (' + mBc[0] + ')')();
  const sma = new Function('return (' + mSma[0] + ')')();
  const HTF_OF = { 12: 60, 36: 180, 60: 300, 180: 900, 300: 1500 };
  const c2cfg = { fastPeriod: 9, slowPeriod: 44 };
  const band = { minPct: 0, maxPct: 0.02 };
  let eq = true, inBand = true, dropsOk = true, n1 = 0, n2 = 0, n3 = 0, subset = true;
  for (const [file, key] of [['NIFTY_2026-10-22_DASHBOARD.json', 'nifty_seconds'], ['SENSEX_2026-10-22_DASHBOARD.json', 'sensex_seconds'],
                             ['NIFTY_2026-10-23_DASHBOARD.json', 'nifty_seconds'], ['SENSEX_2026-10-23_DASHBOARD.json', 'sensex_seconds']]) {
    if (!fs.existsSync(path.join(__dirname, '..', 'input', file))) { console.log('  note: input/' + file + ' is not present \u2014 skipped'); continue; }
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'input', file), 'utf8'));
    const pk = d.asset.toLowerCase();
    const ticks = { times: d[key].map((r) => r.timestamp_epoch), prices: d[key].map((r) => r[pk]) };
    const last = ticks.times[ticks.times.length - 1];
    for (const ltf of Object.keys(HTF_OF).map(Number)) {
      const htf = HTF_OF[ltf];
      const lc = buildCandles(ticks, ltf);
      const closes = lc.map((x) => x.close);
      const f = sma(closes, 9), s = sma(closes, 44);
      const hist = TL.spreadPct(f, s);                         // exactly what the histogram plots
      const states = TC.evaluate(buildCandles(ticks, htf), { htfSec: htf, sessionEndTick: last });
      const wins = [];
      states.forEach((st) => { if (st.state === TC.STATE.MATCHED) wins.push({ from: st.closeTime - htf, to: st.closeTime, pattern: st.pattern }); });
      const c1 = TL.evaluateCondition1(lc, TC.rsiArray(closes, 14), wins, { level: 50, scanCandles: 20 });
      const c2 = TL.evaluateCondition2(lc, c1, c2cfg);
      const c3 = TL.evaluateCondition3(lc, c2, band, c2cfg);
      n1 += c1.length; n2 += c2.length; n3 += c3.length;
      for (const m of c3) {
        const i = lc.findIndex((x) => x.time === m.time);
        if (!near(m.spreadPct, hist[i])) eq = false;
        const okBand = m.pattern === 'A' ? (hist[i] > 0 && hist[i] <= 0.02) : (hist[i] < 0 && hist[i] >= -0.02);
        if (!okBand) inBand = false;
        if (!c2.some((x) => x.time === m.time && x.pattern === m.pattern)) subset = false;
      }
      for (const m of c2) {
        if (c3.some((x) => x.time === m.time && x.pattern === m.pattern)) continue;
        const i = lc.findIndex((x) => x.time === m.time);
        const v = hist[i];
        const inside = v !== null && (m.pattern === 'A' ? (v > 0 && v <= 0.02) : (v < 0 && v >= -0.02));
        if (inside) dropsOk = false;                             // dropped but actually inside the band
      }
    }
  }
  ok(eq, 'every C3 spread equals the histogram value (spreadPct of the plotted SMA 9 / SMA 44)');
  ok(inBand, 'every C3 mark genuinely lies inside its band');
  ok(dropsOk, 'every dropped C2 mark genuinely lies outside the band');
  ok(subset && n3 <= n2 && n2 <= n1, 'C3 is a subset of C2 which is a subset of C1 (' + n3 + ' / ' + n2 + ' / ' + n1 + ')');
  console.log('  info: C1 ' + n1 + ' -> C2 ' + n2 + ' -> C3 ' + n3 + ' marks across NIFTY + SENSEX (22-10, 23-10) x 5 LTF pairs');
}

/* ------------------------------------------------------------------ */
console.log('\nT73 — browser wiring (static source assertions; live checks in the preview)');
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  ok(/TL\.normalizeCondition3\(window\.LTF_CONFIG\)/.test(html), 'config normalized from window.LTF_CONFIG');
  ok(/TL\.runChain\(/.test(html) && /c3: LTF_COND3/.test(html), 'applyConfirmation evaluates Condition 3 through the shared chain (TL.runChain)');
  ok(/chain\.marks\.map\(/.test(html) && /'C1\+C2\+C3'/.test(html), 'combined C1+C2+C3 arrow drawn from the chain marks (one arrow per mark)');
  ok(/cond3Chip/.test(html), 'LTF readout has a C3 chip');
  console.log('  manual (done in the preview): gold/violet C1+C2+C3 arrow only where C1+C2 hold and spread is in the band;');
  console.log('  readout chip; LTF Conditions toggle clears all; invalid condition_3 config -> visible error; all 5 pairs; NIFTY + SENSEX.');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
