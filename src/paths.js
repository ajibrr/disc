/*
 * paths.js — where the Node tools read and write (node only). Reads config/paths.json.
 *   input_dir         the *_DASHBOARD.json tick files
 *   output_dir        trades CSV and --out run logs (created when missing)
 *   research_log_dir  logs written by research/optimize
 * Relative paths are resolved against the project folder, absolute paths are used as is, so the same
 * config works from any working directory and on a server. Env vars override the file:
 * DISC_PATHS_FILE, DISC_INPUT_DIR, DISC_OUTPUT_DIR, DISC_RESEARCH_LOG_DIR.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const file = process.env.DISC_PATHS_FILE ? path.resolve(process.env.DISC_PATHS_FILE) : path.join(root, 'config', 'paths.json');
const DEFAULTS = { input_dir: 'input', output_dir: 'output', research_log_dir: 'research/optimize/logs' };

let raw = {};
try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
catch (e) {
  if (e.code !== 'ENOENT' || process.env.DISC_PATHS_FILE) { console.error('cannot read ' + file + ': ' + e.message); process.exit(1); }
}

const base = process.env.DISC_PATHS_FILE ? path.dirname(file) : root;
const pick = (key, env) => {
  const v = process.env[env] || raw[key] || DEFAULTS[key];
  if (typeof v !== 'string' || !v.trim()) { console.error('paths.json: ' + key + ' must be a non-empty string'); process.exit(1); }
  return path.resolve(process.env[env] ? process.cwd() : base, v);
};

const paths = {
  root,
  file,
  inputDir: pick('input_dir', 'DISC_INPUT_DIR'),
  outputDir: pick('output_dir', 'DISC_OUTPUT_DIR'),
  researchLogDir: pick('research_log_dir', 'DISC_RESEARCH_LOG_DIR'),
  /** a file the tools write: an absolute path is kept, anything else goes inside output_dir (folder created if needed) */
  outputFile(name, dir) {
    const d = dir || paths.outputDir;
    const full = path.isAbsolute(name) ? name : path.join(d, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    return full;
  },
};
module.exports = paths;
