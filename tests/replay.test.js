#!/usr/bin/env node
/**
 * replay.test.js — the page's BAR REPLAY: src/replay.js (pure helpers) and its wiring in web/index.html.
 * The point of the feature: at any replay time only the ticks up to that time exist, so nothing on screen can use a later price.
 *
 * Run: node tests/replay.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = require('../src/replay.js');

let pass = 0, fail = 0;
function ok(cond, label) { if (cond) { pass++; console.log('  ✓ ' + label); } else { fail++; console.error('  ✗ FAIL — ' + label); } }
const J = JSON.stringify;

console.log('\nT140 — time helpers');
{
  const times = Float64Array.from([100, 101, 102, 105, 106]);
  ok(R.lastIndexAtOrBefore(times, 99) === -1 && R.lastIndexAtOrBefore(times, 100) === 0 && R.lastIndexAtOrBefore(times, 104) === 2 && R.lastIndexAtOrBefore(times, 106) === 4 && R.lastIndexAtOrBefore(times, 999) === 4, 'last index at or before a time (before the first / on a tick / in a gap / at the end / after)');
  ok(R.closeTimeOfCandle(1000, 12, 1) === 1011 && R.closeTimeOfCandle(1000, 12, 3) === 1035, 'the k-th 12 s candle covers up to t0 + k·12 − 1');
  ok(R.candleCountAt(1000, 12, 1011) === 1 && R.candleCountAt(1000, 12, 1010) === 0 && R.candleCountAt(1000, 12, 1035) === 3 && R.candleCountAt(1000, 12, 999) === 0, 'complete candles at a time: the k-th counts only once its last second is covered');
  ok(R.candleCountAt(5, 60, R.closeTimeOfCandle(5, 60, 7)) === 7, 'closeTimeOfCandle and candleCountAt are inverse');
}

console.log('\nT141 — truncateTicks: only the past exists');
{
  const full = { times: Float64Array.from([10, 11, 12, 13, 14]), prices: Float64Array.from([1, 2, 3, 4, 5]),
                 meta: { sessionEnd: 14, decimals: 2, flow: { t: [9, 12, 14], dce: [1, 2, 3], dpe: [4, 5, 6] } } };
  const v = R.truncateTicks(full, 12.5);
  ok(J(Array.from(v.times)) === '[10,11,12]' && J(Array.from(v.prices)) === '[1,2,3]', 'ticks after the replay time are gone');
  ok(v.meta.sessionEnd === 12 && v.meta.decimals === 2, 'sessionEnd becomes the last tick shown (a forming candle is never "complete"); other meta is kept');
  ok(J(v.meta.flow) === J({ t: [9, 12], dce: [1, 2], dpe: [4, 5] }), 'the option-chain flow is cut as well');
  ok(full.times.length === 5 && full.meta.sessionEnd === 14 && full.meta.flow.t.length === 3, 'the full session is not modified');
  ok(R.truncateTicks(full, 9) === null && R.truncateTicks(null, 12) === null && R.truncateTicks({ times: [], prices: [], meta: {} }, 1) === null, 'before the first tick (or no data) -> null');
  ok(R.truncateTicks({ times: [1, 2], prices: [3, 4], meta: { flow: null } }, 5).meta.flow === null, 'a session without flow stays without flow');
  ok(R.truncateTicks(full, 1e9).times.length === 5, 'a replay time past the end shows everything');
}

const dataFile = path.join(__dirname, '..', 'web', 'generated', 'data.js');
const HAVE_DATA = fs.existsSync(dataFile);
if (!HAVE_DATA) console.log('\n  note: web/generated/data.js is not present (run `npm run build` with input/ data) — T142 and T144 are skipped');
console.log('\nT142 — no look-ahead on real data: candles built from the truncated session are the first candles of the full session');
if (HAVE_DATA) {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8');
  const m = html.match(/function buildCandles\(ticks, tf\) \{[\s\S]*?\n\}/);
  ok(!!m, 'buildCandles() extracted from web/index.html');
  const buildCandles = new Function('return (' + m[0] + ')')();
  const sandbox = { window: {} };
  new Function('window', fs.readFileSync(path.join(root, 'web', 'generated', 'data.js'), 'utf8'))(sandbox.window);
  const DATA = sandbox.window.CHART_DATA;
  const sym = Object.keys(DATA.instruments)[0], date = Object.keys(DATA.instruments[sym].dates)[0];
  const day = DATA.instruments[sym].dates[date];
  let n = 0; for (const seg of day.segments) n += seg.prices.length;
  const times = new Float64Array(n), prices = new Float64Array(n);
  let i = 0; for (const seg of day.segments) for (let k = 0; k < seg.prices.length; k++) { times[i] = seg.start + k; prices[i] = seg.prices[k]; i++; }
  const full = { times, prices, meta: day };
  const t0 = times[0];
  let same = true, checked = 0, tail = true;
  for (const tf of [12, 36, 60, 180]) {
    const whole = buildCandles(full, tf);
    for (const k of [1, 2, 7, 50, 120, 300]) {
      if (k * tf > times[n - 1] - t0) continue;
      const view = R.truncateTicks(full, R.closeTimeOfCandle(t0, tf, k));
      const part = buildCandles(view, tf);
      checked++;
      if (part.length !== k) { same = false; break; }
      for (let c = 0; c < k; c++) if (J(part[c]) !== J(whole[c])) { same = false; break; }
      if (view.times[view.times.length - 1] > R.closeTimeOfCandle(t0, tf, k)) tail = false;
    }
  }
  ok(checked > 10 && same, 'for 12 / 36 / 60 / 180 s candles and several replay points, every candle of the truncated build equals the same candle of the full build (' + checked + ' cases)');
  ok(tail, 'no tick later than the replay time is ever in the truncated session');
  // a higher timeframe candle that is still forming is built from the ticks seen so far only
  const k = 100, view = R.truncateTicks(full, R.closeTimeOfCandle(t0, 12, k));
  const htfPart = buildCandles(view, 60), htfWhole = buildCandles(full, 60);
  const last = htfPart[htfPart.length - 1];
  ok(htfPart.length === Math.ceil(k * 12 / 60) && htfPart.slice(0, -1).every((c, j) => J(c) === J(htfWhole[j])) && last.high <= htfWhole[htfPart.length - 1].high && last.low >= htfWhole[htfPart.length - 1].low,
     'a 1-minute candle still forming at the replay time is a prefix of the full candle (its high is not above, its low not below the final one)');
}

console.log('\nT144 — no look-ahead in the signals: the signals found on the truncated session are a subset of the full session\'s, and none that was already knowable is missing');
if (HAVE_DATA) {
  const root = path.join(__dirname, '..');
  const TC = require('../src/confirmation.js'), TL = require('../src/ltf-conditions.js'), TS = require('../src/strategies.js');
  const html = fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8');
  const buildCandles = new Function('return (' + html.match(/function buildCandles\(ticks, tf\) \{[\s\S]*?\n\}/)[0] + ')')();
  const rd = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
  const htfRaw = rd('config/htf.json'), ltfRaw = rd('config/ltf.json');
  const filter = TC.normalizeFilter(htfRaw); filter.rsi = TC.normalizeSmaRsiFilter(htfRaw); filter.oi = TC.normalizeOiFilter(htfRaw);
  filter.oiInv = TC.normalizeOiFilterInverse(htfRaw);   // swapped-direction OI gate (mirrors the page / back-test)
  const cfgs = { c1: TL.normalizeCondition1(ltfRaw), c2: TL.normalizeCondition2(ltfRaw), c3: TL.normalizeCondition3(ltfRaw), c4: TL.normalizeCondition4(ltfRaw), c5: TL.normalizeCondition5(ltfRaw), c6: TL.normalizeCondition6(ltfRaw) };
  const reg = TS.normalizeRegistry(rd('config/strategies.json')), entry = reg.byName.SB_Bhanusali;
  const cfgOk = Object.values(cfgs).every((c) => c.mode !== 'error') && filter.mode !== 'error';
  if (!cfgOk) console.log('  note: the shipped config does not validate right now — T144 skipped');
  else {
    const sandbox = { window: {} };
    new Function('window', fs.readFileSync(dataFile, 'utf8'))(sandbox.window);
    const DATA = sandbox.window.CHART_DATA;
    const sym = Object.keys(DATA.instruments)[0];
    let cases = 0, leaks = 0, missing = 0, fullSignals = 0;
    for (const date of Object.keys(DATA.instruments[sym].dates)) {
      const day = DATA.instruments[sym].dates[date];
      let n = 0; for (const seg of day.segments) n += seg.prices.length;
      const times = new Float64Array(n), prices = new Float64Array(n);
      let i = 0; for (const seg of day.segments) for (let k = 0; k < seg.prices.length; k++) { times[i] = seg.start + k; prices[i] = seg.prices[k]; i++; }
      const full = { times, prices, meta: day }, t0 = times[0];
      const signalsOf = (ticks, ltf) => {
        const htf = ltf * 5, lc = buildCandles(ticks, ltf), hc = buildCandles(ticks, htf);
        const states = TC.evaluate(hc, { htfSec: htf, sessionEndTick: ticks.meta.sessionEnd, filter });
        const chain = TL.runChain(lc, TL.windowsFromStates(states, htf), cfgs, TC.rsiArray);
        return TS.signalsFor(entry, { chain });
      };
      for (const ltf of [12, 36]) {
        const whole = signalsOf(full, ltf);
        fullSignals += whole.length;
        const key = (s) => s.time + s.pattern;
        for (const frac of [0.25, 0.5, 0.75]) {
          const T = R.closeTimeOfCandle(t0, ltf, Math.floor((times[n - 1] - t0) * frac / ltf));
          const part = signalsOf(R.truncateTicks(full, T), ltf);
          const wholeKeys = new Set(whole.map(key));
          cases++;
          leaks += part.filter((s) => !wholeKeys.has(key(s)) || s.time + ltf - 1 > T).length;                      // found on the past that the full session does not have, or beyond the replay time
          const partKeys = new Set(part.map(key));
          missing += whole.filter((s) => s.time + ltf - 1 <= T && (s.windowCloseTime || 0) - 1 <= T && !partKeys.has(key(s))).length;   // already knowable at T but not found
        }
      }
    }
    ok(cases > 0, 'checked ' + cases + ' (session × LTF × replay point) cases covering ' + fullSignals + ' full-session signals');
    ok(leaks === 0, 'no signal on the truncated session is missing from the full session or lies beyond the replay time (leaks: ' + leaks + ')');
    ok(missing === 0, 'every full-session signal that was already knowable at the replay time is also found on the truncated session (missing: ' + missing + ')');
  }
}

console.log('\nT143 — page wiring (static source assertions)');
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  ok(/<script src="\.\.\/src\/replay\.js"><\/script>/.test(html) && /window\.TickReplay/.test(html), 'the page loads src/replay.js');
  ok(/id="rp-enter"/.test(html) && /id="rp-play"/.test(html) && /id="rp-back"/.test(html) && /id="rp-fwd"/.test(html) && /id="rp-speed"/.test(html) && /id="rp-slider"/.test(html) && /id="rp-exit"/.test(html), 'toolbar has Bar replay, play / pause, back, forward, speed, slider and exit');
  ok(/TR\.truncateTicks\(full, app\.replay\.time\)/.test(html), 'getTicks() returns the truncated session while a replay is on — every panel and the strategy read their ticks from it');
  ok(/const replaying = !!\(app\.replay && app\.replay\.time != null\);[\s\S]{0,200}if \(!replaying && confirmCache\.has\(key\)\)/.test(html), 'the HTF states cache is bypassed while replaying (no stale states)');
  ok(/subscribeClick\(\(param\) => \{ if \(app\.replay && app\.replay\.armed/.test(html), 'a click on a chart picks the start candle');
  ok(/openTrades/.test(html) && /entryMarker\(t, true\)/.test(html) && /open: true/.test(html) && /\(open\)/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'trade-view.js'), 'utf8')), 'a trade that has not hit its stop / target yet is shown as open (its box runs on to the right edge, its label says "(open)"), not as an end-of-session exit');
  ok(/rpReset\(\);\n  app\.symbol = instrumentEl\.value;/.test(html) && /dateEl\.addEventListener\('change', \(\) => \{\n  rpReset\(\);/.test(html), 'changing the instrument or date leaves replay mode');
  ok(/id="rp-window"/.test(html) && /function rpFollow\(p\)/.test(html) && /setVisibleLogicalRange\(\{ from, to \}\)/.test(html), 'a fixed number of candles is kept in view at every step (bars-in-view select), so the candles stay readable');
  console.log('  manual (browser): Bar replay → click a candle → the charts show only candles up to it; ▶ plays, ⏮ ⏭ and the arrow keys step one LTF candle, the slider jumps, Space pauses, Esc / Exit returns.');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
