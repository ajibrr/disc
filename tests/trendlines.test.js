#!/usr/bin/env node
/**
 * trendlines.test.js — trend-line drawing on the price charts (src/trendlines.js + its wiring in index.html).
 *
 * Lines are stored as time / price anchors, so they survive zoom, resize and a change of timeframe; this suite covers the
 * pure parts: the coordinate maths, hit-testing, storage and sanitizing.
 *
 * Run: node tests/trendlines.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const TL = require('../src/trendlines.js');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.error('  ✗ FAIL — ' + label); }
}
const near = (a, b) => Math.abs(a - b) < 1e-9;
/** A linear map: 1 second = 0.1 px, price 100 at y 200 and 1 point = -2 px (higher price = smaller y). */
const MAP = { x: (t) => t * 0.1, y: (p) => 200 - (p - 100) * 2 };

/* ------------------------------------------------------------------ */
console.log('\nT113 — time <-> bar position');
{
  ok(TL.toLogical(1000, 60, 1000) === 0 && TL.toLogical(1000, 60, 1060) === 1 && TL.toLogical(1000, 60, 1030) === 0.5, '1m candles: bar 0 at the first candle, 1 one candle later, 0.5 halfway');
  ok(near(TL.toTime(1000, 60, TL.toLogical(1000, 60, 1234)), 1234), 'toTime(toLogical(t)) returns t');
  ok(TL.toLogical(1000, 60, 400) < 0 && TL.toLogical(1000, 60, 1000 + 60 * 500) === 500, 'positions before the first and after the last candle are allowed (a line may start early or extend)');
  ok(near(TL.toLogical(0, 300, 900) / TL.toLogical(0, 60, 900), 1 / 5), 'the same time is one fifth as many bars on a 5-times longer candle (lines survive a timeframe change)');
  ok(TL.key('NIFTY', '2026-10-23', 'htf') === 'NIFTY|2026-10-23|htf' && TL.key('NIFTY', '2026-10-23', 'ltf') !== TL.key('NIFTY', '2026-10-23', 'htf'), 'storage key = instrument | date | panel');
}

/* ------------------------------------------------------------------ */
console.log('\nT114 — creating and sanitizing lines');
{
  const a = TL.newLine(1, 100, 2, 110), b = TL.newLine(1, 100, 2, 110);
  ok(a.id !== b.id && a.t1 === 1 && a.p2 === 110, 'newLine carries the anchors and a unique id');
  ok(a.extend === true && /^#[0-9a-f]{6}$/i.test(a.color), 'defaults: extended to the right, hex colour');
  ok(TL.newLine(1, 1, 2, 2, { extend: false, color: '#ff0000' }).extend === false && TL.newLine(1, 1, 2, 2, { color: '#ff0000' }).color === '#ff0000', 'options are honoured');
  const s = TL.sanitize([
    { id: 'a', t1: 1, p1: 1, t2: 2, p2: 2, color: '#123456', extend: false },
    { id: 'b', t1: 1, p1: 1, t2: 1, p2: 1 },                         // a point
    { id: 'c', t1: 'x', p1: 1, t2: 2, p2: 2 },                       // not a number
    { id: 'd', t1: 1, p1: NaN, t2: 2, p2: 2 },                       // not finite
    null, 5, 'text',
    { t1: 5, p1: 5, t2: 6, p2: 7, color: 'red' },                    // no id, bad colour
  ]);
  ok(s.length === 2 && s[0].id === 'a' && s[0].extend === false && s[0].color === '#123456', 'well-formed lines are kept as they are');
  ok(s[1].id && s[1].color === TL.COLORS[0] && s[1].extend === true, 'a missing id gets one, a bad colour falls back to the default, extend defaults to true');
  ok(Array.isArray(TL.sanitize(null)) && TL.sanitize({}).length === 0 && TL.sanitize(undefined).length === 0, 'anything that is not an array gives an empty list');
  ok(TL.sanitize([{ t1: 1, p1: 1, t2: 1, p2: 5 }]).length === 1, 'a vertical line (same time, different price) is allowed');
}

/* ------------------------------------------------------------------ */
console.log('\nT115 — storage');
{
  const mem = () => { const d = {}; return { getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, _d: d }; };
  const st = mem();
  const line = TL.newLine(1000, 22500, 2000, 22600, { color: '#ff9800' });
  ok(TL.saveAll(st, { 'NIFTY|2026-10-23|htf': [line], 'NIFTY|2026-10-23|ltf': [] }) === true, 'saveAll reports success');
  const back = TL.loadAll(st);
  ok(Object.keys(back).join() === 'NIFTY|2026-10-23|htf', 'empty buckets are not stored');
  ok(JSON.stringify(back['NIFTY|2026-10-23|htf'][0]) === JSON.stringify(line), 'a saved line comes back identical');
  ok(Object.keys(TL.loadAll(mem())).length === 0, 'nothing saved -> empty');
  const corrupt = mem(); corrupt.setItem(TL.STORAGE_KEY, '{not json');
  ok(Object.keys(TL.loadAll(corrupt)).length === 0, 'corrupt JSON -> empty, no exception');
  const arr = mem(); arr.setItem(TL.STORAGE_KEY, '[1,2,3]');
  ok(Object.keys(TL.loadAll(arr)).length === 0, 'a JSON array instead of an object -> empty');
  const dirty = mem(); dirty.setItem(TL.STORAGE_KEY, JSON.stringify({ k: [{ t1: 1, p1: 1, t2: 2, p2: 2, id: 'ok' }, { bad: true }], k2: 'x' }));
  const d2 = TL.loadAll(dirty);
  ok(d2.k.length === 1 && d2.k[0].id === 'ok' && !('k2' in d2), 'stored data is sanitized on the way in');
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  ok(Object.keys(TL.loadAll(throwing)).length === 0 && TL.saveAll(throwing, { a: [line] }) === false, 'blocked storage (private window) -> no exception, save reports false');
  ok(Object.keys(TL.loadAll(null)).length === 0, 'no storage object at all -> empty');
}

/* ------------------------------------------------------------------ */
console.log('\nT116 — screen end points and the extension to the right');
{
  const line = TL.newLine(1000, 100, 2000, 110);                       // x 100 -> 200, y 200 -> 180
  const s = TL.screenPoints(line, MAP, 500);
  ok(near(s.x1, 100) && near(s.y1, 200) && near(s.x2, 200) && near(s.y2, 180), 'anchors map to pixels');
  ok(near(s.ex, 500) && near(s.ey, 180 + (-20 / 100) * (500 - 200)), 'extended to the right edge along the same slope (y 120 at x 500)');
  const flat = TL.screenPoints(Object.assign({}, line, { extend: false }), MAP, 500);
  ok(flat.ex === flat.x2 && flat.ey === flat.y2, 'extend:false stops at the second anchor');
  const rev = TL.screenPoints(TL.newLine(2000, 110, 1000, 100), MAP, 500);
  ok(near(rev.ex, 500) && near(rev.ey, 120), 'anchors in the other order: the extension still starts at the right-most anchor');
  const narrow = TL.screenPoints(line, MAP, 150);
  ok(narrow.ex === 200 && narrow.ey === 180, 'a plot narrower than the line does not shorten it');
  const vert = TL.screenPoints(TL.newLine(1000, 100, 1000, 120), MAP, 500);
  ok(vert.ex === vert.x2 && vert.ey === vert.y2, 'a vertical line is never extended');
  ok(TL.screenPoints(line, { x: () => null, y: MAP.y }, 500) === null && TL.screenPoints(line, { x: MAP.x, y: () => NaN }, 500) === null, 'an unavailable coordinate -> null (nothing drawn)');
  ok(near(TL.priceAt(line, 1500), 105) && near(TL.priceAt(line, 3000), 120) && TL.priceAt(TL.newLine(1, 1, 1, 5), 1) === null, 'priceAt follows the line (and beyond it); a vertical line has no price at a time');
}

/* ------------------------------------------------------------------ */
console.log('\nT117 — hit-testing: handles, body, top-most line');
{
  ok(near(TL.distToSegment(5, 5, 0, 0, 10, 0), 5) && near(TL.distToSegment(-3, 0, 0, 0, 10, 0), 3) && near(TL.distToSegment(5, 0, 3, 3, 3, 3), Math.hypot(2, 3)), 'distToSegment: perpendicular, beyond the end, degenerate segment');
  const l1 = TL.newLine(1000, 100, 2000, 110, { extend: false });       // (100,200) -> (200,180)
  const lines = [l1];
  ok(JSON.stringify(TL.hitTest(lines, MAP, 500, 100, 200)) === JSON.stringify({ id: l1.id, part: 'p1' }), 'on the first anchor -> handle p1');
  ok(TL.hitTest(lines, MAP, 500, 203, 183).part === 'p2', 'near the second anchor -> handle p2');
  ok(JSON.stringify(TL.hitTest(lines, MAP, 500, 150, 190)) === JSON.stringify({ id: l1.id, part: 'body' }), 'on the middle of the line -> body');
  ok(TL.hitTest(lines, MAP, 500, 150, 215) === null, 'well away from the line -> nothing');
  ok(TL.hitTest(lines, MAP, 500, 150, 197, 3) === null && TL.hitTest(lines, MAP, 500, 150, 197, 8) !== null, 'the tolerance is honoured (3 px misses, 8 px hits)');
  ok(TL.hitTest(lines, MAP, 500, 300, 160) === null, 'beyond the end of a non-extended line -> nothing');
  const ext = TL.newLine(1000, 100, 2000, 110, { extend: true });
  ok(TL.hitTest([ext], MAP, 500, 400, 140).part === 'body', 'the extended part of an extended line can be hit');
  const top = TL.newLine(1000, 100, 2000, 110), under = TL.newLine(1000, 100, 2000, 110);
  ok(TL.hitTest([under, top], MAP, 500, 150, 190).id === top.id, 'overlapping lines: the one drawn last (on top) wins');
  const h = TL.newLine(1000, 100, 1500, 100, { extend: false }), g = TL.newLine(1100, 90, 1100, 110, { extend: false });   // a handle of one on the body of another
  ok(TL.hitTest([h, g], MAP, 500, 100, 200).part === 'p1' && TL.hitTest([h, g], MAP, 500, 100, 200).id === h.id, 'a handle beats a body that crosses it');
  ok(TL.hitTest([], MAP, 500, 1, 1) === null && TL.hitTest([l1], { x: () => null, y: MAP.y }, 500, 1, 1) === null, 'no lines / unavailable coordinates -> nothing');
}

/* ------------------------------------------------------------------ */
console.log('\nT118 — moving and reshaping');
{
  const l = TL.newLine(1000, 100, 2000, 110);
  const m = TL.moved(l, 50, -5);
  ok(m.t1 === 1050 && m.t2 === 2050 && m.p1 === 95 && m.p2 === 105 && m.id === l.id && l.t1 === 1000, 'moved shifts both anchors by the same time / price offset and keeps the id; the original is untouched');
  ok(near(TL.priceAt(m, 1050) - TL.priceAt(l, 1000), -5) && (m.p2 - m.p1) === (l.p2 - l.p1), 'moving keeps the slope');
  const a = TL.withAnchor(l, 'p1', 900, 99), b = TL.withAnchor(l, 'p2', 2100, 120);
  ok(a.t1 === 900 && a.p1 === 99 && a.t2 === 2000 && a.p2 === 110 && b.t2 === 2100 && b.p2 === 120 && b.t1 === 1000, 'withAnchor replaces only the chosen anchor');
}

/* ------------------------------------------------------------------ */
console.log('\nT120 \u2014 parallel line through a point');
{
  const base = TL.newLine(1000, 100, 2000, 110, { color: '#ff9800', extend: false });
  const par = TL.parallelThrough(base, 1500, 130);                       // base is at 105 at t = 1500: 25 above it
  ok(par && par.t1 === 1000 && par.t2 === 2000, 'the parallel keeps the base line\'s two times');
  ok(near(par.p1 - base.p1, 25) && near(par.p2 - base.p2, 25), 'both prices are shifted by the same amount (+25)');
  ok(near(TL.priceAt(par, 1500), 130), 'the parallel passes exactly through the chosen point');
  ok(near((par.p2 - par.p1) / (par.t2 - par.t1), (base.p2 - base.p1) / (base.t2 - base.t1)), 'same slope as the base line');
  ok(par.color === '#ff9800' && par.extend === false && par.id !== base.id, 'colour and extension are inherited; it is a new line with its own id');
  const below = TL.parallelThrough(base, 1800, 90);                      // base is 108 at t = 1800: 18 below it
  ok(near(TL.priceAt(below, 1800), 90) && near(below.p1 - base.p1, -18), 'a point below the line gives a parallel below it');
  ok(near(TL.priceAt(TL.parallelThrough(base, 5000, 200), 5000), 200), 'the chosen point may lie beyond the base line (extension side): still exactly through it');
  ok(TL.parallelThrough(base, 1500, 105) === null, 'a point exactly on the base line gives nothing (it would sit on top of it)');
  ok(TL.parallelThrough(TL.newLine(1000, 100, 1000, 120), 1000, 130) === null, 'a vertical base line has no slope to copy -> nothing');
  ok(base.p1 === 100 && base.p2 === 110 && base.t1 === 1000, 'the base line is not modified');
  // a parallel is an ordinary line: it can be hit, moved and reshaped independently
  const lines = [base, par];
  ok(TL.hitTest(lines, MAP, 500, MAP.x(1500), MAP.y(130)).id === par.id, 'the parallel can be picked on its own');
}

/* ------------------------------------------------------------------ */
console.log('\nT119 — browser wiring (static source assertions; interaction was checked in the preview)');
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  ok(/<script src="\.\.\/src\/trendlines\.js"><\/script>/.test(html), 'page loads trendlines.js');
  ok(/id="tl-draw"/.test(html) && /id="tl-color"/.test(html) && /id="tl-extend"/.test(html) && /id="tl-delete"/.test(html) && /id="tl-clear"/.test(html), 'toolbar has Draw, colour, extend, delete and clear controls');
  ok(/this\.series\.attachPrimitive\(\{[\s\S]{0,200}_linesRU/.test(html), 'lines are drawn by a series primitive on the price chart (HTF and LTF)');
  ok(/TL_\.hitTest\(/.test(html) && /TL_\.screenPoints\(/.test(html) && /TL_\.saveAll\(/.test(html) && /TL_\.loadAll\(/.test(html), 'the page uses the shared hit-test, geometry and storage helpers');
  ok(/e\.key === 'Escape'/.test(html) && /'Delete'/.test(html), 'Esc cancels drawing, Delete removes the selected line');
  ok(/id="tl-parallel"/.test(html) && /TL_\.parallelThrough\(/.test(html) && /setParallelArmed\(false\)/.test(html), 'a Parallel button creates a parallel line through the next click (Esc cancels it)');
  ok(/context\.lineWidth = 1;/.test(html) && !/context\.lineWidth = selected/.test(html), 'every trend line is drawn 1 px wide');
  ok(/<input type="checkbox" id="tl-extend" \/>/.test(html), 'new lines are NOT extended to the right edge by default (the Extend switch starts off)');
  console.log('  manual (done in the preview): click Draw, click twice on a price chart -> a line; drag its ends or body; Delete removes it; lines persist after a reload;');
  console.log('  they follow the zoom / pan and survive a timeframe change; HTF and LTF each keep their own lines per instrument and date.');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
