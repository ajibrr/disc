'use strict';
/**
 * build-config.js — generates charts/config.js from config/htf.json.
 *
 * config/htf.json is the SINGLE editable source of truth for configuration.
 * The page loads charts/config.js as a plain <script> so it keeps working
 * from file:// (no fetch, no CORS) — the same pattern as build-data.js/data.js.
 *
 * ** Run this after every change to config/htf.json: **
 *
 *     node charts/build-config.js              # config/htf.json -> charts/config.js
 *     node charts/build-config.js path/to.json # alternate source (e.g. scratch tests)
 *
 * Exits 1 on an unreadable or malformed source so a broken config never
 * silently produces a stale or partial artifact.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2);
const srcPath = args[0] ? path.resolve(args[0]) : path.join(__dirname, '..', 'config', 'htf.json');
const outFile = path.join(__dirname, 'config.js');

let raw;
try {
  raw = fs.readFileSync(srcPath, 'utf8');
} catch (e) {
  console.error('build-config: cannot read ' + srcPath + ': ' + e.message);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(raw);
} catch (e) {
  console.error('build-config: invalid JSON in ' + srcPath + ': ' + e.message);
  process.exit(1);
}
if (data === null || typeof data !== 'object' || Array.isArray(data)) {
  console.error('build-config: ' + srcPath + ' must contain a JSON object');
  process.exit(1);
}

const sha = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);

// Already generated from this exact source? Leave the artifact (and its timestamp) alone.
if (fs.existsSync(outFile)) {
  const prev = fs.readFileSync(outFile, 'utf8');
  const m = prev.match(/"sourceSha":"([0-9a-f]+)"/);
  if (m && m[1] === sha && prev.indexOf('window.HTF_CONFIG =') !== -1) {
    console.log('config.js is up to date (sourceSha ' + sha + ')');
    process.exit(0);
  }
}

const banner =
  '/* Auto-generated from ' + path.basename(srcPath) + ' by build-config.js — do not edit by hand.\n' +
  '   Run `node charts/build-config.js` after every change to the config JSON. */\n';
const payload = Object.assign({}, data, { sourceSha: sha, generatedAt: new Date().toISOString() });
const body = 'window.HTF_CONFIG = ' + JSON.stringify(payload) + ';\n';

fs.writeFileSync(outFile, banner + body);
console.log('wrote ' + outFile + ' from ' + srcPath + ' (sourceSha ' + sha + ')');
