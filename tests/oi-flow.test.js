#!/usr/bin/env node
/**
 * oi-flow.test.js — CE / PE open-interest CHANGE on the HTF chart.
 *
 *   build-data.js stores the flow of every session as { t, dce, dpe } (first snapshot of each minute, with the CE / PE change of
 *   the minute that ends at it). The HTF charts plot the change per candle = the minutes that END inside the candle,
 *   i.e. snapshots whose minute M = floor(T / 60) * 60 satisfies  candle.time < M <= candle.time + tfSec.
 *
 * Run: node tests/oi-flow.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const TF = require('../src/oi-flow.js');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.error('  ✗ FAIL — ' + label); }
}
const candles = (tf, n, start) => Array.from({ length: n }, (_, i) => ({ time: (start || 0) + i * tf }));

/* ------------------------------------------------------------------ */
console.log('\nT103 — changePerCandle: the minutes that end inside each candle');
{
  const flow = { t: [60, 120, 180, 240], dce: [1, 2, 3, 4], dpe: [10, 20, 30, 40] };
  const a = TF.changePerCandle(flow, candles(60, 4), 60);
  ok(a.map((x) => x.dce).join() === '1,2,3,4' && a.map((x) => x.dpe).join() === '10,20,30,40', '1-minute candles: each candle shows exactly the file\'s change of its own minute');
  ok(a.every((x) => x.minutes === 1) && a[2].lastSnapshot === 180, 'one minute per candle; the last snapshot used is reported');
  const b = TF.changePerCandle(flow, candles(120, 2), 120);
  ok(b[0].dce === 3 && b[0].dpe === 30 && b[0].minutes === 2 && b[1].dce === 7 && b[1].dpe === 70, '2-minute candles: the changes of the minutes inside are added (1+2, 3+4; 10+20, 30+40)');
  const c = TF.changePerCandle(flow, candles(240, 1), 240);
  ok(c[0].dce === 10 && c[0].dpe === 100 && c[0].minutes === 4, 'a candle covering the whole series adds all four minutes');

  // the baseline row (the minute the candle opens) belongs to NO candle
  const base = TF.changePerCandle({ t: [0, 60, 120], dce: [0, 5, 6], dpe: [0, 7, 8] }, candles(60, 2), 60);
  ok(base[0].dce === 5 && base[1].dce === 6, 'a baseline row at the candle open (09:15) is not counted: the first candle shows the 09:16 change');
  const only0 = TF.changePerCandle({ t: [0], dce: [99], dpe: [99] }, candles(60, 1), 60);
  ok(only0[0] === null, 'a lone baseline row gives no value');
  // a row stamped one second after the minute is that minute (09:20:01 -> 09:20)
  const late = TF.changePerCandle({ t: [60, 121, 180], dce: [1, 2, 3], dpe: [1, 2, 3] }, candles(60, 3), 60);
  ok(late.map((x) => x && x.dce).join() === '1,2,3', 'a snapshot stamped 121 s counts as the minute ending at 120 s (second candle), not the third');
  const early = TF.changePerCandle({ t: [59, 120], dce: [4, 5], dpe: [4, 5] }, candles(60, 2), 60);
  ok(early[0] === null && early[1].dce === 5, 'a snapshot stamped 59 s is the minute ending at 0 s: before the first candle, so it is not counted');
  // no snapshot in a candle -> null; later candles still work
  const gap = TF.changePerCandle({ t: [60, 240], dce: [1, 9], dpe: [1, 9] }, candles(60, 4), 60);
  ok(gap[0].dce === 1 && gap[1] === null && gap[2] === null && gap[3].dce === 9, 'a candle with no snapshot minute inside it has no value (null)');
  ok(TF.changePerCandle(null, candles(60, 2), 60).every((x) => x === null), 'no flow data -> every candle null');
  ok(TF.changePerCandle({ t: [], dce: [], dpe: [] }, candles(60, 2), 60).every((x) => x === null), 'empty flow -> every candle null');
  ok(TF.changePerCandle(flow, [], 60).length === 0, 'no candles -> empty result');
  const neg = TF.changePerCandle({ t: [60, 120], dce: [-5, 3], dpe: [2, -9] }, candles(120, 1), 120);
  ok(neg[0].dce === -2 && neg[0].dpe === -7, 'negative changes add with their sign (-5 + 3, 2 + -9)');

  // conservation: the candle values add up to every counted minute exactly once
  const f2 = { t: [], dce: [], dpe: [] };
  for (let m = 1; m <= 37; m++) { f2.t.push(m * 60); f2.dce.push(m * m - 50); f2.dpe.push(3 * m - 20); }
  const sum = (arr) => arr.reduce((p, q) => p + q, 0);
  for (const tf of [60, 180, 300, 900]) {
    const r = TF.changePerCandle(f2, candles(tf, Math.ceil(37 * 60 / tf) + 1), tf);
    ok(sum(r.filter(Boolean).map((x) => x.dce)) === sum(f2.dce) && sum(r.filter(Boolean).map((x) => x.dpe)) === sum(f2.dpe),
       tf + ' s candles: the candle values add up to the total of all minutes (nothing lost, nothing counted twice)');
  }
  // no look-ahead: changing snapshots after a candle's close never changes that candle
  const f3 = { t: f2.t.slice(), dce: f2.dce.slice(), dpe: f2.dpe.slice() };
  f3.dce[20] = 999999; f3.dpe[30] = -999999;
  const r2 = TF.changePerCandle(f2, candles(300, 8), 300), r3 = TF.changePerCandle(f3, candles(300, 8), 300);
  ok(JSON.stringify(r2.slice(0, 3)) === JSON.stringify(r3.slice(0, 3)), 'altering later snapshots does not change earlier candles');
}

/* ------------------------------------------------------------------ */
console.log('\nT104 — number formatting');
{
  ok(TF.fmtFull(231448685) === '+231,448,685', 'full: +231,448,685');
  ok(TF.fmtFull(-1507935) === '−1,507,935', 'full: negative uses a minus sign and separators');
  ok(TF.fmtFull(0) === '0' && TF.fmtFull(12) === '+12', 'full: zero has no sign, small numbers keep the plus');
  ok(TF.fmtFull(NaN) === '—' && TF.fmtFull(undefined) === '—', 'full: a missing number shows a dash');
  ok(TF.fmtCompact(231448685) === '231.45M' && TF.fmtCompact(-6670535040) === '−6.67B', 'compact: 231.45M, −6.67B');
  ok(TF.fmtCompact(840000) === '840K' && TF.fmtCompact(0) === '0' && TF.fmtCompact(-5) === '−5', 'compact: K, zero and tiny negatives');
}

/* ------------------------------------------------------------------ */
console.log('\nT105 — real data: data.js changes equal the input files (every session, both formats)');
{
  const root = path.join(__dirname, '..');
  global.window = {};
  new Function('window', fs.readFileSync(path.join(root, 'web', 'generated', 'data.js'), 'utf8'))(global.window);
  const inst = global.window.CHART_DATA.instruments;
  // a date that appears in more than one input file is ambiguous (build-data keeps the last file), so it is not checked here
  const dateCount = {};
  for (const f of fs.readdirSync(path.join(root, 'input')).filter((x) => /_DASHBOARD\.json$/.test(x))) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(root, 'input', f), 'utf8'));
      const seen = new Set((raw.flow || []).map((r) => String(raw.asset).toUpperCase() + ' ' + String(r.timestamp || '').slice(0, 10)));
      seen.forEach((k) => { dateCount[k] = (dateCount[k] || 0) + 1; });
    } catch (e) { /* unreadable file: skipped by build-data too */ }
  }
  let sessions = 0, exact = true, ascending = true, oneAMinute = true, sumsOk = true, perSecondOk = false, perMinuteOk = 0;
  const epochOf = (r) => Number.isFinite(Number(r.timestamp_epoch)) ? Number(r.timestamp_epoch)
    : Date.UTC(+r.timestamp.slice(0, 4), +r.timestamp.slice(5, 7) - 1, +r.timestamp.slice(8, 10), +r.timestamp.slice(11, 13), +r.timestamp.slice(14, 16), +r.timestamp.slice(17, 19)) / 1000 - 19800;
  for (const f of fs.readdirSync(path.join(root, 'input')).filter((x) => /_DASHBOARD\.json$/.test(x))) {
    let raw; try { raw = JSON.parse(fs.readFileSync(path.join(root, 'input', f), 'utf8')); } catch (e) { continue; }
    const sym = String(raw.asset).toUpperCase();
    const byDate = {};
    for (const r of raw.flow || []) { const d = String(r.timestamp || '').slice(0, 10); (byDate[d] = byDate[d] || []).push(r); }
    for (const date of Object.keys(byDate)) {
      const day = inst[sym] && inst[sym].dates[date];
      if (!day || dateCount[sym + ' ' + date] !== 1) continue;
      sessions++;
      const fl = day.flow;
      if (!(fl && fl.t.length && fl.t.length === fl.dce.length && fl.t.length === fl.dpe.length)) { exact = false; continue; }
      for (let i = 1; i < fl.t.length; i++) {
        if (!(fl.t[i] > fl.t[i - 1])) ascending = false;
        if (Math.floor(fl.t[i] / 60) === Math.floor(fl.t[i - 1] / 60)) oneAMinute = false;
      }
      const rows = new Map(byDate[date].map((r) => [epochOf(r), r]));
      const hasChange = typeof byDate[date][0].ce_oi_change === 'number';
      let prevCe = 0, prevPe = 0;
      for (let i = 0; i < fl.t.length; i++) {
        const r = rows.get(fl.t[i]);
        if (!r) { exact = false; continue; }
        const wantCe = hasChange ? r.ce_oi_change : r.cumulative_ce - prevCe;       // derived only when the file has no change columns
        const wantPe = hasChange ? r.pe_oi_change : r.cumulative_pe - prevPe;
        if (fl.dce[i] !== wantCe || fl.dpe[i] !== wantPe) exact = false;
        prevCe = r.cumulative_ce; prevPe = r.cumulative_pe;
      }
      // the changes add up to the file's final cumulative value
      const lastRow = byDate[date][byDate[date].length - 1];
      const keptLast = rows.get(fl.t[fl.t.length - 1]);
      const total = (arr) => arr.reduce((p, q) => p + q, 0);
      if (total(fl.dce) !== keptLast.cumulative_ce || total(fl.dpe) !== keptLast.cumulative_pe) sumsOk = false;
      if (hasChange) perMinuteOk++;
      if (!hasChange && byDate[date].length > 5000) perSecondOk = fl.t.length < 500 && lastRow.cumulative_ce !== undefined;
    }
  }
  ok(sessions >= 5, 'sessions with flow data found (' + sessions + ')');
  ok(exact, 'every stored change equals the file\'s ce_oi_change / pe_oi_change (or, for the per-second file with no change columns, the difference of the cumulative values)');
  ok(ascending && oneAMinute, 'snapshots are ascending with at most one per minute');
  ok(sumsOk, 'for every session the stored changes add up to the cumulative value of the last stored snapshot');
  ok(perMinuteOk >= 5, 'per-minute files carry the change columns directly (' + perMinuteOk + ' sessions)');
  if (perSecondOk) ok(true, 'a per-second file (no change columns) is derived from the cumulative values and reduced to about one snapshot per minute');
  else console.log('  note: no unambiguous per-second file in input/ right now \u2014 that derivation is not exercised on real data');

  // on real candles: 1-minute candles show exactly the file's per-minute change; longer candles add the minutes up
  const day = inst.NIFTY.dates['2026-10-22'];
  const c1 = []; for (let t = day.sessionStart; t <= day.sessionEnd; t += 60) c1.push({ time: t });
  const p1 = TF.changePerCandle(day.flow, c1, 60);
  const idx = new Map(day.flow.t.map((t, i) => [Math.floor(t / 60) * 60, i]));
  let oneMinOk = true;
  p1.forEach((x, i) => { const k = idx.get(c1[i].time + 60); if (k !== undefined && (!x || x.dce !== day.flow.dce[k] || x.dpe !== day.flow.dpe[k] || x.minutes !== 1)) oneMinOk = false; });
  ok(oneMinOk, 'NIFTY 22-10, 1-minute candles: every candle shows exactly the file\'s change for its minute');
  const c5 = []; for (let t = day.sessionStart; t <= day.sessionEnd; t += 300) c5.push({ time: t });
  const p5 = TF.changePerCandle(day.flow, c5, 300);
  const first5 = p5[0], expect5 = day.flow.dce.slice(1, 6).reduce((p, q) => p + q, 0);
  ok(first5.minutes === 5 && first5.dce === expect5, 'NIFTY 22-10, first 5-minute candle (09:15-09:20) = the five minute changes 09:16 to 09:20 added up');
  ok(p5.filter(Boolean).reduce((p, x) => p + x.dce, 0) === day.flow.dce.slice(1).reduce((p, q) => p + q, 0), '5-minute candles together add up to the whole session (the 09:15 baseline excluded)');
}

/* ------------------------------------------------------------------ */
console.log('\nT106 — browser wiring (static source assertions; live checks in the preview)');
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  ok(/<script src="\.\.\/src\/oi-flow\.js"><\/script>/.test(html), 'page loads oi-flow.js');
  ok(!/oi-chart/.test(html) && (html.match(/data-role="oi-legend"/g) || []).length === 2, 'no separate OI pane any more: only the readout row (markup + lookup) remains, in the HTF panel');
  ok(/TF_\.changePerCandle\(ticks\.meta\.flow/.test(html), 'the pane is fed by changePerCandle (the change of the minutes inside each candle)');
  ok(/this\.ceSeries = this\.chart\.addLineSeries\(\{\s*priceScaleId: 'left'/.test(html) && /this\.peSeries = this\.chart\.addLineSeries\(\{\s*priceScaleId: 'left'/.test(html), 'CE and PE OI change are two line series of the HTF PRICE chart, on its left price scale');
  ok(/leftPriceScale: \{ visible: true[^}]*scaleMargins: \{ top: OI_BAND_TOP/.test(html) && /leftPriceScale: \{ visible: true, borderColor: '#2a2e39', minimumWidth: 66 \}/.test(html), 'the lines sit in a band under the candles; the RSI chart carries an identical left scale so the time axes stay aligned');
  ok(/drawOiLegend\(/.test(html) && !/mirror\('oi'/.test(html), 'the readout row is wired; no extra crosshair mirroring is needed (same chart as the candles)');
  ok(!/Cum CE|Cum PE|alignToCandles/.test(html), 'the cumulative CE / PE lines are gone');
  console.log('  manual (done in the preview): candles in the upper part of the HTF price chart, red CE OI change and green PE OI change lines in a band under them');
  console.log('  with their own left axis, both values in the readout row above; HTF price and RSI time axes aligned; all five HTF timeframes; NIFTY and SENSEX; LTF unchanged.');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
