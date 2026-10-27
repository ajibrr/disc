#!/usr/bin/env node
/**
 * trade-sim.test.js — the shared LTF chain (TL.runChain) and the strategy simulation, see docs/strategy.md.
 *
 *   Pattern A -> LONG, Pattern B -> SHORT. Entry = open of the first candle at/after the E candle's close AND its HTF
 *   zone's close. Stop = entry -/+ stop_multiple x E candle distance, target = entry +/- target_multiple x it.
 *   Exit = first of stop / target reached by the second-by-second ticks, else the last tick of the session.
 *
 * Run: node tests/trade-sim.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const TC = require('../src/confirmation.js');
const TL = require('../src/ltf-conditions.js');
const TT = require('../src/trade-sim.js');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.error('  ✗ FAIL — ' + label); }
}
const near = (a, b) => Math.abs(a - b) < 1e-9;

/* ---------------- fixtures: 10-second candles built from 1-second ticks ---------------- */
const TF = 10;
/** prices[i] is the tick at second i (starting at epoch 0). */
function world(prices) {
  const times = prices.map((_, i) => i);
  const candles = [];
  for (let b = 0; b * TF < prices.length; b++) {
    const seg = prices.slice(b * TF, (b + 1) * TF);
    candles.push({ time: b * TF, open: seg[0], high: Math.max.apply(null, seg), low: Math.min.apply(null, seg), close: seg[seg.length - 1] });
  }
  return { ticks: { times, prices }, candles };
}
/** flat price 100 for `n` seconds */
const flat = (n, v) => new Array(n).fill(v === undefined ? 100 : v);
const CFG = { stopMultiple: 1, targetMultiple: 2, cost: 0 };
/** signal on the candle starting at second `t`, risk = e points */
const sig = (t, pattern, e, extra) => Object.assign({ time: t, pattern, eDistance: e, kind: 'C1+C2+C3+C4+C5', windowCloseTime: 0 }, extra || {});
const sim = (prices, signals, cfg) => { const w = world(prices); return TT.simulateTrades(signals, w.ticks, w.candles, TF, cfg || CFG); };

/* ------------------------------------------------------------------ */
console.log('\nT91 — strategy config: off / active / error');
{
  const good = { enabled: true, stop_multiple: 1, target_multiple: 2, round_trip_cost_points: 0 };
  const a = TT.normalizeStrategy(good);
  ok(a.mode === 'active' && a.cfg.stopMultiple === 1 && a.cfg.targetMultiple === 2 && a.cfg.cost === 0, 'valid -> active with parsed values');
  ok(TT.normalizeStrategy({ enabled: false }).mode === 'off', 'enabled:false -> off');
  ok(TT.normalizeStrategy(undefined).mode === 'error' && /config not generated/.test(TT.normalizeStrategy(undefined).problems[0]), 'missing bundle -> error');
  ok(TT.normalizeStrategy('x').mode === 'error', 'non-object -> error');
  for (const [name, patch, text] of [
    ['enabled not boolean', { enabled: 'yes' }, 'enabled'],
    ['stop_multiple 0', { stop_multiple: 0 }, 'stop_multiple'],
    ['stop_multiple negative', { stop_multiple: -1 }, 'stop_multiple'],
    ['target_multiple NaN', { target_multiple: NaN }, 'target_multiple'],
    ['target_multiple string', { target_multiple: '2' }, 'target_multiple'],
    ['cost negative', { round_trip_cost_points: -0.5 }, 'round_trip_cost_points'],
    ['cost missing', { round_trip_cost_points: undefined }, 'round_trip_cost_points'],
    ['no_entry_from not a clock time', { no_entry_from: '25:99' }, 'no_entry_from'],
    ['no_entry_from a number', { no_entry_from: 1510 }, 'no_entry_from'],
    ['hard_exit_at malformed', { hard_exit_at: '3:19pm' }, 'hard_exit_at'],
    ['hard exit earlier than the entry cutoff', { no_entry_from: '15:10', hard_exit_at: '15:05' }, 'earlier'],
  ]) {
    const r = TT.normalizeStrategy(Object.assign({}, good, patch));
    ok(r.mode === 'error' && r.cfg === null && r.problems.some((p) => p.indexOf(text) >= 0 && p.indexOf('strategy:') === 0), name + ' -> error, prefixed problem');
  }
  const shipped = Object.assign({ enabled: true }, JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'strategies.json'), 'utf8')).strategies.SB_Bhanusali.trade);
  ok(TT.normalizeStrategy(shipped).mode === 'active', 'shipped config/strategies.json (SB_Bhanusali.trade) validates active');
  const clk = TT.normalizeStrategy(Object.assign({}, good, { no_entry_from: '15:10', hard_exit_at: '15:19' }));
  ok(clk.mode === 'active' && clk.cfg.noEntrySec === 15 * 3600 + 10 * 60 && clk.cfg.hardExitSec === 15 * 3600 + 19 * 60, '"15:10" / "15:19" parse to 54600 / 55140 seconds since midnight (IST)');
  const noClk = TT.normalizeStrategy(Object.assign({}, good, { no_entry_from: null, hard_exit_at: null }));
  ok(noClk.mode === 'active' && noClk.cfg.noEntrySec === null && noClk.cfg.hardExitSec === null, 'null turns the clock rules off');
  ok(TT.normalizeStrategy(good).cfg.noEntrySec === null && TT.normalizeStrategy(good).cfg.hardExitSec === null, 'absent keys also mean "rule off" (older configs keep working)');
  ok(TT.normalizeStrategy(Object.assign({}, good, { no_entry_from: '15:10', hard_exit_at: '15:10' })).mode === 'active', 'hard exit at the same minute as the entry cutoff is allowed');
  ok(shipped.no_entry_from === '15:10' && shipped.hard_exit_at === '15:19', 'shipped config/strategies.json: no entry from 15:10, hard exit 15:19');
}

/* ------------------------------------------------------------------ */
console.log('\nT92 — LONG (Pattern A): entry on the next candle open, stop below, target above');
{
  // E candle = seconds 0..9 (price 100). Next candle opens at second 10 at price 101. risk 4 -> stop 97, target 109.
  const prices = flat(10, 100).concat([101, 101, 102, 103, 105, 107, 109, 110, 110, 110], flat(20, 110));
  const r = sim(prices, [sig(0, 'A', 4)]);
  ok(r.trades.length === 1, 'one trade');
  const t = r.trades[0];
  ok(t.side === 'LONG' && t.pattern === 'A', 'Pattern A is LONG');
  ok(t.entryTime === 10 && t.entryPrice === 101, 'entry = open of the candle right after the E candle (second 10, price 101)');
  ok(near(t.stop, 97) && near(t.target, 109), 'stop = entry 101 - 1 x 4 = 97; target = entry 101 + 2 x 4 = 109');
  ok(t.exitReason === 'TARGET' && t.exitPrice === t.target && t.exitTime === 16, 'target hit at second 16 (price 109), fill exactly at the target price');
  ok(near(t.pnl, 8) && near(t.r, 2), 'pnl +8 points = +2 R');
  ok(t.risk === 4, 'risk carried = the E candle distance');
}

/* ------------------------------------------------------------------ */
console.log('\nT93 — SHORT (Pattern B) is the exact mirror');
{
  const prices = flat(10, 100).concat([99, 99, 98, 97, 95, 93, 91, 90, 90, 90], flat(20, 90));
  const r = sim(prices, [sig(0, 'B', 4)]);
  const t = r.trades[0];
  ok(t.side === 'SHORT' && t.pattern === 'B', 'Pattern B is SHORT');
  ok(t.entryPrice === 99 && near(t.stop, 103) && near(t.target, 91), 'entry 99, stop = entry + 4 = 103, target = entry - 2 x 4 = 91');
  ok(t.exitReason === 'TARGET' && t.exitPrice === 91 && t.exitTime === 16 && near(t.pnl, 8), 'target hit, pnl +8');
  const up = flat(10, 100).concat([99, 99, 100, 101, 102, 103, 104, 104, 104, 104], flat(20, 104));
  const s = sim(up, [sig(0, 'B', 4)]).trades[0];
  ok(s.exitReason === 'STOP' && s.exitPrice === 103 && near(s.pnl, -4) && near(s.r, -1), 'a short whose price rises is stopped at entry + risk: -4 points = -1 R');
}

/* ------------------------------------------------------------------ */
console.log('\nT94 — stop loss for a LONG, and the multipliers are honoured');
{
  const down = flat(10, 100).concat([101, 100, 99, 98, 97, 96, 95, 95, 95, 95], flat(20, 95));
  const t = sim(down, [sig(0, 'A', 4)]).trades[0];
  ok(t.exitReason === 'STOP' && t.exitPrice === 97 && t.exitTime === 14 && near(t.pnl, -4) && near(t.r, -1), 'long stopped at 101 - 4 = 97: -4 points = -1 R');
  const wide = sim(down, [sig(0, 'A', 4)], { stopMultiple: 2, targetMultiple: 3, cost: 0 }).trades[0];
  ok(near(wide.stop, 93) && near(wide.target, 113), 'stop_multiple 2 / target_multiple 3 -> stop 93, target 113');
  ok(wide.exitReason === 'EOD', 'with the wider stop neither level is reached -> end of session');
  const withCost = sim(down, [sig(0, 'A', 4)], { stopMultiple: 1, targetMultiple: 2, cost: 0.5 }).trades[0];
  ok(near(withCost.pnl, -4.5) && near(withCost.r, -4.5 / 4), 'a round-trip cost of 0.5 points is subtracted from the pnl');
}

/* ------------------------------------------------------------------ */
console.log('\nT95 — stop and target inside ONE candle are resolved by the tick order');
{
  // entry 101 (second 10); inside candle 20..29 price first hits the TARGET (109) then the STOP (97)
  const tgtFirst = flat(10, 100).concat([101, 101, 101, 101, 101, 101, 101, 101, 101, 101], [101, 105, 109, 100, 97, 90, 90, 90, 90, 90]);
  const a = sim(tgtFirst, [sig(0, 'A', 4)]).trades[0];
  ok(a.exitReason === 'TARGET' && a.exitTime === 22, 'target reached before the stop inside the same candle -> TARGET');
  const stopFirst = flat(10, 100).concat([101, 101, 101, 101, 101, 101, 101, 101, 101, 101], [101, 99, 97, 105, 109, 120, 120, 120, 120, 120]);
  const b = sim(stopFirst, [sig(0, 'A', 4)]).trades[0];
  ok(b.exitReason === 'STOP' && b.exitTime === 22, 'stop reached first inside the same candle -> STOP (not guessed from the candle high / low)');
  // the entry candle itself: its own later ticks are replayed too
  const sameCandle = flat(10, 100).concat([101, 100, 98, 97, 96, 96, 96, 96, 96, 96]);
  const c = sim(sameCandle, [sig(0, 'A', 4)]).trades[0];
  ok(c.exitReason === 'STOP' && c.exitTime === 13, 'ticks inside the entry candle after the opening tick can trigger the stop');
  // a tick that gaps far beyond the stop still fills exactly at the stop price (strategy.md X5)
  const gap = flat(10, 100).concat([101, 101, 50, 50, 50, 50, 50, 50, 50, 50]);
  const g = sim(gap, [sig(0, 'A', 4)]).trades[0];
  ok(g.exitPrice === 97 && near(g.pnl, -4), 'a gap through the stop fills exactly at the stop price');
}

/* ------------------------------------------------------------------ */
console.log('\nT96 — end of session, no next candle, one position at a time');
{
  const quiet = flat(10, 100).concat(flat(25, 101));
  const eod = sim(quiet, [sig(0, 'A', 4)]).trades[0];
  ok(eod.exitReason === 'EOD' && eod.exitTime === 34 && eod.exitPrice === 101 && near(eod.pnl, 0), 'neither level reached -> closed at the last tick of the session');
  const wob = flat(10, 100).concat(flat(24, 101), [103]);
  const eod2 = sim(wob, [sig(0, 'A', 4)]).trades[0];
  ok(eod2.exitReason === 'EOD' && eod2.exitPrice === 103 && near(eod2.pnl, 2), 'end-of-session exit uses the LAST price (103): +2 points');
  const last = sim(flat(20, 100), [sig(10, 'A', 4)]);
  ok(last.trades.length === 0 && last.skipped[0].reason === 'no-next-candle', 'a signal on the last candle has no next candle -> no trade');
  ok(sim(flat(30, 100), [sig(0, 'A', 0)]).skipped[0].reason === 'no-risk', 'a non-positive risk is skipped');
  ok(sim(flat(30, 100), [{ time: 12345, pattern: 'A', eDistance: 3 }]).skipped[0].reason === 'no-candle', 'a signal whose candle does not exist is skipped');

  // two signals: the second would enter while the first trade is still open
  const long1 = flat(10, 100).concat([101, 101, 101, 101, 101, 101, 101, 101, 101, 101], [101, 101, 101, 101, 101, 101, 101, 101, 101, 101],
                                       [101, 105, 109, 109, 109, 109, 109, 109, 109, 109], flat(20, 109));
  const two = sim(long1, [sig(0, 'A', 4), sig(10, 'A', 4)]);
  ok(two.trades.length === 1 && two.skipped.length === 1 && two.skipped[0].reason === 'in-trade', 'a signal that would enter inside an open trade is skipped');
  const after = sim(long1, [sig(0, 'A', 4), sig(40, 'A', 4)]);
  ok(after.trades.length === 2 && after.skipped.length === 0, 'a signal that enters after the first trade has closed is taken');
  ok(after.trades[0].entryTime < after.trades[1].entryTime, 'trades come out in time order');
}

/* ------------------------------------------------------------------ */
console.log('\nT97 — no look-ahead: the entry waits for the HTF zone to close');
{
  // E candle at 0..9, but its zone closes at second 30 -> the earliest entry candle starts at 30
  const prices = flat(10, 100).concat(flat(10, 101), flat(10, 102), [103, 103, 103, 103, 103, 103, 103, 103, 103, 103], flat(20, 103));
  const w = sig(0, 'A', 4, { windowCloseTime: 30 });
  const t = sim(prices, [w]).trades[0];
  ok(t.entryTime === 30 && t.entryPrice === 103, 'entry = open of the first candle at/after the zone close (second 30, price 103), not the next candle (second 10)');
  ok(t.entryDelaySec === 20, 'the delay versus the plain "next candle" rule is recorded (20 s)');
  const plain = sim(prices, [sig(0, 'A', 4, { windowCloseTime: 10 })]).trades[0];
  ok(plain.entryTime === 10 && plain.entryDelaySec === 0, 'a zone that closes right at the E candle close costs no delay');
  const late = sim(flat(30, 100), [sig(0, 'A', 4, { windowCloseTime: 9999 })]);
  ok(late.trades.length === 0 && late.skipped[0].reason === 'no-next-candle', 'a zone that never closes inside the session -> no trade');
  // the result must not depend on ticks before the entry candle
  const alt = prices.slice(); for (let i = 0; i < 29; i++) alt[i] = 1;
  const t2 = sim(alt, [w]).trades[0];
  ok(t2.entryTime === 30 && t2.exitReason === t.exitReason, 'ticks before the entry candle never change the trade (apart from the entry candle open itself)');
}

/* ------------------------------------------------------------------ */
console.log('\nT98 — statistics: hit ratio, profit and loss, profit factor, drawdown, streaks');
{
  const mkT = (side, pnl, reason, risk, entryTime) => ({ side, pnl, exitReason: reason, r: pnl / (risk || 4), entryTime });
  const trades = [mkT('LONG', 8, 'TARGET', 4, 1), mkT('LONG', -4, 'STOP', 4, 2), mkT('SHORT', -4, 'STOP', 4, 3),
                  mkT('SHORT', 8, 'TARGET', 4, 4), mkT('LONG', 0, 'EOD', 4, 5), mkT('SHORT', 2, 'EOD', 4, 6)];
  const s = TT.summarize(trades);
  ok(s.trades === 6 && s.wins === 3 && s.losses === 2 && s.flat === 1, 'counts: 6 trades, 3 wins, 2 losses, 1 flat');
  ok(near(s.winRate, 0.5), 'hit ratio (win rate) = wins / trades = 50 %');
  ok(s.targetHits === 2 && s.stopHits === 2 && s.eodExits === 2, 'exits: 2 target, 2 stop, 2 end of session');
  ok(near(s.totalPnl, 10) && near(s.avgPnl, 10 / 6), 'total pnl +10, average per trade 10 / 6');
  ok(near(s.grossProfit, 18) && near(s.grossLoss, 8) && near(s.profitFactor, 18 / 8), 'gross profit 18, gross loss 8, profit factor 2.25');
  ok(near(s.avgWin, 6) && near(s.avgLoss, -4), 'average win +6, average loss -4');
  ok(s.best === 8 && s.worst === -4, 'best +8, worst -4');
  ok(near(s.maxDrawdown, 8), 'max drawdown: cumulative 8,4,0,8,8,10 -> peak 8 to trough 0 = 8');
  ok(s.maxConsecLosses === 2, 'longest losing streak = 2');
  ok(near(s.avgR, (2 - 1 - 1 + 2 + 0 + 0.5) / 6), 'average R');
  ok(s.long.trades === 3 && near(s.long.totalPnl, 4) && s.short.trades === 3 && near(s.short.totalPnl, 6), 'LONG / SHORT split: long +4 (3 trades), short +6 (3 trades)');
  const e = TT.summarize([]);
  ok(e.trades === 0 && e.winRate === null && e.profitFactor === null && e.totalPnl === 0, 'no trades -> empty statistics, no division by zero');
  const w = TT.summarize([mkT('LONG', 4, 'TARGET', 4, 1)]);
  ok(w.profitFactor === Infinity && w.winRate === 1 && w.avgLoss === null, 'only wins -> profit factor infinite, no average loss');
  const sh = TT.summarize([mkT('LONG', 2, 'TARGET', 4, 5), mkT('LONG', -1, 'STOP', 4, 1), mkT('LONG', -3, 'STOP', 4, 2)]);
  ok(sh.maxConsecLosses === 2 && near(sh.maxDrawdown, 4), 'statistics sort by entry time (losses at 1 and 2 form the streak and the drawdown)');
}

/* ------------------------------------------------------------------ */
console.log('\nT99 — TL.runChain reproduces the chain step by step and honours off / error modes');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const mBc = src.match(/function buildCandles\(ticks, tf\) \{[\s\S]*?\n\}/);
  if (!mBc) { ok(false, 'extract buildCandles'); process.exit(1); }
  const buildCandles = new Function('return (' + mBc[0] + ')')();
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'ltf.json'), 'utf8'));
  const mk = () => ({ c1: TL.normalizeCondition1(raw), c2: TL.normalizeCondition2(raw), c3: TL.normalizeCondition3(raw), c4: TL.normalizeCondition4(raw), c5: TL.normalizeCondition5(raw) });
  const htfRaw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'htf.json'), 'utf8'));
  const filter = TC.normalizeFilter(htfRaw); filter.rsi = TC.normalizeSmaRsiFilter(htfRaw);
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'input', 'NIFTY_2026-10-22_DASHBOARD.json'), 'utf8'));
  const ticks = { times: d.nifty_seconds.map((r) => r.timestamp_epoch), prices: d.nifty_seconds.map((r) => r.nifty) };
  const last = ticks.times[ticks.times.length - 1];
  const lc = buildCandles(ticks, 12);
  const states = TC.evaluate(buildCandles(ticks, 60), { htfSec: 60, sessionEndTick: last, filter });
  const wins = TL.windowsFromStates(states, 60);
  ok(wins.length > 0 && wins.every((x) => x.to - x.from === 60 && (x.pattern === 'A' || x.pattern === 'B')), 'windowsFromStates: one 60 s window per Matched HTF candle');

  const cfgs = mk();
  const chain = TL.runChain(lc, wins, cfgs, TC.rsiArray);
  const closes = lc.map((c) => c.close);
  const c1 = TL.evaluateCondition1(lc, TC.rsiArray(closes, cfgs.c1.cfg.rsiPeriod), wins, cfgs.c1.cfg);
  const c2 = TL.evaluateCondition2(lc, c1, cfgs.c2.cfg);
  const c3 = TL.evaluateCondition3(lc, c2, cfgs.c3.cfg, cfgs.c2.cfg);
  const c4 = TL.evaluateCondition4(lc, c3, TL.smaNullableArray(TC.rsiArray(closes, cfgs.c4.cfg.rsiPeriod), cfgs.c4.cfg.smaPeriod), cfgs.c4.cfg);
  const c5 = TL.evaluateCondition5(lc, c4, cfgs.c5.cfg);
  const J = JSON.stringify;
  ok(J(chain.c1) === J(c1) && J(chain.c2) === J(c2) && J(chain.c3) === J(c3) && J(chain.c4) === J(c4) && J(chain.c5) === J(c5), 'runChain levels equal the manual step-by-step evaluation');
  ok(J(chain.marks) === J(TL.combineMarks(c1, c2, c3, c4, c5)) && chain.marks.length === c1.length, 'chain.marks = combineMarks of those levels, one entry per C1 mark');
  ok(chain.c1.length >= chain.c2.length && chain.c2.length >= chain.c3.length && chain.c3.length >= chain.c4.length && chain.c4.length >= chain.c5.length, 'each level is a subset of the previous one');

  const off2 = mk(); off2.c2 = TL.normalizeCondition2({});
  const o2 = TL.runChain(lc, wins, off2, TC.rsiArray);
  ok(o2.c2.length === 0 && o2.c3.length === 0 && o2.c4.length === 0 && o2.c5.length === 0 && o2.c1.length === c1.length, 'C2 off -> C2..C5 are empty (each level needs its predecessor), C1 unchanged');
  ok(o2.marks.every((m) => m.kind === 'C1'), 'with C2 off every arrow stays plain C1');
  const off5 = mk(); off5.c5 = TL.normalizeCondition5({});
  const o5 = TL.runChain(lc, wins, off5, TC.rsiArray);
  ok(o5.c5.length === 0 && J(o5.c4) === J(c4) && o5.marks.every((m) => m.kind !== 'C1+C2+C3+C4+C5'), 'C5 off -> no full signals, C1..C4 unchanged');
  const bad = mk(); bad.c1 = TL.normalizeCondition1({ condition_1_rsi_cross: { enabled: true } });
  const ob = TL.runChain(lc, wins, bad, TC.rsiArray);
  ok(ob.marks.length === 0 && ob.c1.length === 0, 'an invalid C1 config fails closed: nothing is produced');
  ok(TL.runChain([], wins, cfgs, TC.rsiArray).marks.length === 0 && TL.runChain(lc, [], cfgs, TC.rsiArray).marks.length === 0, 'no candles / no zones -> nothing');
  ok(TL.runChain(lc, wins, null, TC.rsiArray).marks.length === 0, 'missing config -> nothing');
}

/* ------------------------------------------------------------------ */
console.log('\nT100 — real data: every simulated trade is re-checked tick by tick');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const mBc = src.match(/function buildCandles\(ticks, tf\) \{[\s\S]*?\n\}/);
  const buildCandles = new Function('return (' + mBc[0] + ')')();
  const HTF_OF = { 12: 60, 36: 180, 60: 300, 180: 900, 300: 1500 };
  const root = path.join(__dirname, '..');
  const ltfRaw = JSON.parse(fs.readFileSync(path.join(root, 'config', 'ltf.json'), 'utf8'));
  const htfRaw = JSON.parse(fs.readFileSync(path.join(root, 'config', 'htf.json'), 'utf8'));
  const filter = TC.normalizeFilter(htfRaw); filter.rsi = TC.normalizeSmaRsiFilter(htfRaw);
  const cfgs = { c1: TL.normalizeCondition1(ltfRaw), c2: TL.normalizeCondition2(ltfRaw), c3: TL.normalizeCondition3(ltfRaw), c4: TL.normalizeCondition4(ltfRaw), c5: TL.normalizeCondition5(ltfRaw) };
  const strat = TT.normalizeStrategy(Object.assign({ enabled: true }, JSON.parse(fs.readFileSync(path.join(root, 'config', 'strategies.json'), 'utf8')).strategies.SB_Bhanusali.trade));
  let n = 0, sane = true, order = true, noOverlap = true, delayed = 0, anyEntryBeforeZone = false;
  for (const f of fs.readdirSync(path.join(root, 'input')).filter((x) => /_DASHBOARD\.json$/.test(x))) {
    let d; try { d = JSON.parse(fs.readFileSync(path.join(root, 'input', f), 'utf8')); } catch (e) { continue; }
    const key = d.asset.toLowerCase();
    if (!d[key + '_seconds']) continue;
    const ticks = { times: d[key + '_seconds'].map((r) => r.timestamp_epoch), prices: d[key + '_seconds'].map((r) => r[key]) };
    const last = ticks.times[ticks.times.length - 1];
    for (const ltf of Object.keys(HTF_OF).map(Number)) {
      const htf = HTF_OF[ltf];
      const lc = buildCandles(ticks, ltf);
      const states = TC.evaluate(buildCandles(ticks, htf), { htfSec: htf, sessionEndTick: last, filter });
      const chain = TL.runChain(lc, TL.windowsFromStates(states, htf), cfgs, TC.rsiArray);
      const signals = chain.marks.filter((m) => m.kind === 'C1+C2+C3+C4+C5');
      const out = TT.simulateTrades(signals, ticks, lc, ltf, strat.cfg);
      let prevExit = -Infinity;
      for (const t of out.trades) {
        n++;
        const sig = signals.find((s) => s.time === t.signalTime);
        const long = t.side === 'LONG';
        if (!sig || (long !== (sig.pattern === 'A'))) sane = false;
        // entry candle opens at/after BOTH the E candle close and the zone close
        if (t.entryTime < t.signalTime + ltf || t.entryTime < sig.windowCloseTime) anyEntryBeforeZone = true;
        if (t.entryDelaySec > 0) delayed++;
        const ec = lc.find((c) => c.time === t.entryTime);
        if (!ec || ec.open !== t.entryPrice) sane = false;
        const risk = sig.eDistance;
        const stop = long ? t.entryPrice - strat.cfg.stopMultiple * risk : t.entryPrice + strat.cfg.stopMultiple * risk;
        const target = long ? t.entryPrice + strat.cfg.targetMultiple * risk : t.entryPrice - strat.cfg.targetMultiple * risk;
        if (!near(stop, t.stop) || !near(target, t.target)) sane = false;
        // independent tick scan between the entry candle open and the recorded exit
        const i0 = ticks.times.findIndex((x) => x >= t.entryTime);
        const startK = (i0 >= 0 && ticks.times[i0] < t.entryTime + ltf) ? i0 + 1 : i0;
        let firstHit = null, firstK = null;
        for (let k = startK; k < ticks.times.length; k++) {
          const p = ticks.prices[k];
          if (long ? p <= stop : p >= stop) { firstHit = 'STOP'; firstK = k; break; }
          if (long ? p >= target : p <= target) { firstHit = 'TARGET'; firstK = k; break; }
        }
        const dayStart = t.entryTime - (((t.entryTime + 19800) % 86400 + 86400) % 86400);
        const hardAt = strat.cfg.hardExitSec != null ? dayStart + strat.cfg.hardExitSec : Infinity;
        const cutAt = strat.cfg.noEntrySec != null ? dayStart + strat.cfg.noEntrySec : Infinity;
        if (t.entryTime >= cutAt || t.entryTime >= hardAt) sane = false;            // no entry from the cutoff
        if (t.exitTime > hardAt) sane = false;                                      // nothing runs past the hard exit
        if (firstHit !== null && ticks.times[firstK] >= hardAt) firstHit = null;    // a level first reached after the hard exit does not count
        if (firstHit === null) {
          const hk = ticks.times.findIndex((x) => x >= hardAt);
          if (hk >= 0 && hk >= startK) {
            if (t.exitReason !== 'HARD' || t.exitTime !== ticks.times[hk] || t.exitPrice !== ticks.prices[hk]) sane = false;
          } else if (t.exitReason !== 'EOD' || t.exitTime !== ticks.times[ticks.times.length - 1]) sane = false;
        } else if (t.exitReason !== firstHit || t.exitTime !== ticks.times[firstK] || t.exitPrice !== (firstHit === 'STOP' ? stop : target)) sane = false;
        const gross = long ? t.exitPrice - t.entryPrice : t.entryPrice - t.exitPrice;
        if (!near(t.pnl, gross - strat.cfg.cost)) sane = false;
        if (t.entryTime < prevExit) noOverlap = false;
        if (t.exitTime < t.entryTime) order = false;
        prevExit = t.exitTime;
      }
    }
  }
  ok(n > 0, 'trades were produced from the recorded sessions (' + n + ')');
  ok(sane, 'every trade: right side, entry = the entry candle open, stop / target levels, and the exit equals an independent tick scan');
  ok(!anyEntryBeforeZone, 'no trade enters before its E candle has closed or before its HTF zone has closed (no look-ahead)');
  ok(noOverlap && order, 'one position at a time and every exit is after its entry');
  console.log('  info: ' + n + ' trades, ' + delayed + ' entered later than the next candle because of an unclosed HTF zone');
}

/* ------------------------------------------------------------------ */
console.log('\nT102 \u2014 session rules: no entry from the cutoff, hard exit at the exit time (IST)');
{
  // epoch 0 = 05:30 IST (19800 s). Cutoff at epoch 100 (19900 s), hard exit at epoch 200 (20000 s).
  const RC = { stopMultiple: 1, targetMultiple: 2, cost: 0, noEntrySec: 19900, hardExitSec: 20000 };
  const simR = (prices, signals, cfg) => { const w = world(prices); return TT.simulateTrades(signals, w.ticks, w.candles, TF, cfg || RC); };
  // quiet market: price 100 then 101 from every candle open on -> never reaches stop 97 / target 109
  const quiet = flat(300, 100).map((_, i) => (i < 10 ? 100 : 101));

  const early = simR(quiet, [sig(80, 'A', 4)]);                 // entry candle starts at 90 (< 100)
  ok(early.trades.length === 1 && early.trades[0].entryTime === 90, 'an entry before the cutoff (second 90) is taken');
  const at = simR(quiet, [sig(90, 'A', 4)]);                    // entry candle starts at 100 = the cutoff
  ok(at.trades.length === 0 && at.skipped[0].reason === 'after-cutoff', 'an entry exactly at the cutoff is NOT taken (no entry from 15:10)');
  const late = simR(quiet, [sig(150, 'B', 4)]);
  ok(late.trades.length === 0 && late.skipped[0].reason === 'after-cutoff', 'an entry well after the cutoff is not taken (Pattern B as well)');
  ok(simR(quiet, [sig(150, 'A', 4)], { stopMultiple: 1, targetMultiple: 2, cost: 0 }).trades.length === 1, 'with the clock rules off the same late signal is taken');

  // hard exit: open trade closed at the first tick at/after epoch 200, whatever the price is
  const drift = quiet.slice(); for (let i = 200; i < 300; i++) drift[i] = 103;
  const h = simR(drift, [sig(30, 'A', 4)]).trades[0];            // entry 40 at 101
  ok(h.exitReason === 'HARD' && h.exitTime === 200 && h.exitPrice === 103 && near(h.pnl, 2), 'a trade still open at the hard-exit time closes at that tick\'s price (HARD, +2 points)');
  const hs = simR(drift.map((p, i) => (i >= 200 ? 99 : p)), [sig(30, 'A', 4)]).trades[0];
  ok(hs.exitReason === 'HARD' && hs.exitPrice === 99 && near(hs.pnl, -2), 'the hard exit can be at a loss (-2 points) without touching the stop');
  const sh = simR(drift.map((p, i) => (i >= 200 ? 99 : p)), [sig(30, 'B', 4)]).trades[0];
  ok(sh.side === 'SHORT' && sh.exitReason === 'HARD' && near(sh.pnl, 2), 'a SHORT is closed at the hard exit too (101 - 99 = +2 points)');

  // a target that would only be reached AFTER the hard exit is never taken
  const lateTarget = quiet.slice(); for (let i = 250; i < 300; i++) lateTarget[i] = 120;
  const lt = simR(lateTarget, [sig(30, 'A', 4)]).trades[0];
  ok(lt.exitReason === 'HARD' && lt.exitTime === 200, 'a target that would be reached after 15:19 is not taken - the position is closed at the hard exit');
  // a stop before the hard exit still wins
  const earlyStop = quiet.slice(); for (let i = 150; i < 300; i++) earlyStop[i] = 90;
  const es = simR(earlyStop, [sig(30, 'A', 4)]).trades[0];
  ok(es.exitReason === 'STOP' && es.exitTime === 150 && es.exitPrice === 97, 'a stop reached before the hard exit is still a STOP');
  // a target before the hard exit still wins
  const earlyTgt = quiet.slice(); for (let i = 120; i < 300; i++) earlyTgt[i] = 115;
  const et = simR(earlyTgt, [sig(30, 'A', 4)]).trades[0];
  ok(et.exitReason === 'TARGET' && et.exitTime === 120, 'a target reached before the hard exit is still a TARGET');

  // no hard exit configured -> end of session instead
  const noHard = simR(drift, [sig(30, 'A', 4)], { stopMultiple: 1, targetMultiple: 2, cost: 0, noEntrySec: 19900, hardExitSec: null }).trades[0];
  ok(noHard.exitReason === 'EOD' && noHard.exitTime === 299, 'without a hard exit time the trade runs to the end of the session');
  // hard exit set but no cutoff: an entry after the hard exit is not taken
  const lateNoCut = simR(quiet, [sig(210, 'A', 4)], { stopMultiple: 1, targetMultiple: 2, cost: 0, noEntrySec: null, hardExitSec: 20000 });
  ok(lateNoCut.trades.length === 0 && lateNoCut.skipped[0].reason === 'after-cutoff', 'an entry after the hard-exit time is never taken, even with no entry cutoff');
  // the position slot frees up at the hard exit, but no new entry may follow it
  const two = simR(drift, [sig(30, 'A', 4), sig(210, 'A', 4)]);
  ok(two.trades.length === 1 && two.skipped.length === 1, 'after the hard exit no further trade is taken');
  // statistics count hard exits separately
  const stt = TT.summarize([h, hs, es, et]);
  ok(stt.hardExits === 2 && stt.stopHits === 1 && stt.targetHits === 1 && stt.eodExits === 0, 'statistics count HARD exits separately from stops, targets and end-of-session');
  // real clock: 15:10 / 15:19 IST on 22-10-2026 are epoch seconds the rule maps correctly
  const day0 = Date.UTC(2026, 9, 22, 0, 0, 0) / 1000 - 19800;    // midnight IST of 2026-10-22
  const real = { stopMultiple: 1, targetMultiple: 2, cost: 0, noEntrySec: 54600, hardExitSec: 55140 };
  const base = day0 + 15 * 3600 + 9 * 60;                         // 15:09:00 IST
  const times = [], prices = [];
  for (let k = 0; k < 15 * 60; k++) { times.push(base + k); prices.push(100); }   // 15:09:00 .. 15:23:59
  const cs = []; for (let b = 0; b < 90; b++) cs.push({ time: base + b * 10, open: 100 });
  const okEntry = TT.simulateTrades([{ time: base - 10, pattern: 'A', eDistance: 4 }], { times, prices }, [{ time: base - 10, open: 100 }].concat(cs), 10, real);
  ok(okEntry.trades.length === 1 && okEntry.trades[0].entryTime === base, 'a real 15:09:00 IST entry is allowed');
  ok(okEntry.trades[0].exitReason === 'HARD' && okEntry.trades[0].exitTime === day0 + 15 * 3600 + 19 * 60, 'and it is closed at 15:19:00 IST');
  const noEntry = TT.simulateTrades([{ time: base + 50, pattern: 'A', eDistance: 4 }], { times, prices }, cs, 10, real);
  ok(noEntry.trades.length === 0 && noEntry.skipped[0].reason === 'after-cutoff', 'a real 15:10:00 IST entry is refused');
}

/* ------------------------------------------------------------------ */
console.log('\nT135 — the target is always entry +/- target_multiple x risk (the previous_extreme target mode is gone)');
{
  const cs = [0, 10, 20, 30].map((t) => ({ time: t, open: 100, high: 101, low: 99, close: 100 }));
  const mkCfg = (patch) => TT.normalizeStrategy(Object.assign({ enabled: true, stop_multiple: 1, target_multiple: 2, round_trip_cost_points: 0 }, patch));
  const cfgOf = (patch) => mkCfg(patch).cfg;
  ok(mkCfg({}).mode === 'active' && mkCfg({}).cfg.targetMode === undefined, 'target_multiple alone is a complete target rule');
  ok(mkCfg({ target_mode: 'multiple' }).mode === 'active', 'a leftover target_mode "multiple" is still accepted');
  ok(mkCfg({ target_mode: 'previous_extreme' }).mode === 'error' && mkCfg({ target_mode: 'previous_extreme' }).problems.some((p) => p.indexOf('target_mode') >= 0), 'target_mode "previous_extreme" is rejected');
  ok(mkCfg({ target_multiple: undefined }).mode === 'error', 'target_multiple is required');
  ok(mkCfg({ target_multiple: -1 }).mode === 'error', 'a target_multiple that is present must be valid');

  // long: entry 100, risk 5 -> stop 95, target 110 whatever backHigh says
  const up = { times: [0, 5, 10, 15, 20, 25, 30], prices: [100, 100, 100, 104, 111, 117, 120] };
  let r = TT.simulateTrades([{ time: 0, pattern: 'A', eDistance: 5, backHigh: 117 }], up, cs, 10, cfgOf({}));
  ok(r.trades.length === 1 && r.trades[0].target === 110 && r.trades[0].stop === 95 && r.trades[0].exitReason === 'TARGET' && r.trades[0].pnl === 10, 'long: target = entry + 2 x risk (110), back high ignored');
  r = TT.simulateTrades([{ time: 0, pattern: 'A', eDistance: 5 }], up, cs, 10, cfgOf({}));
  ok(r.trades.length === 1 && r.trades[0].target === 110, 'a signal without a back high still trades');
  // short: entry 100, stop 105, target 90
  const dn = { times: [0, 5, 10, 15, 20, 25, 30], prices: [100, 100, 100, 96, 90, 88, 85] };
  r = TT.simulateTrades([{ time: 0, pattern: 'B', eDistance: 5, backLow: 88 }], dn, cs, 10, cfgOf({}));
  ok(r.trades.length === 1 && r.trades[0].target === 90 && r.trades[0].stop === 105 && r.trades[0].exitReason === 'TARGET' && r.trades[0].pnl === 10, 'short: target = entry - 2 x risk (90)');
  const dn2 = { times: [0, 5, 10, 15, 20, 25, 30], prices: [100, 100, 100, 106, 90, 88, 85] };
  r = TT.simulateTrades([{ time: 0, pattern: 'B', eDistance: 5 }], dn2, cs, 10, cfgOf({}));
  ok(r.trades[0].exitReason === 'STOP' && r.trades[0].pnl === -5, 'a rise to 106 stops the short out for -1 R');
  const shippedTrade = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'strategies.json'), 'utf8')).strategies.SB_Bhanusali.trade;
  ok(shippedTrade.target_mode === undefined && TT.normalizeStrategy(Object.assign({ enabled: true }, shippedTrade)).mode === 'active', 'shipped SB_Bhanusali: no target_mode, target from target_multiple');
}

/* ------------------------------------------------------------------ */
console.log('\nT101 — browser wiring (static source assertions; live checks in the preview)');
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  ok(/<script src="generated\/strategies-config\.js"><\/script>/.test(html) && /<script src="\.\.\/src\/trade-sim\.js"><\/script>/.test(html) && /<script src="\.\.\/src\/strategies\.js"><\/script>/.test(html), 'page loads strategies-config.js, trade-sim.js and strategies.js');
  ok(/TS\.normalizeRegistry\(window\.STRATEGIES_CONFIG\)/.test(html), 'strategy registry normalized from window.STRATEGIES_CONFIG');
  ok(/TT\.simulateTrades\(/.test(html) && /TT\.summarize\(/.test(html), 'applyConfirmation simulates the trades and summarizes them');
  ok(/id="strategy-badge"/.test(html), 'strategy badge present in the toolbar');
  ok(/TL\.runChain\(/.test(html), 'the page uses the shared chain (TL.runChain)');
  ok(/console\.table\(sim\.trades/.test(html) && /SEL\.name \+ '\] '/.test(html), 'the page writes the trades and statistics to the browser console');
  ok(!/TL\.evaluateCondition[1-5]\(/.test(html), 'the page no longer carries its own copy of the C1..C5 chain');
  console.log('  manual (done in the preview): LONG / SHORT entry squares and TP / SL circles on the LTF chart; the strategy badge and its tooltip;');
  console.log('  badge turns green / red with the session P&L; LTF Conditions toggle clears everything.');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
