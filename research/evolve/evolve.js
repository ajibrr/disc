#!/usr/bin/env node
'use strict';
/**
 * evolve.js — evolutionary (genetic) strategy search with walk-forward validation.
 *
 *     node research/evolve/evolve.js                      # defaults: cost 2 pts, pop 50, 20 generations
 *     node research/evolve/evolve.js --cost 3 --seed 7 --pop 80 --gens 30
 *     node research/evolve/evolve.js --input path/to/dashboards
 *
 * What it does
 *   1. Loads every *_DASHBOARD.json (duplicates of the same asset+date are skipped, the longer file wins).
 *   2. A genome = entry rule (opening-range breakout / SMA cross / RSI cross) + optional OI-direction filter + ATR stop + R:R target.
 *      A population of genomes evolves (selection, crossover, mutation) on the TRAIN days only.
 *   3. Walk-forward: evolve on days 1..k, score the winner on the NEXT unseen block, grow the window, repeat.
 *      Only those out-of-sample (OOS) trades are used to judge the procedure. In-sample numbers are never trusted.
 *   4. The OOS result is compared with randomly picked genomes and checked against acceptance criteria.
 *
 * Fixed rules (not learned): entry at the next candle's first tick, no entry from 15:00 IST, hard exit 15:15 IST,
 * one position at a time, stop/target replayed tick by tick, round-trip cost in points (--cost) charged every trade.
 * Fitness (train) = lower confidence bound of average R after costs, minus a small complexity penalty.
 * If nothing passes, "no reliable edge found" is a valid answer.
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const COST = +opt('cost', 2), SEED = +opt('seed', 1), POP = +opt('pop', 50), GENS = +opt('gens', 20);
const INPUT = path.resolve(opt('input', path.join(__dirname, '..', '..', 'input')));
const OPEN = 9 * 3600 + 15 * 60, NO_ENTRY_FROM = 15 * 3600, HARD_EXIT = 15 * 3600 + 15 * 60;

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* ---------------- data ---------------- */
function loadDays() {
  const byKey = {}, skipped = [];
  for (const f of fs.readdirSync(INPUT).filter((x) => /_DASHBOARD\.json$/.test(x)).sort()) {
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(INPUT, f), 'utf8')); } catch (e) { skipped.push(f + ' (unreadable)'); continue; }
    const k = String(d.asset || '').toLowerCase(), s = d[k + '_seconds'];
    if (!s || !s.length) { skipped.push(f + ' (no second data)'); continue; }
    const date = s[0].timestamp.slice(0, 10), key = d.asset + ' ' + date;
    if (byKey[key] && byKey[key].t.length >= s.length) { skipped.push(f + ' (duplicate of ' + key + ')'); continue; }
    if (byKey[key]) skipped.push(byKey[key].file + ' (duplicate of ' + key + ')');
    const start = Date.parse(date + 'T00:00:00+05:30') / 1000, t = [], p = [];
    for (const r of s) { if (Number.isFinite(r[k]) && Number.isFinite(r.timestamp_epoch)) { t.push(r.timestamp_epoch); p.push(r[k]); } }
    // OI direction per minute: PE OI change minus CE OI change; prefix sums by minute since 09:15
    const diff = new Array(400).fill(0);
    for (const r of (d.flow || [])) {
      const m = Math.round((Date.parse(String(r.timestamp).replace(' ', 'T') + '+05:30') / 1000 - (start + OPEN)) / 60);
      if (m >= 0 && m < 400 && Number.isFinite(r.pe_oi_change) && Number.isFinite(r.ce_oi_change)) diff[m] = r.pe_oi_change - r.ce_oi_change;
    }
    const pref = [0]; for (let i = 0; i < diff.length; i++) pref.push(pref[i] + diff[i]);
    byKey[key] = { file: f, asset: d.asset, date, start, t, p, pref, hasFlow: (d.flow || []).length > 0, c: {}, ind: {} };
  }
  return { days: Object.values(byKey).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.asset < b.asset ? -1 : 1)), skipped };
}

function candlesFor(day, tf) {
  if (day.c[tf]) return day.c[tf];
  const out = []; let cur = null;
  for (let i = 0; i < day.t.length; i++) {
    const b = Math.floor((day.t[i] - day.start) / tf) * tf, p = day.p[i];
    if (!cur || b !== cur.b) { cur = { b, o: p, h: p, l: p, c: p, i0: i }; out.push(cur); }
    else { if (p > cur.h) cur.h = p; if (p < cur.l) cur.l = p; }
    cur.c = p;
  }
  return (day.c[tf] = out);
}
const memo = (day, key, fn) => day.ind[key] || (day.ind[key] = fn());
const smaOf = (a, n) => a.map((_, i) => (i + 1 < n ? NaN : a.slice(i + 1 - n, i + 1).reduce((s, x) => s + x, 0) / n));
function rsiOf(cl, n) {
  const out = new Array(cl.length).fill(NaN); let ag = 0, al = 0;
  for (let i = 1; i < cl.length; i++) {
    const ch = cl[i] - cl[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0);
    if (i <= n) { ag += g / n; al += l / n; } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; }
    if (i >= n) out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}
function atrOf(cs, n) {
  const tr = cs.map((c, i) => (i === 0 ? c.h - c.l : Math.max(c.h - c.l, Math.abs(c.h - cs[i - 1].c), Math.abs(c.l - cs[i - 1].c))));
  return tr.map((_, i) => tr.slice(Math.max(0, i + 1 - n), i + 1).reduce((s, x) => s + x, 0) / Math.min(n, i + 1));
}

/* ---------------- strategy ---------------- */
function signals(g, day) {
  const cs = candlesFor(day, g.tf), cl = cs.map((c) => c.c), out = [];
  const f = g.entry === 'sma' ? memo(day, 'sma' + g.tf + '_' + g.fast, () => smaOf(cl, g.fast)) : null;
  const s = g.entry === 'sma' ? memo(day, 'sma' + g.tf + '_' + g.slow, () => smaOf(cl, g.slow)) : null;
  const r = g.entry === 'rsi' ? memo(day, 'rsi' + g.tf, () => rsiOf(cl, 14)) : null;
  let hi = -Infinity, lo = Infinity;
  if (g.entry === 'orb') for (let i = 0; i < Math.min(g.orbN, cs.length); i++) { hi = Math.max(hi, cs[i].h); lo = Math.min(lo, cs[i].l); }
  for (let i = 1; i < cs.length - 1; i++) {
    let dir = 0;
    if (g.entry === 'orb' && i >= g.orbN) { if (cl[i] > hi && cl[i - 1] <= hi) dir = 1; else if (cl[i] < lo && cl[i - 1] >= lo) dir = -1; }
    else if (g.entry === 'sma') { if (f[i] > s[i] && f[i - 1] <= s[i - 1]) dir = 1; else if (f[i] < s[i] && f[i - 1] >= s[i - 1]) dir = -1; }
    else if (g.entry === 'rsi') { if (r[i - 1] <= g.rsiL && r[i] > g.rsiL) dir = 1; else if (r[i - 1] >= 100 - g.rsiL && r[i] < 100 - g.rsiL) dir = -1; }
    if (!dir) continue;
    const closeSod = cs[i].b + g.tf;
    if (closeSod < OPEN + g.after * 60) continue;
    if (g.oi) {
      const m = Math.floor((closeSod - OPEN) / 60), a = Math.max(0, m + 1 - g.oiLook), b = Math.min(day.pref.length - 1, m + 1);
      const v = day.pref[b] - day.pref[a];
      if (dir > 0 ? !(v > 0) : !(v < 0)) continue;
    }
    out.push({ i, dir });
  }
  return out;
}

function simulate(g, day) {
  const cs = candlesFor(day, g.tf), atr = memo(day, 'atr' + g.tf, () => atrOf(cs, 14)), trades = [];
  let freeAt = -Infinity;
  for (const sg of signals(g, day)) {
    if (trades.length >= g.maxTr) break;
    const nx = cs[sg.i + 1]; if (!nx) continue;
    const ei = nx.i0, et = day.t[ei]; if (et < freeAt || et - day.start >= NO_ENTRY_FROM) continue;
    const risk = g.atrMult * atr[sg.i]; if (!(risk > 0)) continue;
    const entry = day.p[ei], stop = entry - sg.dir * risk, tgt = entry + sg.dir * risk * g.rr;
    let xp = null, xt = null, why = 'eod';
    for (let k = ei + 1; k < day.t.length; k++) {
      const p = day.p[k];
      if (day.t[k] - day.start >= HARD_EXIT) { xp = p; why = 'hard'; }
      else if (sg.dir > 0 ? p <= stop : p >= stop) { xp = stop; why = 'stop'; }
      else if (sg.dir > 0 ? p >= tgt : p <= tgt) { xp = tgt; why = 'target'; }
      if (xp !== null) { xt = day.t[k]; break; }
    }
    if (xp === null) { xp = day.p[day.p.length - 1]; xt = day.t[day.t.length - 1]; }
    const pnl = sg.dir * (xp - entry) - COST;
    trades.push({ date: day.date, asset: day.asset, dir: sg.dir, risk, pnl, R: pnl / risk, why });
    freeAt = xt;
  }
  return trades;
}
const tradesOn = (g, days) => days.flatMap((d) => simulate(g, d));

/* ---------------- statistics ---------------- */
function stats(trades, days) {
  const n = trades.length;
  if (!n) return { n: 0, days: days.length };
  const wins = trades.filter((t) => t.R > 0), gp = wins.reduce((s, t) => s + t.R, 0), gl = -trades.filter((t) => t.R < 0).reduce((s, t) => s + t.R, 0);
  const byDay = {}; days.forEach((d) => { byDay[d.asset + d.date] = 0; });
  trades.forEach((t) => { byDay[t.asset + t.date] += t.R; });
  const dr = Object.values(byDay), mean = dr.reduce((s, x) => s + x, 0) / dr.length;
  const sd = Math.sqrt(dr.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, dr.length - 1));
  let eq = 0, peak = 0, dd = 0; trades.forEach((t) => { eq += t.R; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); });
  const total = trades.reduce((s, t) => s + t.R, 0), best = Math.max(...dr);
  return { n, days: days.length, hit: wins.length / n, avgR: total / n, totalR: total, pf: gl ? gp / gl : Infinity,
           sharpe: sd ? (mean / sd) * Math.sqrt(252) : null, maxDD: dd, calmar: dd ? (total / days.length * 252) / dd : null,
           totalNoBestDay: total - best, avgPnlPts: trades.reduce((s, t) => s + t.pnl, 0) / n };
}
const f2 = (v, d = 2) => (v === null || v === undefined ? '—' : v === Infinity ? '∞' : v.toFixed(d));
const line = (s) => (s.n ? `${String(s.n).padStart(4)} trades  hit ${(s.hit * 100).toFixed(0)}%  avgR ${f2(s.avgR)}  totalR ${f2(s.totalR, 1)}  PF ${f2(s.pf)}  Sharpe ${f2(s.sharpe)}  Calmar ${f2(s.calmar)}  maxDD ${f2(s.maxDD, 1)}R` : '   0 trades');

/* ---------------- genetic search ---------------- */
const GENES = { tf: [300, 600, 900], entry: ['orb', 'sma', 'rsi'], orbN: [1, 2, 3, 4, 6], fast: [5, 8, 10, 13, 20], slow: [21, 30, 44, 50],
  rsiL: [52, 55, 58, 60, 65], oi: [0, 1], oiLook: [5, 15, 30, 60], atrMult: [0.5, 0.75, 1, 1.5, 2], rr: [1, 1.5, 2, 3], maxTr: [1, 2, 3], after: [0, 15, 30, 60] };
const KEYS = Object.keys(GENES), key = (g) => KEYS.map((k) => g[k]).join('|');
const randGenome = (rng) => { const g = {}; KEYS.forEach((k) => { g[k] = GENES[k][Math.floor(rng() * GENES[k].length)]; }); return g; };

function fitness(g, days, cache) {
  const ck = key(g); if (cache.has(ck)) return cache.get(ck);
  const tr = tradesOn(g, days), n = tr.length;
  let score;
  if (n < 20) score = -1 + n / 100;                       // too few trades to say anything
  else {
    const m = tr.reduce((s, t) => s + t.R, 0) / n, sd = Math.sqrt(tr.reduce((s, t) => s + (t.R - m) ** 2, 0) / (n - 1));
    score = m - sd / Math.sqrt(n) - 0.02 * (g.oi + (g.after > 0 ? 1 : 0));
  }
  cache.set(ck, score); return score;
}

function evolve(days, rng) {
  const cache = new Map();
  let pop = Array.from({ length: POP }, () => randGenome(rng));
  let best = null;
  for (let gen = 0; gen < GENS; gen++) {
    const scored = pop.map((g) => ({ g, s: fitness(g, days, cache) })).sort((a, b) => b.s - a.s);
    if (!best || scored[0].s > best.s) best = scored[0];
    const next = scored.slice(0, 2).map((x) => x.g);
    const pick = () => { let w = null; for (let i = 0; i < 3; i++) { const c = scored[Math.floor(rng() * scored.length)]; if (!w || c.s > w.s) w = c; } return w.g; };
    while (next.length < POP) {
      const a = pick(), b = pick(), c = {};
      KEYS.forEach((k) => { c[k] = rng() < 0.5 ? a[k] : b[k]; if (rng() < 0.15) c[k] = GENES[k][Math.floor(rng() * GENES[k].length)]; });
      next.push(c);
    }
    pop = next;
  }
  return { genome: best.g, score: best.s, tried: cache.size };
}

const describe = (g) => {
  const e = g.entry === 'orb' ? `opening-range breakout (first ${g.orbN} candles)` : g.entry === 'sma' ? `SMA ${g.fast}/${g.slow} cross` : `RSI14 cross ${g.rsiL}/${100 - g.rsiL}`;
  return `${g.tf / 60}-min candles, ${e}${g.oi ? `, OI-direction filter (${g.oiLook} min)` : ''}${g.after ? `, no entry in first ${g.after} min` : ''}, stop ${g.atrMult}×ATR, target ${g.rr}R, max ${g.maxTr} trades/day`;
};

/* ---------------- main ---------------- */
const { days, skipped } = loadDays();
console.log(`\nEvolutionary search — cost ${COST} pts/trade, population ${POP}, generations ${GENS}, seed ${SEED}`);
console.log(`Days used: ${days.length} (${days.map((d) => d.date.slice(5)).join(' ')})`);
skipped.forEach((s) => console.log('  skipped: ' + s));
if (days.length < 12) { console.log('Not enough days for a walk-forward test (need at least 12).'); process.exit(0); }

const rng = mulberry32(SEED);
const trainMin = Math.max(8, Math.floor(days.length * 0.5)), BLOCK = 3, folds = [];
for (let s = trainMin; s < days.length; s += BLOCK) folds.push({ train: days.slice(0, s), test: days.slice(s, Math.min(days.length, s + BLOCK)) });

console.log(`\nWalk-forward: ${folds.length} folds, train on all earlier days, test on the next ${BLOCK} unseen days\n`);
const oos = [], oosDays = [], beat = [];
for (const [i, f] of folds.entries()) {
  const ev = evolve(f.train, rng), trT = tradesOn(ev.genome, f.train), teT = tradesOn(ev.genome, f.test);
  const randAvg = []; for (let r = 0; r < 100; r++) { const t = tradesOn(randGenome(rng), f.test); if (t.length) randAvg.push(t.reduce((s, x) => s + x.R, 0) / t.length); }
  const teAvg = teT.length ? teT.reduce((s, x) => s + x.R, 0) / teT.length : null;
  randAvg.sort((a, b) => a - b); const med = randAvg.length ? randAvg[Math.floor(randAvg.length / 2)] : null;
  beat.push(teAvg !== null && med !== null && teAvg > med);
  oos.push(...teT); oosDays.push(...f.test);
  console.log(`Fold ${i + 1}: train ${f.train[0].date}..${f.train[f.train.length - 1].date} (${f.train.length}d) → test ${f.test[0].date}..${f.test[f.test.length - 1].date} (${f.test.length}d)`);
  console.log(`  winner: ${describe(ev.genome)}   [${ev.tried} candidates tried]`);
  console.log(`  train: ${line(stats(trT, f.train))}`);
  console.log(`  TEST : ${line(stats(teT, f.test))}   | random genomes median avgR ${f2(med)}`);
}

const S = stats(oos, oosDays);
console.log('\n=== OUT-OF-SAMPLE (all test blocks combined — the honest estimate) ===');
console.log('  ' + line(S));
const checks = [
  ['at least 100 OOS trades', S.n >= 100, `${S.n}`], ['at least 30 OOS days', oosDays.length >= 30, `${oosDays.length}`],
  ['hit rate ≥ 45%', S.n && S.hit >= 0.45, S.n ? (S.hit * 100).toFixed(0) + '%' : '—'], ['avg R after costs ≥ +0.2', S.n && S.avgR >= 0.2, f2(S.avgR)],
  ['profit factor ≥ 1.4', S.n && S.pf >= 1.4, f2(S.pf)], ['Sharpe ≥ 1', S.n && S.sharpe >= 1, f2(S.sharpe)], ['Calmar ≥ 1', S.n && S.calmar >= 1, f2(S.calmar)],
  ['still positive without best day', S.n && S.totalNoBestDay > 0, f2(S.totalNoBestDay, 1) + 'R'], ['beat random genomes in most folds', beat.filter(Boolean).length > beat.length / 2, `${beat.filter(Boolean).length}/${beat.length}`],
];
checks.forEach(([n, ok, v]) => console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}  (${v})`));
const passed = checks.filter((c) => c[1]).length;
console.log(`\nVerdict: ${passed}/${checks.length} checks passed. ` + (passed === checks.length ? 'Candidate survives walk-forward; paper trade before risking money.' : 'No reliable edge demonstrated yet — more days and/or a simpler idea are needed.'));

/* final candidate on all days + neighbourhood stability */
const fin = evolve(days, rng), finT = tradesOn(fin.genome, days);
console.log('\n=== CANDIDATE evolved on ALL days (in-sample — NOT validated; trust only the walk-forward result above) ===');
console.log('  ' + describe(fin.genome));
console.log('  in-sample: ' + line(stats(finT, days)));
let nb = 0, pos = 0;
KEYS.forEach((k) => { const i = GENES[k].indexOf(fin.genome[k]); [i - 1, i + 1].forEach((j) => { if (j < 0 || j >= GENES[k].length) return; const g = Object.assign({}, fin.genome, { [k]: GENES[k][j] }); const t = tradesOn(g, days); if (t.length) { nb++; if (t.reduce((s, x) => s + x.R, 0) > 0) pos++; } }); });
console.log(`  neighbourhood stability: ${pos}/${nb} one-step parameter changes are still profitable in-sample (a robust setting is a plateau, not a spike)`);
console.log('\nNote: results are in R after costs. A small sample cannot prove an edge; "no reliable edge found" is a valid outcome.\n');
