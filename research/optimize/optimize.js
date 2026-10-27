#!/usr/bin/env node
'use strict';
/**
 * optimize.js — look for better LTF-condition (C1..C6) settings WITHOUT fooling ourselves.
 *
 *     node research/optimize/optimize.js sweep            # one parameter at a time, everything else as in config/ltf.json
 *     node research/optimize/optimize.js search           # greedy search with a train / test split (both directions)
 *     node research/optimize/optimize.js timeframes       # the same strategy on many LTF candle lengths (HTF = 5 x LTF), older / newer half
 *     node research/optimize/optimize.js c1scan           # Condition 1 only: every scan_min_candles 1..20 x scan_max_candles 2..40, sorted by hit ratio (log file)
 *     node research/optimize/optimize.js cv --base cfg.json --objective winrate --freeze C5 --folds 6   # honest estimate WITHOUT new data: tune on some sessions, trade the others
 *     node research/optimize/optimize.js neighbors --base cfg.json   # is the config a plateau or a lucky peak? tries every setting near it (log file)
 *     node research/optimize/optimize.js c3scan           # Condition 3 only: min_pct 0 x max_pct 0.001, 0.002 .. 0.029, sorted by hit ratio (log file)
 *     node research/optimize/optimize.js c4scan           # Condition 4 only: lookback_min_candles 1..25 x lookback_max_candles 10..30, sorted by hit ratio (log file)
 *     node research/optimize/optimize.js search --objective winrate --freeze C5 --min-trades 12
 *                                                # aim for a HIGH WIN RATE (lower confidence bound of it), keep C5 untouched
 *     node research/optimize/optimize.js sweep --ltf 12   # only the 12s LTF (default: 12,36 — the timeframes the strategy runs on)
 *     node research/optimize/optimize.js sweep --base path/to/ltf.json   # start from another LTF config instead of config/ltf.json
 *
 * It reuses the project's own code (candles from index.html, HTF rules, TL.runChain, the strategy registry and the trade
 * simulation), so a result here is exactly what `node scripts/run-backtest.js` would print for that config.
 * Nothing is written to the config files — the output is a report; applying a setting is a separate, human decision.
 *
 * Why the split: with ~40-60 trades, a parameter chosen on all of them always looks good. So every number is shown for
 * the older half of the sessions, the newer half, and both; the search is tuned on one half and judged on the
 * other (and the other way round). A setting only deserves trust if it helps in BOTH halves.
 */
const fs = require('fs');
const path = require('path');
const TC = require('../../src/confirmation.js');
const TL = require('../../src/ltf-conditions.js');
const TT = require('../../src/trade-sim.js');
const TS = require('../../src/strategies.js');
const TFlow = require('../../src/oi-flow.js');

const root = path.join(__dirname, '..', '..');
const PATHS = require('../../src/paths.js');
const args = process.argv.slice(2);
const mode = args[0];
const opt = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };
const HTF_OF = { 12: 60, 36: 180, 60: 300, 180: 900, 300: 1500 };
const ltfList = (opt('ltf') ? opt('ltf').split(',') : ['12', '36']).map(Number);
if (mode !== 'sweep' && mode !== 'search' && mode !== 'timeframes' && mode !== 'c1scan' && mode !== 'c3scan' && mode !== 'c4scan' && mode !== 'neighbors' && mode !== 'cv') { console.error('usage: node research/optimize/optimize.js sweep|search|timeframes|c1scan|c3scan|c4scan|neighbors|cv [--ltf 12,36]'); process.exit(1); }
const TF_LIST = (opt('ltf') ? opt('ltf').split(',') : ['6', '10', '12', '15', '20', '24', '30', '36', '45', '60', '90', '120', '180', '300']).map(Number);   // for `timeframes`
const htfOf = (ltf) => HTF_OF[ltf] || ltf * 5;                                  // the project's locked 5 : 1 ratio, also for other lengths

const html = fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8');
const buildCandles = new Function('return (' + html.match(/function buildCandles\(ticks, tf\) \{[\s\S]*?\n\}/)[0] + ')')();
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const htfRaw = readJson('config/htf.json');
// the LTF config the sweeps start from: config/ltf.json, or another file with --base <path> (so an experiment left in the config file does not skew the study)
const baseLtf = opt('base') ? JSON.parse(fs.readFileSync(path.resolve(opt('base')), 'utf8')) : readJson('config/ltf.json');
const reg = TS.normalizeRegistry(readJson('config/strategies.json'));
const entry = reg.byName.SB_Bhanusali;
const strat = entry.trade;
const filter = TC.normalizeFilter(htfRaw); filter.rsi = TC.normalizeSmaRsiFilter(htfRaw); filter.oi = TC.normalizeOiFilter(htfRaw);
filter.oiInv = TC.normalizeOiFilterInverse(htfRaw);   // swapped-direction OI gate (oi_change_filter_inverse)
const day = (t) => new Date((t + 19800) * 1000).toISOString().slice(0, 10);

/* ---------------- data: sessions and, per LTF, the HTF zones (they do not depend on the LTF settings) ---------------- */
const sessions = [];
for (const f of fs.readdirSync(PATHS.inputDir).filter((x) => /_DASHBOARD\.json$/.test(x)).sort()) {
  let d; try { d = JSON.parse(fs.readFileSync(path.join(PATHS.inputDir, f), 'utf8')); } catch (e) { continue; }
  const key = String(d.asset || '').toLowerCase(), series = d[key + '_seconds'];
  if (!series || !series.length) continue;
  const ticks = { times: series.map((r) => r.timestamp_epoch), prices: series.map((r) => r[key]) };
  const date = day(ticks.times[0]);
  const dup = sessions.findIndex((x) => x.asset === d.asset && x.date === date);
  if (dup >= 0) sessions.splice(dup, 1);                                   // later file wins, like the back-test
  sessions.push({ asset: d.asset, date, ticks });
}
sessions.sort((a, b) => (a.date < b.date ? -1 : 1));
for (const s of sessions) {
  s.per = {};
  const last = s.ticks.times[s.ticks.times.length - 1];
  for (const ltf of (mode === 'timeframes' ? TF_LIST : ltfList)) {
    const htf = htfOf(ltf);
    const states = TC.evaluate(buildCandles(s.ticks, htf), { htfSec: htf, sessionEndTick: last, filter });
    s.per[ltf] = { lc: buildCandles(s.ticks, ltf), windows: TL.windowsFromStates(states, htf) };
  }
}
const dates = sessions.map((s) => s.date);
const cut = dates[Math.floor(dates.length / 2)];
const OLD = sessions.filter((s) => s.date < cut), NEW = sessions.filter((s) => s.date >= cut);

/* ---------------- evaluation of one LTF config on a set of sessions ---------------- */
const clone = (o) => JSON.parse(JSON.stringify(o));
function evaluate(ltfRaw, set, ltfs) {
  const cfgs = { c1: TL.normalizeCondition1(ltfRaw), c2: TL.normalizeCondition2(ltfRaw), c3: TL.normalizeCondition3(ltfRaw),
                 c4: TL.normalizeCondition4(ltfRaw), c5: TL.normalizeCondition5(ltfRaw), c6: TL.normalizeCondition6(ltfRaw) };
  for (const v of Object.values(cfgs)) if (v.mode === 'error') return null;
  const trades = [];
  for (const s of set) {
    for (const ltf of (ltfs || ltfList)) {
      const p = s.per[ltf];
      const chain = TL.runChain(p.lc, p.windows, cfgs, TC.rsiArray);
      const signals = TS.signalsFor(entry, { chain });
      trades.push(...TT.simulateTrades(signals, s.ticks, p.lc, ltf, strat.cfg).trades.map((t) => Object.assign({ date: s.date }, t)));
    }
  }
  return trades;
}
function stats(trades) {
  const n = trades.length;
  if (!n) return { n: 0, win: null, pnl: 0, pf: null, avgR: null, lcb: null, dd: 0 };
  const wins = trades.filter((t) => t.pnl > 0).length;
  const gp = trades.filter((t) => t.pnl > 0).reduce((a, t) => a + t.pnl, 0), gl = -trades.filter((t) => t.pnl < 0).reduce((a, t) => a + t.pnl, 0);
  const rs = trades.map((t) => t.r), mean = rs.reduce((a, v) => a + v, 0) / n;
  const sd = Math.sqrt(rs.reduce((a, v) => a + (v - mean) * (v - mean), 0) / Math.max(1, n - 1));
  const sorted = trades.slice().sort((a, b) => a.entryTime - b.entryTime);
  let cum = 0, peak = 0, dd = 0;
  for (const t of sorted) { cum += t.pnl; if (cum > peak) peak = cum; if (peak - cum > dd) dd = peak - cum; }
  return { n, win: wins / n, pnl: cum, pf: gl > 0 ? gp / gl : (gp > 0 ? Infinity : null), avgR: mean, lcb: mean - sd / Math.sqrt(n), dd };
}
// fitness used by the joint search: the LOWER confidence bound of the average R (mean - 1 standard error), so a
// setting that only works on a handful of trades cannot win; settings with fewer than MIN_TRADES trades are rejected.
const MIN_TRADES = opt('min-trades') ? Number(opt('min-trades')) : 12;
const OBJECTIVE = opt('objective') || 'avgR';                    // avgR (default) | winrate
const FREEZE = (opt('freeze') || '').split(',').filter(Boolean);
const ONLY = (opt('only') || '').split(',').filter(Boolean);        // search only these conditions, e.g. C6   // conditions the search must not touch, e.g. C5
// Wilson 95 % lower bound of a win rate: a high rate on a handful of trades scores low, so tiny filters cannot win.
const wilson = (w, n) => { if (!n) return 0; const z = 1.96, p = w / n, d = 1 + z * z / n; return (p + z * z / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d; };
const fit = (st) => (st.n < MIN_TRADES ? -Infinity : OBJECTIVE === 'winrate' ? wilson(Math.round(st.win * st.n), st.n) : st.lcb);

const f1 = (v) => (v === null ? '—' : v === Infinity ? '∞' : v.toFixed(2));
const pc = (v) => (v === null ? '—' : (v * 100).toFixed(0) + '%');
const row = (label, o, nw, all) => '| ' + label + ' | ' + all.n + ' | ' + pc(all.win) + ' | ' + f1(all.pnl) + ' | ' + f1(all.pf) + ' | ' + f1(all.lcb) +
  ' | ' + o.n + ' · ' + pc(o.win) + ' · ' + f1(o.pnl) + ' | ' + nw.n + ' · ' + pc(nw.win) + ' · ' + f1(nw.pnl) + ' |';
function show(label, raw) {
  const a = evaluate(raw, sessions);
  if (!a) return null;
  const o = evaluate(raw, OLD), n = evaluate(raw, NEW);
  return { label, all: stats(a), old: stats(o), nw: stats(n) };
}

/* ---------------- the parameter grid, one block per condition ---------------- */
const set = (o, p, v) => { const k = p.split('.'); let x = o; for (let i = 0; i < k.length - 1; i++) x = x[k[i]]; x[k[k.length - 1]] = v; };
const GRID = [
  ['C1', 'condition_1_rsi_cross.rsi_period', [7, 10, 14, 21]],
  ['C1', 'condition_1_rsi_cross.level', [45, 50, 55]],
  ['C1', 'condition_1_rsi_cross.scan_min_candles', [1, 2, 3, 5]],
  ['C1', 'condition_1_rsi_cross.scan_max_candles', [10, 15, 20, 30]],
  ['C2', 'condition_2_sma_trend.fast_period', [5, 9, 13]],
  ['C2', 'condition_2_sma_trend.slow_period', [30, 44, 60]],
  ['C3', 'condition_3_spread_band.min_pct', [0, 0.005, 0.01]],
  ['C3', 'condition_3_spread_band.max_pct', [0.01, 0.02, 0.03, 0.05, 0.1]],
  ['C4', 'condition_4_rsi_sma_extreme.lookback_min_candles', [1, 2, 3, 5]],
  ['C4', 'condition_4_rsi_sma_extreme.lookback_max_candles', [10, 15, 20, 30]],
  ['C4', 'condition_4_rsi_sma_extreme.pattern_a_min', [60, 65, 67.5, 70, 75]],
  ['C4', 'condition_4_rsi_sma_extreme.pattern_a_max', [80, 90, 100]],
  ['C4', 'condition_4_rsi_sma_extreme.pattern_b_max', [25, 30, 32.5, 35, 40]],
  ['C4', 'condition_4_rsi_sma_extreme.pattern_b_min', [0, 10, 20]],
  ['C4', 'condition_4_rsi_sma_extreme.sma_period', [9, 14, 21]],
  ['C5', 'condition_5_distance_ratio.back_candles', [10, 15, 20, 30, 40]],
  ['C5', 'condition_5_distance_ratio.distance_multiplier', [1, 1.5, 2, 2.5, 3]],
  ['C6', 'condition_6_risk_range.min_risk_points', [0, 1, 2, 2.5, 3, 3.5, 4]],
  ['C6', 'condition_6_risk_range.max_risk_points', [4, 5, 6, 8, 10, 1000]],
];
const getv = (o, p) => p.split('.').reduce((x, k) => x[k], o);
// a finer grid for the search (`--grid fine`): more values per setting, so the search can find the edge of a filter
const FINE = [
  ['C1', 'condition_1_rsi_cross.rsi_period', [7, 10, 14, 18, 21, 25]],
  ['C1', 'condition_1_rsi_cross.level', [45, 50, 52.5, 55, 57.5, 60]],
  ['C1', 'condition_1_rsi_cross.scan_min_candles', [1, 2, 3, 5]],
  ['C1', 'condition_1_rsi_cross.scan_max_candles', [10, 15, 20, 25, 30]],
  ['C2', 'condition_2_sma_trend.fast_period', [5, 7, 9, 11, 13]],
  ['C2', 'condition_2_sma_trend.slow_period', [30, 36, 44, 52, 60]],
  ['C3', 'condition_3_spread_band.min_pct', [0, 0.0025, 0.005, 0.0075, 0.01]],
  ['C3', 'condition_3_spread_band.max_pct', [0.01, 0.015, 0.02, 0.03, 0.05]],
  ['C4', 'condition_4_rsi_sma_extreme.lookback_min_candles', [1, 2, 3, 5]],
  ['C4', 'condition_4_rsi_sma_extreme.lookback_max_candles', [10, 15, 20, 25, 30]],
  ['C4', 'condition_4_rsi_sma_extreme.pattern_a_min', [60, 62.5, 65, 67.5, 70, 72.5, 75, 80]],
  ['C4', 'condition_4_rsi_sma_extreme.pattern_a_max', [80, 85, 90, 95, 100]],
  ['C4', 'condition_4_rsi_sma_extreme.pattern_b_max', [20, 25, 27.5, 30, 32.5, 35, 37.5, 40]],
  ['C4', 'condition_4_rsi_sma_extreme.pattern_b_min', [0, 5, 10, 15, 20]],
  ['C4', 'condition_4_rsi_sma_extreme.sma_period', [9, 14, 21]],
  ['C5', 'condition_5_distance_ratio.back_candles', [10, 15, 20, 30, 40]],
  ['C5', 'condition_5_distance_ratio.distance_multiplier', [1, 1.5, 2, 2.5, 3]],
  ['C6', 'condition_6_risk_range.min_risk_points', [0, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5]],
  ['C6', 'condition_6_risk_range.max_risk_points', [4, 5, 6, 7, 8, 10, 1000]],
];
const SEARCH_GRID = opt('grid') === 'fine' ? FINE : GRID;

if (mode === 'sweep') {
  console.log('# One-parameter sweeps — start config: ' + (opt('base') || 'config/ltf.json') + ' — sessions ' + dates[0] + ' … ' + dates[dates.length - 1] + ' (' + sessions.length + '), LTF ' + ltfList.join('s, ') + 's');
  console.log('\nOlder half: ' + dates[0] + ' … before ' + cut + ' (' + OLD.length + ' sessions) · newer half: ' + cut + ' … (' + NEW.length + ' sessions). `lcb` = mean R minus one standard error.');
  for (const [cond, p, vals] of GRID) {
    console.log('\n## ' + cond + ' · ' + p.split('.').pop() + '  (shipped: ' + getv(baseLtf, p) + ')\n');
    console.log('| value | trades | win | P&L | PF | lcb | older half: n · win · P&L | newer half: n · win · P&L |\n|---|---|---|---|---|---|---|---|');
    for (const v of vals) {
      const raw = clone(baseLtf); set(raw, p, v);
      const r = show((v === getv(baseLtf, p) ? '**' + v + '** (shipped)' : String(v)), raw);
      console.log(r ? row(r.label, r.old, r.nw, r.all) : '| ' + v + ' | invalid config |');
    }
  }
}

  // greedy search: each step applies the ONE single-parameter change that most improves the fitness on the TRAIN sessions;
  // stop after `maxChanges` changes (or when nothing improves). Few changes = less room to fit noise.
  function descend(train, maxChanges) {
    let cur = clone(baseLtf), best = fit(stats(evaluate(cur, train) || []));
    const applied = [], path = [{ cfg: clone(cur), applied: [] }];   // path[k] = the config after k changes
    for (let step = 0; step < maxChanges; step++) {
      let pick = null;
      for (const [cnd, p, vals] of SEARCH_GRID) {
        if (FREEZE.indexOf(cnd) >= 0 || (ONLY.length && ONLY.indexOf(cnd) < 0)) continue;   // frozen / excluded conditions are never touched
        for (const v of vals) {
          if (v === getv(cur, p)) continue;
          const cand = clone(cur); set(cand, p, v);
          const t = evaluate(cand, train); if (!t) continue;
          const f = fit(stats(t));
          if (f > best + 1e-9 && (!pick || f > pick.f)) pick = { p, v, f, cand };
        }
      }
      if (!pick) break;
      applied.push(pick.p.split('.').pop() + ' ' + getv(cur, pick.p) + ' → ' + pick.v);
      best = pick.f; cur = pick.cand;
      path.push({ cfg: clone(cur), applied: applied.slice() });
    }
    return { cfg: cur, applied, path };
  }

if (mode === 'search') {
  console.log('# Greedy search with a train / test split — LTF ' + ltfList.join('s, ') + 's, objective = ' + (OBJECTIVE === 'winrate' ? 'lower confidence bound of the WIN RATE' : 'lower bound of average R') + ', minimum ' + MIN_TRADES + ' trades' + (FREEZE.length ? ', frozen: ' + FREEZE.join(', ') : '') + (opt('grid') === 'fine' ? ', fine grid' : '') + '\n');
  console.log('Each row tunes on one half of the sessions (at most K single-parameter changes) and judges the result on the OTHER half. `shipped` = the start config on the same half.\n');
  const Ks = [1, 2, 3, 5, 8];
  for (const [name, train, test] of [['Tuned on the OLDER half, judged on the NEWER half', OLD, NEW], ['Tuned on the NEWER half, judged on the OLDER half', NEW, OLD]]) {
    console.log('## ' + name + '\n');
    const sh_tr = stats(evaluate(baseLtf, train)), sh_te = stats(evaluate(baseLtf, test));
    console.log('| changes allowed | what it changed | TRAIN n · win · P&L | TEST n · win · P&L · PF | TEST win rate vs start |\n|---|---|---|---|---|');
    console.log('| 0 (start) | — | ' + sh_tr.n + ' · ' + pc(sh_tr.win) + ' · ' + f1(sh_tr.pnl) + ' | ' + sh_te.n + ' · ' + pc(sh_te.win) + ' · ' + f1(sh_te.pnl) + ' · ' + f1(sh_te.pf) + ' | — |');
    for (const K of Ks) {
      const r = descend(train, K);
      const a = stats(evaluate(r.cfg, train)), b = stats(evaluate(r.cfg, test));
      const dw = (b.win === null || sh_te.win === null) ? null : (b.win - sh_te.win) * 100;
      console.log('| ' + K + ' | ' + (r.applied.join('; ') || 'nothing') + ' | ' + a.n + ' · ' + pc(a.win) + ' · ' + f1(a.pnl) + ' | ' + b.n + ' · ' + pc(b.win) + ' · ' + f1(b.pnl) + ' · ' + f1(b.pf) + ' | ' + (dw === null ? '—' : (dw >= 0 ? '+' : '') + dw.toFixed(0) + ' pp') + ' |');
    }
    console.log('');
  }
  const finalK = opt('final') ? Number(opt('final')) : 0;
  if (finalK) {                                                   // tune on ALL sessions (no holdout left): prints the result, writes nothing
    const r = descend(sessions, finalK);
    const st = stats(evaluate(r.cfg, sessions)), b0 = stats(evaluate(baseLtf, sessions));
    console.log('## Tuned on ALL sessions (K = ' + finalK + ') — no holdout left, so these numbers are in-sample\n');
    console.log('Changes: ' + (r.applied.join('; ') || 'nothing') + '\n');
    console.log('| | trades | win | P&L | PF | max DD |\n|---|---|---|---|---|---|');
    console.log('| start | ' + b0.n + ' | ' + pc(b0.win) + ' | ' + f1(b0.pnl) + ' | ' + f1(b0.pf) + ' | ' + f1(b0.dd) + ' |');
    console.log('| tuned | ' + st.n + ' | ' + pc(st.win) + ' | ' + f1(st.pnl) + ' | ' + f1(st.pf) + ' | ' + f1(st.dd) + ' |');
    console.log('\n```json\n' + JSON.stringify(r.cfg, null, 2) + '\n```');
  }
}

/* ---------------- one-condition grids (c1scan, c3scan, c4scan): every combination, sorted by hit ratio, written to a log ---------------- */
const rng = (a, b, step) => { const st = step || 1, n = Math.round((b - a) / st); return Array.from({ length: n + 1 }, (_, i) => Math.round((a + i * st) * 1e6) / 1e6); };
function gridScan(spec) {
  // spec: { title, section, minKey, maxKey, minVals, maxVals, minName, maxName, log, validPair?(mn, mx) }
  const out = [];
  const shipped = { min: baseLtf[spec.section][spec.minKey], max: baseLtf[spec.section][spec.maxKey] };
  for (const mn of spec.minVals) {
    for (const mx of spec.maxVals) {
      if (spec.validPair && !spec.validPair(mn, mx)) continue;
      const raw = clone(baseLtf);
      raw[spec.section][spec.minKey] = mn;
      raw[spec.section][spec.maxKey] = mx;
      const t = evaluate(raw, sessions);
      if (!t) continue;                                              // an invalid config is skipped
      const st = stats(t);
      const w = t.filter((x) => x.pnl > 0).length;
      out.push({ mn, mx, n: st.n, w, l: st.n - w, win: st.win, pnl: st.pnl, pf: st.pf, shipped: mn === shipped.min && mx === shipped.max });
    }
  }
  out.sort((a, b) => ((b.win === null ? -1 : b.win) - (a.win === null ? -1 : a.win)) || (b.n - a.n) || (a.mn - b.mn) || (a.mx - b.mx));
  const lines = [];
  const pad = (v, n) => String(v).padStart(n);
  lines.push(spec.title + ' — every other setting as in ' + (opt('base') || 'config/ltf.json') + '; sessions ' + dates[0] + ' … ' + dates[dates.length - 1] + ' (' + sessions.length + '), LTF ' + ltfList.join('s, ') + 's');
  lines.push(spec.minKey + ' ' + spec.minVals[0] + '..' + spec.minVals[spec.minVals.length - 1] + ' x ' + spec.maxKey + ' ' + spec.maxVals[0] + '..' + spec.maxVals[spec.maxVals.length - 1] + ': ' + out.length + ' variations. Sorted by hit ratio (ties: more trades first). No costs.');
  lines.push('Value in the start config: ' + spec.minKey + ' ' + shipped.min + ', ' + spec.maxKey + ' ' + shipped.max + (out.some((r) => r.shipped) ? ' (marked <== START).' : ' (not part of this grid).'));
  lines.push('');
  lines.push('rank  ' + pad(spec.minName, 12) + '  ' + pad(spec.maxName, 12) + '  OVERALL trades  OVERALL win  OVERALL loss  OVERALL hit ratio   P&L pts      PF');
  out.forEach((r, i) => lines.push(
    pad(i + 1, 4) + '  ' + pad(r.mn, 12) + '  ' + pad(r.mx, 12) + '  ' + pad(r.n, 14) + '  ' + pad(r.w, 11) + '  ' + pad(r.l, 12) + '  ' +
    pad(r.win === null ? '—' : (r.win * 100).toFixed(1) + ' %', 17) + '  ' + pad(f1(r.pnl), 8) + '  ' + pad(f1(r.pf), 6) + (r.shipped ? '   <== START' : '')));
  const distinct = new Set(out.map((r) => r.n + '|' + r.w + '|' + f1(r.pnl)));
  lines.push('');
  lines.push(out.length + ' variations produce only ' + distinct.size + ' distinct results (many pairs select the same trades). ' + out.filter((r) => r.n === 0).length + ' produce no trade at all.');
  const file = path.resolve(opt('out') || path.join(PATHS.researchLogDir, spec.log));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n') + '\n');
  console.log(lines.slice(0, 40).join('\n'));
  console.log('... (' + out.length + ' rows in total)\nfull log written to ' + path.relative(root, file));
  return out;
}
if (mode === 'c1scan') {
  gridScan({ title: 'Condition 1 scan range sweep', section: 'condition_1_rsi_cross', minKey: 'scan_min_candles', maxKey: 'scan_max_candles',
    minName: 'scan_min', maxName: 'scan_max', minVals: rng(Number(opt('min-from') || 1), Number(opt('min-to') || 20)),
    maxVals: rng(Number(opt('max-from') || 2), Number(opt('max-to') || 40)), validPair: (mn, mx) => mn <= mx, log: 'c1-scan-sweep.log' });
}
if (mode === 'c3scan') {
  // min_pct fixed at 0 (any positive spread passes the lower edge), max_pct 0.001 .. 0.029 in steps of 0.001
  gridScan({ title: 'Condition 3 spread band sweep', section: 'condition_3_spread_band', minKey: 'min_pct', maxKey: 'max_pct',
    minName: 'min_pct', maxName: 'max_pct', minVals: [0], maxVals: rng(0.001, 0.029, 0.001), validPair: (mn, mx) => mx > mn, log: 'c3-spread-sweep.log' });
}
if (mode === 'c4scan') {
  gridScan({ title: 'Condition 4 look-back range sweep', section: 'condition_4_rsi_sma_extreme', minKey: 'lookback_min_candles', maxKey: 'lookback_max_candles',
    minName: 'lookback_min', maxName: 'lookback_max', minVals: rng(1, 25), maxVals: rng(10, 30), validPair: (mn, mx) => mn <= mx, log: 'c4-lookback-sweep.log' });
}

/* ---------------- neighbors: is the chosen config a plateau (robust) or a sharp peak (probably overfitted)? ---------------- */
if (mode === 'neighbors') {
  // the five settings the C1 / C3 / C4 sweeps tuned; every one is moved by -2..+2 steps around the centre config (all 5^5 combinations)
  const PARAMS = [
    ['condition_1_rsi_cross', 'scan_min_candles', 1, true], ['condition_1_rsi_cross', 'scan_max_candles', 1, true],
    ['condition_3_spread_band', 'max_pct', 0.001, false],
    ['condition_4_rsi_sma_extreme', 'lookback_min_candles', 1, true], ['condition_4_rsi_sma_extreme', 'lookback_max_candles', 1, true],
  ];
  const label = (sec, key) => sec.replace(/^condition_(\d)_.*/, 'C$1') + ' ' + key;
  const center = PARAMS.map(([sec, key]) => baseLtf[sec][key]);
  const make = (deltas) => {
    const raw = clone(baseLtf);
    PARAMS.forEach(([sec, key, step], i) => { raw[sec][key] = Math.round((center[i] + deltas[i] * step) * 1e6) / 1e6; });
    return raw;
  };
  const valid = (raw) => raw.condition_1_rsi_cross.scan_min_candles >= 1 && raw.condition_1_rsi_cross.scan_min_candles <= raw.condition_1_rsi_cross.scan_max_candles &&
    raw.condition_3_spread_band.max_pct > raw.condition_3_spread_band.min_pct &&
    raw.condition_4_rsi_sma_extreme.lookback_min_candles >= 1 && raw.condition_4_rsi_sma_extreme.lookback_min_candles <= raw.condition_4_rsi_sma_extreme.lookback_max_candles;
  const summarize = (trades) => {
    const st = stats(trades), o = stats(trades.filter((t) => t.date < cut)), n = stats(trades.filter((t) => t.date >= cut));
    return { all: st, old: o, nw: n };
  };
  const lines = [];
  const pc1 = (v) => (v === null || v === undefined ? '—' : (v * 100).toFixed(0) + '%');
  lines.push('Neighbourhood check — centre = ' + PARAMS.map(([sec, key], i) => label(sec, key) + ' ' + center[i]).join(' · '));
  lines.push('Start config: ' + (opt('base') || 'config/ltf.json') + ' (all other settings as in it). Sessions ' + dates[0] + ' … ' + dates[dates.length - 1] + ' (' + sessions.length + '), LTF ' + ltfList.join('s, ') + 's. Older half before ' + cut + '. No costs.');
  const c0 = summarize(evaluate(baseLtf, sessions));
  lines.push('');
  lines.push('CENTRE: ' + c0.all.n + ' trades, ' + pc1(c0.all.win) + ' win, P&L ' + f1(c0.all.pnl) + ', PF ' + f1(c0.all.pf) + '   | older half ' + c0.old.n + ' trades ' + pc1(c0.old.win) + ' | newer half ' + c0.nw.n + ' trades ' + pc1(c0.nw.win));

  // 1) one setting at a time, -3 .. +3 steps
  lines.push('');
  lines.push('1) One setting at a time (the others stay at the centre) — trades · win rate:');
  const hdr = ['-3', '-2', '-1', 'centre', '+1', '+2', '+3'];
  lines.push('setting                         ' + hdr.map((h) => h.padStart(13)).join(''));
  PARAMS.forEach(([sec, key, step], i) => {
    const cells = [-3, -2, -1, 0, 1, 2, 3].map((d) => {
      const dl = [0, 0, 0, 0, 0]; dl[i] = d;
      const raw = make(dl);
      if (!valid(raw)) return 'invalid'.padStart(13);
      const st = stats(evaluate(raw, sessions));
      return (st.n + ' · ' + pc1(st.win)).padStart(13);
    });
    lines.push(label(sec, key).padEnd(32) + cells.join(''));
  });
  lines.push('(values: ' + PARAMS.map(([sec, key, step], i) => label(sec, key) + ' ' + [-3, 0, 3].map((d) => Math.round((center[i] + d * step) * 1e6) / 1e6).join('/')).join(' · ') + ')');

  // 2) all combinations of -2..+2 on the five settings
  const pts = [];
  for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (let c = -2; c <= 2; c++) for (let d = -2; d <= 2; d++) for (let e = -2; e <= 2; e++) {
    const raw = make([a, b, c, d, e]);
    if (!valid(raw)) continue;
    const sm = summarize(evaluate(raw, sessions));
    pts.push({ d: [a, b, c, d, e], sm });
  }
  const q = (arr, p) => { const x = arr.slice().sort((u, v) => u - v); return x.length ? x[Math.min(x.length - 1, Math.floor(p * x.length))] : null; };
  const wr = pts.map((p) => p.sm.all.win).filter((v) => v !== null);
  const nn = pts.map((p) => p.sm.all.n);
  const oldWr = pts.filter((p) => p.sm.old.n >= 3).map((p) => p.sm.old.win), newWr = pts.filter((p) => p.sm.nw.n >= 3).map((p) => p.sm.nw.win);
  lines.push('');
  lines.push('2) Every combination within ±2 steps on all five settings together: ' + pts.length + ' valid neighbours');
  lines.push('   win rate   : 10th pct ' + pc1(q(wr, 0.1)) + ' · median ' + pc1(q(wr, 0.5)) + ' · 90th pct ' + pc1(q(wr, 0.9)) + ' · best ' + pc1(Math.max(...wr)) + ' · worst ' + pc1(Math.min(...wr)));
  lines.push('   trades     : 10th pct ' + q(nn, 0.1) + ' · median ' + q(nn, 0.5) + ' · 90th pct ' + q(nn, 0.9));
  lines.push('   older half win rate (neighbours with >= 3 trades): median ' + pc1(q(oldWr, 0.5)) + ' · newer half: median ' + pc1(q(newWr, 0.5)));
  const cw = c0.all.win;
  lines.push('   share of neighbours with win rate >= 60%: ' + (wr.filter((v) => v >= 0.6).length / wr.length * 100).toFixed(0) + '% · >= 65%: ' + (wr.filter((v) => v >= 0.65).length / wr.length * 100).toFixed(0) + '% · >= centre minus 5 points: ' + (wr.filter((v) => v >= cw - 0.05).length / wr.length * 100).toFixed(0) + '%');
  lines.push('   share of neighbours with fewer than 10 trades: ' + (nn.filter((v) => v < 10).length / nn.length * 100).toFixed(0) + '%');
  lines.push('   profit factor median ' + f1(q(pts.map((p) => p.sm.all.pf === Infinity ? 99 : p.sm.all.pf).filter((v) => v !== null), 0.5)) + ' · P&L median ' + f1(q(pts.map((p) => p.sm.all.pnl), 0.5)));
  const text = lines.join('\n') + '\n';
  const file = path.resolve(opt('out') || path.join(PATHS.researchLogDir, 'neighbors.log'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  console.log(text + 'full log written to ' + path.relative(root, file));
}

/* ---------------- cv: blocked k-fold cross-validation of the WHOLE tuning procedure (no new data needed) ---------------- */
if (mode === 'cv') {
  const F = Number(opt('folds') || 6), maxK = Number(opt('max-k') || 5);
  const per = Math.ceil(sessions.length / F);
  const folds = Array.from({ length: F }, (_, i) => sessions.slice(i * per, (i + 1) * per)).filter((x) => x.length);
  const lines = [];
  const pc1 = (v) => (v === null || v === undefined ? '—' : (v * 100).toFixed(1) + '%');
  lines.push('Cross-validation of the tuning procedure — ' + folds.length + ' blocked folds of ~' + per + ' consecutive sessions, LTF ' + ltfList.join('s, ') + 's, objective ' + OBJECTIVE + ', min ' + MIN_TRADES + ' trades on the training sessions' + (FREEZE.length ? ', frozen ' + FREEZE.join(',') : '') + (opt('grid') === 'fine' ? ', fine grid' : ''));
  lines.push('For each fold: tune on the OTHER folds (greedy, up to ' + maxK + ' changes), then trade the held-out fold with each stage. Pooling the held-out trades gives the honest result of "tune, then trade unseen days".');
  lines.push('Start config: ' + (opt('base') || 'config/ltf.json'));
  const oof = Array.from({ length: maxK + 1 }, () => []);        // held-out trades per number of allowed changes
  const firstPicks = {};
  const perFold = [];
  folds.forEach((test, fi) => {
    const train = sessions.filter((x) => test.indexOf(x) < 0);
    const r = descend(train, maxK);
    const row = { fold: fi + 1, from: test[0].date, to: test[test.length - 1].date, sessions: test.length, picks: r.path.map((p) => p.applied.slice(-1)[0] || '—') };
    for (let k = 0; k <= maxK; k++) {
      const stage = r.path[Math.min(k, r.path.length - 1)];            // if the search stopped early, keep its last config
      const t = evaluate(stage.cfg, test) || [];
      oof[k].push(...t);
      if (k === 1 && stage.applied.length) firstPicks[stage.applied[0]] = (firstPicks[stage.applied[0]] || 0) + 1;
      row['k' + k] = stats(t);
    }
    perFold.push(row);
  });
  lines.push('');
  lines.push('Held-out results, all folds pooled (the trades of days the tuning never saw):');
  lines.push('changes allowed   trades   wins   win rate   P&L pts      PF   win-rate lower bound');
  const pooled = oof.map((t) => stats(t));
  pooled.forEach((st, k) => lines.push(String(k === 0 ? '0 (untuned)' : k).padStart(15) + '  ' + String(st.n).padStart(7) + '  ' + String(Math.round((st.win || 0) * st.n)).padStart(5) + '  ' + pc1(st.win).padStart(9) + '  ' + f1(st.pnl).padStart(8) + '  ' + f1(st.pf).padStart(6) + '  ' + pc1(st.n ? wilson(Math.round(st.win * st.n), st.n) : null).padStart(10)));
  lines.push('');
  lines.push('Per fold (held-out trades · win rate) for 0 changes / 1 / 2 / 3 and the change added at each step:');
  perFold.forEach((r) => lines.push('  fold ' + r.fold + ' (' + r.from + ' … ' + r.to + ', ' + r.sessions + ' sessions): ' + [0, 1, 2, 3].map((k) => r['k' + k].n + '·' + pc1(r['k' + k].win)).join('  ') + '   steps: ' + r.picks.slice(1, 4).join(' | ')));
  lines.push('');
  lines.push('First change chosen in each fold (how stable the choice is): ' + (Object.entries(firstPicks).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ×' + v).join(' ; ') || 'none'));
  // choose the number of changes by the held-out evidence, then fit that many on ALL sessions
  let bestK = 0, bestScore = -Infinity;
  pooled.forEach((st, k) => { const sc = st.n >= 8 ? wilson(Math.round(st.win * st.n), st.n) : -Infinity; if (sc > bestScore + 1e-9) { bestScore = sc; bestK = k; } });
  lines.push('');
  lines.push('Best number of changes by held-out win-rate lower bound: ' + bestK + (bestK === 0 ? ' (tuning did not beat the untuned config on unseen days)' : ''));
  const final = descend(sessions, bestK);
  const fs_ = stats(evaluate(final.cfg, sessions)), b0 = stats(evaluate(baseLtf, sessions));
  lines.push('Fitted on ALL sessions with ' + bestK + ' change(s): ' + (final.applied.join('; ') || 'nothing'));
  lines.push('  untuned, all sessions   : ' + b0.n + ' trades, ' + pc1(b0.win) + ' win, P&L ' + f1(b0.pnl) + ', PF ' + f1(b0.pf));
  lines.push('  tuned,   all sessions   : ' + fs_.n + ' trades, ' + pc1(fs_.win) + ' win, P&L ' + f1(fs_.pnl) + ', PF ' + f1(fs_.pf) + '   (in-sample — flattering)');
  lines.push('  expected on unseen days : about the held-out row for ' + bestK + ' change(s) above: ' + pooled[bestK].n + ' trades, ' + pc1(pooled[bestK].win) + ' win, P&L ' + f1(pooled[bestK].pnl) + ' (pooled over ' + sessions.length + ' sessions)');
  const text = lines.join('\n') + '\n';
  const file = path.resolve(opt('out') || path.join(PATHS.researchLogDir, 'cv.log'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  fs.writeFileSync(file.replace(/\.log$/, '-best-config.json'), JSON.stringify(final.cfg, null, 2) + '\n');
  console.log(text + 'log: ' + path.relative(root, file) + ' · fitted config: ' + path.relative(root, file.replace(/\.log$/, '-best-config.json')));
}
