'use strict';
/**
 * build-config.js — generates the page's config bundles from the JSON sources.
 *
 *   config/htf.json -> web/generated/config.js      (window.HTF_CONFIG)
 *   config/ltf.json -> web/generated/ltf-config.js  (window.LTF_CONFIG)
 *   config/strategies.json -> web/generated/strategies-config.js  (window.STRATEGIES_CONFIG)
 *
 * The JSON files are the SINGLE editable source of truth for configuration.
 * The page loads the bundles as plain <script>s so it keeps working from
 * file:// (no fetch, no CORS) — the same pattern as build-data.js/data.js.
 *
 * ** Run this after every change to either config JSON: **
 *
 *     node scripts/build-config.js              # both bundles
 *     node scripts/build-config.js path/to.json # alternate HTF source only (e.g. scratch tests)
 *
 * Exits 1 on an unreadable or malformed source so a broken config never
 * silently produces a stale or partial artifact.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function generate(srcPath, outFile, globalName) {
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
  const outName = path.basename(outFile);

  // Already generated from this exact source? Leave the artifact (and its timestamp) alone.
  if (fs.existsSync(outFile)) {
    const prev = fs.readFileSync(outFile, 'utf8');
    const m = prev.match(/"sourceSha":"([0-9a-f]+)"/);
    if (m && m[1] === sha && prev.indexOf('window.' + globalName + ' =') !== -1) {
      console.log(outName + ' is up to date (sourceSha ' + sha + ')');
      return;
    }
  }

  const banner =
    '/* Auto-generated from ' + path.basename(srcPath) + ' by build-config.js — do not edit by hand.\n' +
    '   Run `node scripts/build-config.js` after every change to the config JSON. */\n';
  const payload = Object.assign({}, data, { sourceSha: sha, generatedAt: new Date().toISOString() });
  const body = 'window.' + globalName + ' = ' + JSON.stringify(payload) + ';\n';

  fs.writeFileSync(outFile, banner + body);
  console.log('wrote ' + outFile + ' from ' + srcPath + ' (sourceSha ' + sha + ')');
}

const args = process.argv.slice(2);
const root = path.join(__dirname, '..');
if (args[0]) {
  generate(path.resolve(args[0]), path.join(root, 'web', 'generated', 'config.js'), 'HTF_CONFIG');
} else {
  generate(path.join(root, 'config', 'htf.json'), path.join(root, 'web', 'generated', 'config.js'), 'HTF_CONFIG');
  generate(path.join(root, 'config', 'ltf.json'), path.join(root, 'web', 'generated', 'ltf-config.js'), 'LTF_CONFIG');
  generate(path.join(root, 'config', 'strategies.json'), path.join(root, 'web', 'generated', 'strategies-config.js'), 'STRATEGIES_CONFIG');
}
