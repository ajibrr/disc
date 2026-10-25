#!/usr/bin/env node
'use strict';
/**
 * run-backtest.js — run the strategy (strategy.md) over every recorded session in input/ and print the
 * trades and the statistics: hit ratio, profit and loss, profit factor, drawdown ...
 *
 *     node scripts/run-backtest.js                  # every session, every LTF
 *     node scripts/run-backtest.js --ltf 12,36      # only these LTF candle lengths (seconds)
 *     node scripts/run-backtest.js --strategy SB_Bhanusali   # one strategy (default: every strategy switched on in config/strategies.json)
 *     node scripts/run-backtest.js --strategy all   # every strategy that can run, switched on or not
 *     node scripts/run-backtest.js --trades         # also list every trade
 *     node scripts/run-backtest.js --json           # machine-readable output
 *     node scripts/run-backtest.js --trades --out backtest.log   # also write the report to a log file
 *     node scripts/run-backtest.js --set ltf.condition_5_distance_ratio.distance_multiplier=2 --set strategy.target_multiple=3
 *                                                  # what-if: override a config value for this run only (files untouched)
 *                                                  # prefixes: htf. ltf. strategy.  (strategy. = the `trade` rules of every selected strategy)
 *
 * It uses exactly the code the page uses: the real buildCandles() extracted from index.html, the HTF rules with
 * config/htf.json, the LTF chain with config/ltf.json (TL.runChain) and each strategy's trade rules with config/strategies.json.
 * Results are in POINTS for a size of 1 unit. The sample is small, so read it as an illustration, not as evidence.
 */
const fs = require('fs');
const path = require('path');
const TC = require('../src/confirmation.js');
const TL = require('../src/ltf-conditions.js');
const TT = require('../src/trade-sim.js');
const TS = require('../src/strategies.js');
const TFlow = require('../src/oi-flow.js');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const opt = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };

const HTF_OF = { 12: 60, 36: 180 };               // the two timeframes the strategy runs on (5 : 1 locked)
// --out <file>: every line printed is also written to this file (a plain-text log of the run)
const outFile = opt('out');
const logLines = [];
if (outFile) {
  const orig = console.log.bind(console);
  console.log = (...a) => { logLines.push(a.join(' ')); orig(...a); };
  process.on('exit', () => { try { fs.writeFileSync(path.resolve(outFile), logLines.join('\n') + '\n'); } catch (e) { console.error('cannot write ' + outFile + ': ' + e.message); } });
}
const ltfList = (opt('ltf') ? opt('ltf').split(',').map(Number) : Object.keys(HTF_OF).map(Number));
for (const l of ltfList) if (!HTF_OF[l]) { console.error('unknown LTF ' + l + ' (use 12,36)'); process.exit(1); }

// the page's own candle builder, taken from index.html so there is one copy of it
const html = fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8');
const m = html.match(/function buildCandles\(ticks, tf\) \{[\s\S]*?\n\}/);
if (!m) { console.error('cannot find buildCandles() in index.html'); process.exit(1); }
const buildCandles = new Function('return (' + m[0] + ')')();

const readJson = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const htfCfg = readJson('config/htf.json');
const ltfCfgRaw = readJson('config/ltf.json');
const regRaw = readJson('config/strategies.json');

// --set <htf|ltf|strategy>.<path>=<value> : one-run overrides, the config files are never written
const overrides = [];
args.forEach((a, i) => {
  if (a !== '--set') return;
  const m2 = /^(htf|ltf|strategy)\.(.+?)=(.*)$/.exec(args[i + 1] || '');
  if (!m2) { console.error('bad --set (use e.g. ltf.condition_5_distance_ratio.distance_multiplier=2): ' + args[i + 1]); process.exit(1); }
  // strategy.<key> changes the `trade` rules of EVERY strategy in config/strategies.json for this run
  const targets = m2[1] === 'strategy' ? Object.values(regRaw.strategies || {}).map((e) => e.trade).filter(Boolean)
                                       : [{ htf: htfCfg, ltf: ltfCfgRaw }[m2[1]]];
  if (!targets.length) { console.error('no strategy has a trade section to override'); process.exit(1); }
  const keys = m2[2].split('.');
  let v = m2[3];
  try { v = JSON.parse(v); } catch (e) { /* keep as string */ }
  for (const target of targets) {
    let o = target;
    for (let k = 0; k < keys.length - 1; k++) {
      if (o[keys[k]] === undefined || typeof o[keys[k]] !== 'object') { console.error('unknown config path: ' + m2[1] + '.' + m2[2]); process.exit(1); }
      o = o[keys[k]];
    }
    if (!(keys[keys.length - 1] in o)) { console.error('unknown config key: ' + m2[1] + '.' + m2[2]); process.exit(1); }
    o[keys[keys.length - 1]] = v;
  }
  overrides.push(m2[1] + '.' + m2[2] + ' = ' + JSON.stringify(v));
});
const filter = TC.normalizeFilter(htfCfg); filter.rsi = TC.normalizeSmaRsiFilter(htfCfg); filter.oi = TC.normalizeOiFilter(htfCfg);
const cfgs = { c1: TL.normalizeCondition1(ltfCfgRaw), c2: TL.normalizeCondition2(ltfCfgRaw), c3: TL.normalizeCondition3(ltfCfgRaw),
               c4: TL.normalizeCondition4(ltfCfgRaw), c5: TL.normalizeCondition5(ltfCfgRaw), c6: TL.normalizeCondition6(ltfCfgRaw) };
const REG = TS.normalizeRegistry(regRaw);
for (const [k, v] of Object.entries(Object.assign({ filter, rsi: filter.rsi, oi: filter.oi }, cfgs))) {
  if (v.mode === 'error') { console.error('config error (' + k + '): ' + v.problems.join('; ')); process.exit(1); }
}
if (REG.mode === 'error') { console.error('config error (strategies): ' + REG.problems.join('; ')); process.exit(1); }

// which strategies to run: --strategy NAME[,NAME] | all (every runnable one) | default = those switched on in config/strategies.json
const want = opt('strategy');
let selected;
if (!want) selected = REG.enabled.slice();
else if (want === 'all') selected = REG.strategies.filter((x) => x.runnable).map((x) => x.name);
else selected = want.split(',');
for (const n of selected) {
  const e = REG.byName[n];
  if (!e) { console.error('unknown strategy ' + n + ' (known: ' + REG.strategies.map((x) => x.name).join(', ') + ')'); process.exit(1); }
  if (!e.runnable) { console.error(n + ' cannot run: ' + (e.implemented ? 'it has no valid trade rules' : 'its signal rules are not defined yet') + ' (see config/strategies.json)'); process.exit(1); }
}
if (!selected.length) { console.error('no strategy is switched on in config/strategies.json (or pass --strategy NAME)'); process.exit(1); }

const ist = (t) => new Date((t + 19800) * 1000).toISOString().slice(11, 19);
const day = (t) => new Date((t + 19800) * 1000).toISOString().slice(0, 10);

const files = fs.readdirSync(path.join(root, 'input')).filter((f) => /_DASHBOARD\.json$/.test(f)).sort();
const sessions = [];
for (const f of files) {
  let d;
  try { d = readJson('input/' + f); } catch (e) { console.error('skipping ' + f + ': ' + e.message.slice(0, 80)); continue; }
  const asset = d.asset, key = asset.toLowerCase();
  const series = d[key + '_seconds'];
  if (!series || !series.length) { console.error('skipping ' + f + ': no second data'); continue; }
  const ticks = { times: series.map((r) => r.timestamp_epoch), prices: series.map((r) => r[key]) };
  const date = day(ticks.times[0]);
  const dup = sessions.findIndex((x) => x.asset === asset && x.date === date);
  if (dup >= 0) {                                    // same session in two files: the later file wins, like build-data.js
    console.error('note: ' + asset + ' ' + date + ' is in more than one input file — ' + f + ' replaces the earlier one');
    sessions.splice(dup, 1);
  }
  sessions.push({ asset, date, ticks, flow: TFlow.extractFlow(d.flow, date) });
}

function runStrategy(entry, multi) {
const strat = entry.trade;
const rows = [], allTrades = [], skippedBy = {};
for (const s of sessions) {
  const last = s.ticks.times[s.ticks.times.length - 1];
  for (const ltf of ltfList) {
    const htf = HTF_OF[ltf];
    const lc = buildCandles(s.ticks, ltf);
    const htfCandles = buildCandles(s.ticks, htf);
    let sessionFilter = filter;                      // the OI-change gate needs this session's CE / PE change per HTF candle
    if (filter.oi.mode === 'active') {
      const per = TFlow.changePerCandle(s.flow, htfCandles, htf).map((a) => (a ? { dce: a.dce, dpe: a.dpe } : null));
      sessionFilter = Object.assign({}, filter, { oi: Object.assign({}, filter.oi, { perCandle: per }) });
    }
    const states = TC.evaluate(htfCandles, { htfSec: htf, sessionEndTick: last, filter: sessionFilter });
    const chain = TL.runChain(lc, TL.windowsFromStates(states, htf), cfgs, TC.rsiArray);
    const signals = TS.signalsFor(entry, { chain, candles: lc, rsiArray: TC.rsiArray });
    const sim = TT.simulateTrades(signals, s.ticks, lc, ltf, strat.cfg);
    const sum = TT.summarize(sim.trades);
    rows.push({ asset: s.asset, date: s.date, ltf, c1: chain.c1.length, signals: signals.length, trades: sim.trades.length,
                skipped: sim.skipped.length, wins: sum.wins, losses: sum.losses, pnl: sum.totalPnl });
    for (const k of sim.skipped) skippedBy[k.reason] = (skippedBy[k.reason] || 0) + 1;
    for (const t of sim.trades) allTrades.push(Object.assign({ asset: s.asset, date: s.date, ltf }, t));
  }
}

const overall = TT.summarize(allTrades);
const byLtf = {};
for (const l of ltfList) byLtf[l] = TT.summarize(allTrades.filter((t) => t.ltf === l));

if (flag('json')) {
  return { strategy: entry.name, config: { trade: entry.trade.cfg, overrides }, sessions: rows, trades: allTrades, overall, byLtf };
}

const f2 = (v) => (v === null || v === undefined ? '—' : (v === Infinity ? '∞' : (Math.round(v * 100) / 100).toFixed(2)));
const sg = (v) => (v === null || v === undefined ? '—' : (v > 0 ? '+' : '') + f2(v));
const pct = (v) => (v === null ? '—' : (v * 100).toFixed(1) + ' %');
const pad = (v, n) => String(v).padEnd(n), lpad = (v, n) => String(v).padStart(n);

console.log('\n' + (multi ? '══════════ ' : '') + 'Strategy ' + entry.name + ' — back-test — stop ' + strat.cfg.stopMultiple + ' × the E candle distance / target ' + (strat.cfg.targetMode === 'previous_extreme' ? 'the previous high (long) / low (short) of the back window' : strat.cfg.targetMultiple + ' × the E candle distance') + ', entry on the next candle open'
  + (strat.cfg.cost ? ', cost ' + strat.cfg.cost + ' pts per trade' : '')
  + (strat.cfg.noEntryLabel ? ', no entry from ' + strat.cfg.noEntryLabel + ' IST' : '') + (strat.cfg.hardExitLabel ? ', hard exit ' + strat.cfg.hardExitLabel + ' IST' : ''));
if (overrides.length) console.log('Overrides for this run only: ' + overrides.join(', '));
console.log('Sessions: ' + sessions.map((s) => s.asset + ' ' + s.date).join(', ') + '   LTFs: ' + ltfList.map((l) => l + 's').join(', '));

console.log('\nPer session (only sessions that produced signals):');
console.log(pad('instrument', 11) + pad('date', 12) + pad('LTF', 6) + lpad('C1', 5) + lpad('signals', 9) + lpad('trades', 8) + lpad('skipped', 9) + lpad('W', 4) + lpad('L', 4) + lpad('P&L pts', 11));
rows.filter((r) => r.signals > 0).forEach((r) => console.log(pad(r.asset, 11) + pad(r.date, 12) + pad(r.ltf + 's', 6) + lpad(r.c1, 5) + lpad(r.signals, 9) +
  lpad(r.trades, 8) + lpad(r.skipped, 9) + lpad(r.wins, 4) + lpad(r.losses, 4) + lpad(sg(r.pnl), 11)));
const noSig = rows.filter((r) => r.signals === 0).length;
console.log('(' + noSig + ' of ' + rows.length + ' session/LTF combinations produced no full signal)');

if (flag('trades')) {
  console.log('\nTrades:');
  console.log(pad('instrument', 11) + pad('date', 12) + pad('LTF', 5) + pad('side', 7) + pad('signal', 10) + pad('entry', 10) + lpad('entry px', 11) +
    lpad('risk', 8) + lpad('stop', 11) + lpad('target', 11) + pad('  exit', 10) + lpad('exit px', 11) + pad('  why', 8) + lpad('P&L', 9) + lpad('R', 7));
  allTrades.forEach((t) => console.log(pad(t.asset, 11) + pad(t.date, 12) + pad(t.ltf + 's', 5) + pad(t.side, 7) + pad(ist(t.signalTime), 10) + pad(ist(t.entryTime), 10) +
    lpad(f2(t.entryPrice), 11) + lpad(f2(t.risk), 8) + lpad(f2(t.stop), 11) + lpad(f2(t.target), 11) + pad('  ' + ist(t.exitTime), 10) + lpad(f2(t.exitPrice), 11) +
    pad('  ' + t.exitReason, 8) + lpad(sg(t.pnl), 9) + lpad(sg(t.r), 7)));
}

const block = (title, s) => {
  console.log('\n' + title);
  if (!s.trades) { console.log('  no trades'); return; }
  console.log('  trades ' + s.trades + '   wins ' + s.wins + '   losses ' + s.losses + (s.flat ? '   flat ' + s.flat : '') + '   hit ratio (win rate) ' + pct(s.winRate));
  console.log('  exits: target ' + s.targetHits + ', stop ' + s.stopHits + ', hard exit ' + s.hardExits + ', end of session ' + s.eodExits);
  console.log('  total P&L ' + sg(s.totalPnl) + ' pts   average per trade ' + sg(s.avgPnl) + ' pts   average R ' + sg(s.avgR));
  console.log('  average win ' + sg(s.avgWin) + '   average loss ' + sg(s.avgLoss) + '   best ' + sg(s.best) + '   worst ' + sg(s.worst));
  console.log('  gross profit ' + f2(s.grossProfit) + '   gross loss ' + f2(-s.grossLoss) + '   profit factor ' + f2(s.profitFactor));
  console.log('  max drawdown ' + f2(s.maxDrawdown) + ' pts   longest losing streak ' + s.maxConsecLosses);
  if (s.delayed) console.log('  ' + s.delayed + ' trade(s) entered later than the next candle because the signal sat inside an HTF zone that had not closed yet');
};
overall.delayed = allTrades.filter((t) => t.entryDelaySec > 0).length;
block('OVERALL', overall);
const skipTxt = Object.keys(skippedBy).sort().map((k) => skippedBy[k] + ' ' + k).join(', ');
if (skipTxt) console.log('  signals not traded: ' + skipTxt);
block('LONG  (Pattern A)', overall.long);
block('SHORT (Pattern B)', overall.short);
for (const l of ltfList) if (byLtf[l].trades) block('LTF ' + l + 's', byLtf[l]);
console.log('\nNote: results are points for 1 unit, no costs unless set, and come from a handful of recorded sessions —');
console.log('an illustration of the rules, not evidence that they are profitable.\n');
}

const results = selected.map((n) => runStrategy(REG.byName[n], selected.length > 1));
if (flag('json')) {
  // wait for stdout to drain before exiting — process.exit() straight after a large write truncates piped output at 64 KB
  const out = results.length === 1 ? results[0] : { strategies: results };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n', () => process.exit(0));
}
