#!/usr/bin/env node
/**
 * oi-filter.test.js — the HTF option-chain OI-change gate (config/htf.json -> oi_change_filter).
 *
 *   Pattern A passes only when  PE change - CE change  >  minimum_difference     (strict)
 *   Pattern B passes only when  CE change - PE change  >  minimum_difference     (strict)
 *   "Change" = the CE / PE open-interest change of the candle being judged (candle -1), per src/oi-flow.js.
 *   Missing data fails closed. The gate is independent of the slope and SMA-of-RSI gates.
 *
 * Run: node tests/oi-filter.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const TC = require('../src/confirmation.js');
const TF = require('../src/oi-flow.js');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.error('  ✗ FAIL — ' + label); }
}
const jstr = (v) => JSON.stringify(v);
const H = 300;

/* ---------------- fixtures: a minimal Pattern A and Pattern B structure (five 5-minute candles) ---------------- */
const c = (i, o, h, l, cl) => ({ time: i * H, open: o, high: h, low: l, close: cl });
// Pattern A at k = 4: c2 (idx 3) red, c1 (idx 4) red and lower on high and low, c2.high above c3/c4/c5 highs
const PAT_A = [c(0, 100, 101, 99, 100), c(1, 100, 101, 99, 100), c(2, 101, 102, 100, 101), c(3, 108, 110, 105, 106), c(4, 106, 108, 103, 104)];
// Pattern B at k = 4: c2 (idx 3) green, c1 (idx 4) green and higher on high and low, c2.high below c3/c4/c5 highs
const PAT_B = [c(0, 100, 107, 99, 100), c(1, 100, 106, 99, 100), c(2, 101, 105, 100, 101), c(3, 96, 100, 95, 99), c(4, 99, 103, 98, 102)];
const END = (cs) => cs[cs.length - 1].time + H - 1;
const oiNorm = (raw, per) => { const n = TC.normalizeOiFilter(raw); if (per) n.perCandle = per; return n; };
const withOi = (norm) => ({ mode: 'off', filter: null, problems: [], oi: norm });
const run = (cs, norm) => TC.evaluate(cs, { htfSec: H, sessionEndTick: END(cs), filter: withOi(norm) });
const lastState = (m) => Array.from(m.values()).pop();
const per = (dce, dpe) => [null, null, null, null, { dce, dpe }];            // only candle k = 4 matters
const ON = { oi_change_filter: { enabled: true } };

/* ------------------------------------------------------------------ */
console.log('\nT107 — config: off / active / error contract');
{
  const a = TC.normalizeOiFilter({ oi_change_filter: { enabled: true, minimum_difference: 5 } });
  ok(a.mode === 'active' && a.filter.minDiff === 5, 'valid section -> active with parsed minimum_difference');
  ok(TC.normalizeOiFilter(ON).filter.minDiff === 0, 'minimum_difference defaults to 0 when omitted');
  ok(TC.normalizeOiFilter({}).mode === 'off', 'section absent -> off');
  ok(TC.normalizeOiFilter({ oi_change_filter: { enabled: false } }).mode === 'off', 'enabled:false -> off (other fields inert)');
  ok(TC.normalizeOiFilter(undefined).mode === 'error' && /config not generated/.test(TC.normalizeOiFilter(undefined).problems[0]), 'missing config.js -> error "config not generated"');
  ok(TC.normalizeOiFilter('x').mode === 'error', 'non-object config -> error');
  ok(TC.normalizeOiFilter({ oi_change_filter: [] }).mode === 'error', 'array section -> error');
  for (const [name, patch, text] of [
    ['enabled not boolean', { enabled: 'yes' }, 'enabled'],
    ['enabled missing', { enabled: undefined }, 'enabled'],
    ['minimum_difference negative', { enabled: true, minimum_difference: -1 }, 'minimum_difference'],
    ['minimum_difference string', { enabled: true, minimum_difference: '5' }, 'minimum_difference'],
    ['minimum_difference NaN', { enabled: true, minimum_difference: NaN }, 'minimum_difference'],
  ]) {
    const r = TC.normalizeOiFilter({ oi_change_filter: patch });
    ok(r.mode === 'error' && r.filter === null && r.problems.some((p) => p.indexOf(text) >= 0 && p.indexOf('oi_change_filter:') === 0), name + ' -> error, section-prefixed problem');
  }
  const shipped = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'htf.json'), 'utf8'));
  const sh = TC.normalizeOiFilter(shipped);
  ok(!!shipped.oi_change_filter && sh.mode === (shipped.oi_change_filter.enabled === false ? 'off' : 'active'),
     'shipped config/htf.json has an oi_change_filter section that validates (' + sh.mode + ' as the file sets it)');
  ok(TC.normalizeFilter(shipped).mode === 'active' && TC.normalizeSmaRsiFilter(shipped).mode === 'active', 'the slope and SMA-of-RSI sections still validate alongside it');
  // independence: each validator reads only its own key
  ok(TC.normalizeFilter({ oi_change_filter: { enabled: 'bad' } }).mode === 'off' && TC.normalizeSmaRsiFilter({ oi_change_filter: { enabled: 'bad' } }).mode === 'off', 'a broken oi_change_filter does not affect the other two validators');
  ok(TC.normalizeOiFilter({ sma_slope_filter: { enabled: 'bad' }, sma_rsi_filter: 7 }).mode === 'off', 'broken slope / RSI sections do not affect the OI validator');
}

/* ------------------------------------------------------------------ */
console.log('\nT108 — Pattern A: PE change must be greater than CE change');
{
  const base = TC.evaluate(PAT_A, { htfSec: H, sessionEndTick: END(PAT_A), filter: null });
  ok(lastState(base).state === 'Matched' && lastState(base).pattern === 'A', 'fixture: base Pattern A matches with no gates');
  const win = lastState(run(PAT_A, oiNorm(ON, per(100, 500))));
  ok(win.state === 'Matched' && win.pattern === 'A', 'PE +500 > CE +100 -> Matched A');
  ok(win.conditions.oiPe === 500 && win.conditions.oiCe === 100 && win.conditions.oiA === true && win.conditions.oiB === false, 'conditions carry oiPe, oiCe and the verdict for A (true) and B (false)');
  const eq = lastState(run(PAT_A, oiNorm(ON, per(300, 300))));
  ok(eq.state === 'Not Matched' && eq.conditions.oiA === false, 'PE change equal to CE change -> Not Matched (strict)');
  const lose = lastState(run(PAT_A, oiNorm(ON, per(500, 100))));
  ok(lose.state === 'Not Matched' && lose.pattern === null && lose.conditions.oiA === false, 'PE +100 < CE +500 -> Not Matched');
  ok(lastState(run(PAT_A, oiNorm(ON, per(-500, -100)))).state === 'Matched', 'signed comparison: PE -100 is greater than CE -500 -> Matched');
  ok(lastState(run(PAT_A, oiNorm(ON, per(-100, -500)))).state === 'Not Matched', 'PE -500 is not greater than CE -100 -> Not Matched');
  ok(lastState(run(PAT_A, oiNorm(ON, per(100, 500.5)))).state === 'Matched', 'a margin of any size above 0 passes with minimum_difference 0');
}

/* ------------------------------------------------------------------ */
console.log('\nT109 — Pattern B: the opposite (CE change must be greater than PE change)');
{
  const base = TC.evaluate(PAT_B, { htfSec: H, sessionEndTick: END(PAT_B), filter: null });
  ok(lastState(base).state === 'Matched' && lastState(base).pattern === 'B', 'fixture: base Pattern B matches with no gates');
  const win = lastState(run(PAT_B, oiNorm(ON, per(500, 100))));
  ok(win.state === 'Matched' && win.pattern === 'B' && win.conditions.oiB === true && win.conditions.oiA === false, 'CE +500 > PE +100 -> Matched B');
  ok(lastState(run(PAT_B, oiNorm(ON, per(300, 300)))).state === 'Not Matched', 'equal -> Not Matched (strict)');
  ok(lastState(run(PAT_B, oiNorm(ON, per(100, 500)))).state === 'Not Matched', 'PE above CE -> Not Matched for Pattern B');
  ok(lastState(run(PAT_B, oiNorm(ON, per(-100, -500)))).state === 'Matched', 'signed comparison: CE -100 is greater than PE -500 -> Matched B');
  // each pattern only has to satisfy its OWN direction
  ok(lastState(run(PAT_A, oiNorm(ON, per(500, 100)))).state === 'Not Matched' && lastState(run(PAT_B, oiNorm(ON, per(100, 500)))).state === 'Not Matched', 'the A direction never lets a B structure through, and vice versa');
}

/* ------------------------------------------------------------------ */
console.log('\nT110 — minimum_difference, missing data and the other modes');
{
  const md = (n) => ({ oi_change_filter: { enabled: true, minimum_difference: n } });
  ok(lastState(run(PAT_A, oiNorm(md(100), per(100, 250)))).state === 'Matched', 'minimum_difference 100: PE - CE = 150 passes');
  ok(lastState(run(PAT_A, oiNorm(md(100), per(100, 200)))).state === 'Not Matched', 'minimum_difference 100: PE - CE exactly 100 fails (strict)');
  ok(lastState(run(PAT_B, oiNorm(md(100), per(250, 100)))).state === 'Matched' && lastState(run(PAT_B, oiNorm(md(100), per(200, 100)))).state === 'Not Matched', 'the same margin applies to Pattern B (CE - PE)');
  const missing = lastState(run(PAT_A, oiNorm(ON, [null, null, null, null, null])));
  ok(missing.state === 'Not Matched' && missing.conditions.oiPe === null && missing.conditions.oiA === null, 'no flow for the candle -> fails closed (Not Matched), values null');
  const noArr = lastState(run(PAT_A, oiNorm(ON, null)));
  ok(noArr.state === 'Not Matched' && noArr.conditions.oiA === null, 'no per-candle array at all -> fails closed');
  const bad = lastState(run(PAT_A, oiNorm({ oi_change_filter: { enabled: true, minimum_difference: -1 } }, per(100, 500))));
  ok(bad.state === 'Not Matched' && bad.reason === 'config-error' && bad.conditions.oiA === null, 'an invalid oi_change_filter fails closed with reason config-error');
  // off / absent: byte-identical to evaluating with no OI section at all
  const off = TC.evaluate(PAT_A, { htfSec: H, sessionEndTick: END(PAT_A), filter: withOi(TC.normalizeOiFilter({})) });
  const none = TC.evaluate(PAT_A, { htfSec: H, sessionEndTick: END(PAT_A), filter: null });
  ok(jstr(Array.from(off.entries())) === jstr(Array.from(none.entries())), 'gate off -> output identical to no gate (no oi keys appear)');
  ok(!('oiA' in (lastState(off).conditions || {})), 'gate off -> no oi condition keys');
  // only the candle being judged (k = 4) matters
  const other = [{ dce: 999, dpe: -999 }, null, null, null, { dce: 100, dpe: 500 }];
  ok(lastState(run(PAT_A, oiNorm(ON, other))).state === 'Matched', 'values of earlier candles do not affect the verdict (only candle -1 is read)');
  // Unavailable keeps precedence: the first four candles never reach the gate
  const early = run(PAT_A.slice(0, 3), oiNorm(ON, [{ dce: 1, dpe: 2 }, { dce: 1, dpe: 2 }, { dce: 1, dpe: 2 }]));
  ok(Array.from(early.values()).every((s) => s.state === 'Unavailable' && s.conditions === null), 'insufficient history stays Unavailable (the gate is not consulted)');
  // independent of / combined with the other gates: all must pass
  const slopeOn = TC.normalizeFilter({ sma_slope_filter: { enabled: true, method: 'atr_normalized', sma_period: 2, atr_period: 2, lookback_candles: 1, minimum_slope: 0 } });
  slopeOn.oi = oiNorm(ON, per(100, 500));
  const withSlope = lastState(TC.evaluate(PAT_A, { htfSec: H, sessionEndTick: END(PAT_A), filter: slopeOn }));
  ok(withSlope.conditions && 'slopeA' in withSlope.conditions && 'oiA' in withSlope.conditions, 'with the slope gate on too, both sets of condition keys appear');
  ok(withSlope.state === (withSlope.conditions.slopeA === true && withSlope.conditions.oiA === true ? 'Matched' : 'Not Matched'), 'Matched exactly when every active gate passes (slope AND oi)');
}

/* ------------------------------------------------------------------ */
console.log('\nT111 — real data: enabling the gate only ever removes matches, and each kept match really satisfies it');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const mBc = src.match(/function buildCandles\(ticks, tf\) \{[\s\S]*?\n\}/);
  if (!mBc) { ok(false, 'extract buildCandles'); process.exit(1); }
  const buildCandles = new Function('return (' + mBc[0] + ')')();
  const root = path.join(__dirname, '..');
  const htfRaw = JSON.parse(fs.readFileSync(path.join(root, 'config', 'htf.json'), 'utf8'));
  const base = TC.normalizeFilter(htfRaw); base.rsi = TC.normalizeSmaRsiFilter(htfRaw);
  let sessions = 0, subset = true, correct = true, droppedOk = true, kept = 0, removed = 0, total = 0;
  const seen = new Set();
  for (const f of fs.readdirSync(path.join(root, 'input')).filter((x) => /_DASHBOARD\.json$/.test(x))) {
    let d; try { d = JSON.parse(fs.readFileSync(path.join(root, 'input', f), 'utf8')); } catch (e) { continue; }
    const key = String(d.asset).toLowerCase();
    const rows = d[key + '_seconds'];
    if (!rows) continue;
    const ticks = { times: rows.map((r) => r.timestamp_epoch), prices: rows.map((r) => r[key]) };
    const date = new Date((ticks.times[0] + 19800) * 1000).toISOString().slice(0, 10);
    if (seen.has(d.asset + date)) continue;                    // a duplicated date is checked once
    seen.add(d.asset + date);
    const flow = TF.extractFlow(d.flow, date);
    if (!flow.t.length) continue;
    sessions++;
    const last = ticks.times[ticks.times.length - 1];
    for (const htf of [60, 180, 300, 900, 1500]) {
      const cs = buildCandles(ticks, htf);
      const per2 = TF.changePerCandle(flow, cs, htf).map((a) => (a ? { dce: a.dce, dpe: a.dpe } : null));
      const without = TC.evaluate(cs, { htfSec: htf, sessionEndTick: last, filter: base });
      const gated = Object.assign({}, base, { oi: Object.assign(TC.normalizeOiFilter(ON), { perCandle: per2 }) });
      const withG = TC.evaluate(cs, { htfSec: htf, sessionEndTick: last, filter: gated });
      without.forEach((s, close) => {
        const g = withG.get(close);
        if (s.state === 'Matched') {
          total++;
          const k = cs.findIndex((x) => x.time + htf === close);
          const oc = per2[k];
          const want = oc ? (s.pattern === 'A' ? oc.dpe > oc.dce : oc.dce > oc.dpe) : false;
          if (g.state === 'Matched') { kept++; if (!want || g.pattern !== s.pattern) correct = false; }
          else { removed++; if (want) droppedOk = false; }
        } else if (g.state === 'Matched') subset = false;     // the gate must never create a match
      });
    }
  }
  ok(sessions >= 5, 'sessions with flow data checked (' + sessions + ')');
  ok(subset, 'the gate never creates a match: gated matches are a subset of ungated matches');
  ok(correct, 'every kept match has PE change > CE change (A) / CE change > PE change (B) on its own candle');
  ok(droppedOk, 'every match the gate removed genuinely fails the comparison (or has no flow data)');
  ok(total > 0 && kept + removed === total, 'every ungated match was classified (' + total + ' matches: ' + kept + ' kept, ' + removed + ' removed)');
}

/* ------------------------------------------------------------------ */
console.log('\nT112 — browser wiring (static source assertions; live checks in the preview)');
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  ok(/SLOPE_FILTER\.oi = TC\.normalizeOiFilter\(window\.HTF_CONFIG\)/.test(html), 'the oi normalizer is attached to the shared filter object');
  ok(/TF_\.changePerCandle\(t && t\.meta\.flow, htfCandles, htfSec\)/.test(html) && /perCandle/.test(html), 'getStates attaches the per-candle OI change of the session to the gate');
  ok(/part\(cfg\.oi\)/.test(html), 'the oi section is part of the evaluation cache key');
  ok(/grp">oi</.test(html) && /oiChip\(c\.oiA\)/.test(html) && /oiChip\(c\.oiB\)/.test(html), 'the HTF readout shows an oi chip for A and for B');
  ok(/SLOPE_FILTER\.oi\.mode === 'error'/.test(html), 'an invalid oi section shows the config error');
  console.log('  manual (done in the preview): oi chip "oi PE +x CE +y ✓/✗" in the HTF readout; Pattern A / B markers only where the gate passes;');
  console.log('  invalid oi_change_filter -> HTF: Config error badge and no matches; LTF bands follow the gated HTF matches.');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
