#!/usr/bin/env node
/**
 * ltf-spread.test.js — the SMA spread calculation (used by Condition 3; the spread chart that used to display it was removed from the page), see docs/design/ltf-conditions-plan.md.
 *
 *   spread % = (SMA 9 - SMA 44) / SMA 44 * 100     (signed)
 * Drawn as a histogram pane under the LTF RSI pane plus a crosshair readout.
 *
 * Run: node tests/ltf-spread.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const TL = require('../src/ltf-conditions.js');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.error('  ✗ FAIL — ' + label); }
}
const near = (a, b) => Math.abs(a - b) < 1e-9;

/* ------------------------------------------------------------------ */
console.log('\nT61 — spreadPct: formula, sign, null handling');
{
  const r = TL.spreadPct([102, 98, 100, null, 50], [100, 100, 100, 100, null]);
  ok(near(r[0], 2), 'fast 102 vs slow 100 -> +2%');
  ok(near(r[1], -2), 'fast 98 vs slow 100 -> -2%');
  ok(r[2] === 0, 'equal averages -> exactly 0');
  ok(r[3] === null, 'fast not defined -> null');
  ok(r[4] === null, 'slow not defined -> null');
  ok(TL.spreadPct([5], [0])[0] === null, 'slow = 0 -> null (no divide by zero)');
  ok(TL.spreadPct([NaN], [100])[0] === null && TL.spreadPct([100], [Infinity])[0] === null, 'non-finite -> null');
  ok(near(TL.spreadPct([22705.5], [22702.0])[0], (22705.5 - 22702.0) / 22702.0 * 100), 'real NIFTY numbers: (fast - slow) / slow * 100');
  ok(TL.spreadPct([], []).length === 0, 'empty in -> empty out');
  const f = [1, 2, 3], s = [1, 1, 1]; TL.spreadPct(f, s);
  ok(f.join() === '1,2,3' && s.join() === '1,1,1', 'inputs are not mutated');
}

/* ------------------------------------------------------------------ */
console.log('\nT62 — real data: spread equals what the plotted lines imply (all 5 LTFs, NIFTY + SENSEX)');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const mBc = src.match(/function buildCandles\(ticks, tf\) \{[\s\S]*?\n\}/);
  const mSma = src.match(/function smaNullable\(values, period\) \{[\s\S]*?\n\}/);
  if (!mBc || !mSma) { ok(false, 'extract page functions'); process.exit(1); }
  const buildCandles = new Function('return (' + mBc[0] + ')')();
  const sma = new Function('return (' + mSma[0] + ')')();
  let aligned = true, formula = true, nullsOk = true, n = 0, signs = { pos: 0, neg: 0 };
  for (const [file, key] of [['NIFTY_2026-10-23_DASHBOARD.json', 'nifty_seconds'], ['SENSEX_2026-10-23_DASHBOARD.json', 'sensex_seconds']]) {
    if (!fs.existsSync(path.join(__dirname, '..', 'input', file))) { console.log('  note: input/' + file + ' is not present \u2014 skipped'); continue; }
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'input', file), 'utf8'));
    const pk = d.asset.toLowerCase();
    const ticks = { times: d[key].map((r) => r.timestamp_epoch), prices: d[key].map((r) => r[pk]) };
    for (const ltf of [12, 36, 60, 180, 300]) {
      const closes = buildCandles(ticks, ltf).map((c) => c.close);
      const f = sma(closes, 9), s = sma(closes, 44);
      const sp = TL.spreadPct(f, s);
      if (sp.length !== closes.length) aligned = false;
      sp.forEach((v, i) => {
        const should = i >= 43;                                  // SMA 44 exists from the 44th candle
        if ((v !== null) !== should) nullsOk = false;
        if (v !== null) {
          n++;
          if (!near(v, (f[i] - s[i]) / s[i] * 100)) formula = false;
          if (v > 0) signs.pos++; else if (v < 0) signs.neg++;
          if ((v > 0) !== (f[i] > s[i]) && v !== 0) formula = false;
        }
      });
    }
  }
  ok(aligned, 'one value per candle (array length equals candle count)');
  ok(nullsOk, 'null for the first 43 candles, a number from the 44th onward');
  ok(formula, 'every value equals (SMA9 - SMA44)/SMA44*100 and its sign matches fast > slow');
  ok(n > 0 && signs.pos > 0 && signs.neg > 0, 'real data has both positive and negative spreads (' + n + ' values)');
  console.log('  info: ' + signs.pos + ' positive / ' + signs.neg + ' negative spread values');
}

/* ------------------------------------------------------------------ */
console.log('\nT63 — it is a view, not a condition: C1/C2 behaviour untouched');
{
  const c2 = TL.evaluateCondition2([{ time: 0, close: 1 }], [], { fastPeriod: 2, slowPeriod: 4 });
  ok(c2.length === 0, 'evaluateCondition2 still returns nothing without C1 marks');
  ok(typeof TL.spreadPct === 'function' && typeof TL.combineMarks === 'function', 'indicator and condition helpers coexist');
}

/* ------------------------------------------------------------------ */
console.log('\nT64 — browser wiring (static source assertions): the spread PANE was removed from the page, the calculation stays');
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  ok(!/spread-chart|spread-legend|spreadChart|spreadSeries|drawSpreadLegend|addHistogramSeries/.test(html), 'no spread chart, legend or histogram series remains on the page (LTF or HTF)');
  ok(/TL\.normalizeCondition3\(window\.LTF_CONFIG\)/.test(html), 'Condition 3 (the spread BAND) is still wired — only the view was removed');
  ok(typeof TL.spreadPct === 'function', 'the spreadPct calculation used by Condition 3 is still exported');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
