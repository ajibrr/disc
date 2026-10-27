#!/usr/bin/env node
'use strict';
/**
 * run-all.js — runs every tests/*.test.js and prints one line per suite plus a total.
 *
 *     node tests/run-all.js          # or: npm test
 *
 * Exit code 1 if any suite reports a failed check or crashes.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const files = fs.readdirSync(__dirname).filter((f) => /\.test\.js$/.test(f)).sort();
let passed = 0, failed = 0, crashed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8' });
  const last = (r.stdout || '').trim().split('\n').pop() || '';
  const m = /(\d+) passed, (\d+) failed/.exec(last);
  if (!m) { crashed++; console.log(f.padEnd(28) + 'CRASHED  ' + ((r.stderr || '').split('\n')[0] || last).slice(0, 100)); continue; }
  passed += Number(m[1]); failed += Number(m[2]);
  console.log(f.padEnd(28) + (m[2] === '0' ? 'ok       ' : 'FAILED   ') + m[1] + ' passed, ' + m[2] + ' failed');
}
console.log('\n' + files.length + ' suites · ' + passed + ' checks passed · ' + failed + ' failed' + (crashed ? ' · ' + crashed + ' crashed' : ''));
process.exit(failed || crashed ? 1 : 0);
