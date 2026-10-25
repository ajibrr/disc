#!/usr/bin/env node
/**
 * strategies.test.js — the strategy registry (config/strategies.json -> src/strategies.js) and its wiring.
 *
 *   SB_Bhanusali (HTF zone + C1..C5) is switched on and runnable.
 *   The registry only chooses WHICH signals and trade rules to use — SB_Bhanusali's signals must equal the full
 *   C1+C2+C3+C4+C5 marks of the shared chain, so the back-test and the page cannot drift.
 *
 * Run: node tests/strategies.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const TS = require('../src/strategies.js');
const TT = require('../src/trade-sim.js');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.error('  ✗ FAIL — ' + label); }
}
const root = path.join(__dirname, '..');
const shipped = JSON.parse(fs.readFileSync(path.join(root, 'config', 'strategies.json'), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));

console.log('\nT121 — shipped config/strategies.json');
{
  const r = TS.normalizeRegistry(shipped);
  ok(r.mode === 'active' && r.problems.length === 0, 'validates with no problems');
  ok(r.enabled.length === 1 && r.enabled[0] === 'SB_Bhanusali', 'SB_Bhanusali is the only strategy switched on');
  const sb = r.byName.SB_Bhanusali;
  ok(sb.enabled && sb.implemented && sb.runnable && sb.trade.mode === 'active', 'SB_Bhanusali: on, implemented, runnable, trade rules valid');
  ok(sb.trade.cfg.stopMultiple === 1 && sb.trade.cfg.targetMode === 'previous_extreme' && sb.trade.cfg.noEntryLabel === '15:10' && sb.trade.cfg.hardExitLabel === '15:19',
     'SB_Bhanusali trade rules: stop 1x the E distance, target = previous extreme, no entry from 15:10, hard exit 15:19');
}

console.log('\nT122 — validation');
{
  const bad = (mutate, text) => {
    const raw = clone(shipped); mutate(raw);
    const r = TS.normalizeRegistry(raw);
    return r.mode === 'error' && r.problems.some((p) => p.indexOf(text) >= 0);
  };
  ok(TS.normalizeRegistry(null).mode === 'error', 'missing config -> error (fails closed)');
  ok(TS.normalizeRegistry({}).mode === 'error', 'no strategies object -> error');
  ok(bad((r) => { r.strategies.SB_Bhanusali.signals = 'nothing_yet'; }, 'no signal rules yet'), 'switching a strategy on without a signal generator is refused');
  ok(bad((r) => { r.strategies.SB_Bhanusali.enabled = 'yes'; }, 'enabled must be true or false'), 'enabled must be a boolean');
  ok(bad((r) => { r.strategies.SB_Bhanusali.trade.stop_multiple = 0; }, 'stop_multiple'), 'a bad trade rule is reported with the strategy name');
  ok(bad((r) => { delete r.strategies.SB_Bhanusali.trade; }, 'no "trade" section'), 'an enabled strategy needs a trade section');
  const off = clone(shipped); off.strategies.SB_Bhanusali.enabled = false;
  const r = TS.normalizeRegistry(off);
  ok(r.mode === 'active' && r.enabled.length === 0 && r.byName.SB_Bhanusali.runnable, 'switching SB_Bhanusali off leaves it listed and runnable, but not enabled');
}

console.log('\nT123 — SB_Bhanusali signals = the full marks of the shared chain');
{
  const entry = TS.normalizeRegistry(shipped).byName.SB_Bhanusali;
  const marks = [
    { time: 1, kind: 'C1', pattern: 'A' }, { time: 2, kind: 'C1+C2+C3+C4', pattern: 'B' },
    { time: 3, kind: 'C1+C2+C3+C4+C5', pattern: 'A', eDistance: 4 }, { time: 4, kind: 'C1+C2+C3+C4+C5', pattern: 'B', eDistance: 2 },
  ];
  const sigs = TS.signalsFor(entry, { chain: { marks } });
  ok(sigs.length === 2 && sigs[0].time === 3 && sigs[1].time === 4, 'only the C1+C2+C3+C4+C5 marks become signals, in order');
  ok(TS.signalsFor(entry, {}).length === 0 && TS.signalsFor(entry, null).length === 0 && TS.signalsFor(null, {}).length === 0, 'missing inputs give no signals and never throw');
}

console.log('\nT124 — back-test runner and page wiring');
{
  const html = fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8');
  const bt = fs.readFileSync(path.join(root, 'scripts', 'run-backtest.js'), 'utf8');
  ok(/id="strategy-select"/.test(html) && /strategyEl\.addEventListener\('change'/.test(html), 'page has a strategy selector with a change handler');
  ok(/TS\.signalsFor\(SEL, \{ chain, candles: ltfPanel\.candles, rsiArray: TC\.rsiArray \}\)/.test(html), 'the page takes the selected strategy\'s signals from the registry');
  ok(/o\.disabled = !\(st\.enabled && st\.runnable\)/.test(html), 'strategies that are off or have no rules cannot be selected');
  ok(/config\/strategies\.json/.test(bt) && /--strategy/.test(bt) && /TS\.signalsFor\(entry, \{ chain, candles: lc/.test(bt), 'back-test reads strategies.json, has --strategy and uses the registry');
  ok(!fs.existsSync(path.join(root, 'config', 'strategy.json')), 'the old config/strategy.json is gone (one source of truth)');
  ok(fs.existsSync(path.join(root, 'web', 'generated', 'strategies-config.js')) && /window\.STRATEGIES_CONFIG =/.test(fs.readFileSync(path.join(root, 'web', 'generated', 'strategies-config.js'), 'utf8')), 'generated bundle exists');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
