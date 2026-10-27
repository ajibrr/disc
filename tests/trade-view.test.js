#!/usr/bin/env node
/**
 * trade-view.test.js — how a trade is drawn on the LTF chart: src/trade-view.js (pure geometry) and its wiring in web/index.html.
 * Run: node tests/trade-view.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const V = require('../src/trade-view.js');

let pass = 0, fail = 0;
function ok(cond, label) { if (cond) { pass++; console.log('  ✓ ' + label); } else { fail++; console.error('  ✗ FAIL — ' + label); } }

// chart: time t -> x = t*10, price p -> y = 1000 - p (a higher price is higher on the screen = smaller y), candle 6 px wide
const C = { xOf: (t) => t * 10, yOf: (p) => 1000 - p, bar: 6, right: 900, height: 500 };
const role = (arr, r) => arr.find((s) => s.role === r);

console.log('\nT150 — a winning long');
{
  const sh = V.shapes({ side: 'LONG', entryTime: 10, exitTime: 14, entry: 100, stop: 95, target: 112, pnl: 12 }, C);
  const entryCol = role(sh, 'entry-column'), exitCol = role(sh, 'exit-column'), profit = role(sh, 'profit-zone'), loss = role(sh, 'loss-zone'), outline = role(sh, 'outline');
  ok(entryCol.x === 97 && entryCol.w === 6 && entryCol.y === 0 && entryCol.h === 500, 'the entry candle gets a full-height column centred on it (x 100 ± 3)');
  ok(exitCol.x === 137 && exitCol.w === 6 && /0,230,118/.test(exitCol.fill), 'the exit candle gets a full-height GREEN column (a profit)');
  ok(profit.x === 97 && profit.w === 46 && profit.y === 888 && profit.h === 12, 'the box runs from the left edge of the entry candle to the right edge of the exit candle; the profit zone spans entry → target (y 888..900)');
  ok(loss.y === 900 && loss.h === 5, 'the loss zone spans entry → stop (y 900..905), below the entry for a long');
  ok(outline.y === 888 && outline.h === 17 && /0,230,118/.test(outline.color), 'the outline covers stop → target and is green for a winner');
  const lines = sh.filter((s) => s.type === 'line');
  ok(lines.length === 3 && lines.every((l) => l.x1 === 97 && l.x2 === 143 && l.dash), 'three dashed level lines (entry, target, stop) across the box');
  ok(role(sh, 'entry-line').y1 === 900 && role(sh, 'target-line').y1 === 888 && role(sh, 'stop-line').y1 === 905, 'at the entry, target and stop prices');
}

console.log('\nT151 — a losing short, a flat trade, an open trade');
{
  const loser = V.shapes({ side: 'SHORT', entryTime: 20, exitTime: 21, entry: 100, stop: 104, target: 88, pnl: -4 }, C);
  ok(/255,23,68/.test(role(loser, 'exit-column').fill) && /255,23,68/.test(role(loser, 'outline').color), 'a loser has a RED exit column and outline');
  ok(role(loser, 'profit-zone').y === 900 && role(loser, 'profit-zone').h === 12 && role(loser, 'loss-zone').y === 896 && role(loser, 'loss-zone').h === 4, 'short: the profit zone is below the entry (target 88 → y 912) and the loss zone above it (stop 104 → y 896)');
  const flat = V.shapes({ side: 'LONG', entryTime: 20, exitTime: 22, entry: 100, stop: 96, target: 108, pnl: 0 }, C);
  ok(/158,158,158/.test(role(flat, 'exit-column').fill), 'a break-even trade is grey');
  const open = V.shapes({ side: 'LONG', entryTime: 30, exitTime: null, entry: 100, stop: 96, target: 108, open: true }, C);
  ok(!role(open, 'exit-column') && role(open, 'entry-column') && role(open, 'profit-zone').x + role(open, 'profit-zone').w === 900, 'an open trade has no exit column and its box runs to the right edge of the chart');
  ok(/255,255,255/.test(role(open, 'outline').color), 'an open trade has a neutral outline');
}

console.log('\nT152 — candles outside the view, bad input');
{
  const noX = Object.assign({}, C, { xOf: (t) => (t === 14 ? null : t * 10) });
  ok(V.shapes({ side: 'LONG', entryTime: 10, exitTime: 14, entry: 100, stop: 95, target: 112, pnl: 1 }, noX).length === 0, 'a missing exit coordinate draws nothing (never half a trade)');
  ok(V.shapes({ side: 'LONG', entryTime: 10, exitTime: 14, entry: 100, stop: 95, target: 112, pnl: 1 }, Object.assign({}, C, { yOf: () => NaN })).length === 0, 'a non-finite price coordinate draws nothing');
  ok(V.shapes(null, C).length === 0 && V.shapes({}, null).length === 0, 'missing input gives nothing and never throws');
  ok(V.shapes({ side: 'LONG', entryTime: 10, exitTime: 10, entry: 100, stop: 95, target: 112, pnl: 1 }, C).length > 0, 'entry and exit on the same candle still draw (one candle wide box)');
}

console.log('\nT153 — labels');
{
  ok(V.entryLabel('LONG', 22850.55, 2, false) === '🟢 LONG 22850.55' && V.entryLabel('SHORT', 22850.5, 2, false) === '🔴 SHORT 22850.50', 'entry labels carry a green / red emoji');
  ok(V.entryLabel('LONG', 100, 1, true) === '🟢 LONG 100.0 (open)', 'an open trade says so');
  ok(V.exitLabel('TARGET', 14.35) === '✅ TP +14.35' && V.exitLabel('STOP', -3.75) === '❌ SL −3.75' && V.exitLabel('HARD', 2) === '⏰ HARD +2.00' && V.exitLabel('EOD', 0) === '🔚 EOD 0.00', 'exit labels: target ✅, stop ❌, hard exit ⏰, end of session 🔚, with the signed P&L');
}

console.log('\nT154 — page wiring (static source assertions)');
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  ok(/<script src="\.\.\/src\/trade-view\.js"><\/script>/.test(html) && /window\.TickTradeView/.test(html), 'the page loads src/trade-view.js');
  ok(/drawTrades\(target\)/.test(html) && /TV\.shapes\(box, geom\)/.test(html) && /setTradeBoxes\(tradeBoxes\)/.test(html), 'the LTF chart paints the trade shapes and is fed the trade boxes');
  ok(/TV\.entryLabel\(/.test(html) && /TV\.exitLabel\(/.test(html) && /shape: t\.side === 'LONG' \? 'arrowUp' : 'arrowDown'/.test(html), 'entry = arrow + emoji label, exit = emoji result label');
  ok(/this\.setTradeBoxes\(\[\]\);/.test(html), 'the boxes are cleared with the other confirmation drawings');
  console.log('  manual (browser): each trade shows a white column on its entry candle, a green / red column on its exit candle, a green profit zone and a red loss zone between them with dashed entry / target / stop lines; arrows and emoji labels on the candles.');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
