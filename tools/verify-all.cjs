#!/usr/bin/env node
/* Runs every verification suite in one go and fails if any of them fails.

   The suites were written at different times (panel wiring, agent helpers,
   export options, dead CSS) and each is a separate `node tools/...` command, so
   "did I check everything?" depended on remembering the list. This is that list.

   Usage:
     node tools/verify-all.cjs           one line per suite, details only on failure
     node tools/verify-all.cjs --verbose show every suite's full output
*/
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const verbose = process.argv.indexOf('--verbose') >= 0;

/* Working-directory note: the panel-wiring suite lives in the workspace's tools/
   folder, one level above this extension, and expects the panel as its cwd. */
const SUITES = [
  { name: 'panel wiring', cmd: path.resolve(root, '..', 'tools', 'verify-host.cjs') },
  { name: 'agent helpers', cmd: path.join(root, 'tools', 'verify-agent-lib.cjs') },
  { name: 'export options', cmd: path.join(root, 'tools', 'verify-export-options.cjs') },
  { name: 'dead CSS', cmd: path.join(root, 'tools', 'verify-css.cjs') }
];

/* Syntax is the one thing every suite assumes and none of them checks. */
const SYNTAX_DIRS = ['js', 'modules', 'agent'];

function jsFiles(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.charAt(0) === '.') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) jsFiles(full, out);
    else if (/\.(js|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function indent(text) {
  return String(text || '').split('\n').filter(function (l) { return l.trim(); })
    .map(function (l) { return '       ' + l; }).join('\n');
}

const failures = [];
const skipped = [];
const results = [];

function runSuite(suite) {
  if (!fs.existsSync(suite.cmd)) {
    skipped.push(suite.name + ' (not found: ' + suite.cmd + ')');
    return;
  }
  const started = Date.now();
  const res = spawnSync(process.execPath, [suite.cmd], { cwd: root, encoding: 'utf8' });
  const ms = Date.now() - started;
  const output = (res.stdout || '') + (res.stderr || '');
  const ok = res.status === 0;
  results.push({ name: suite.name, ok: ok, ms: ms, output: output });
  if (!ok) failures.push(suite.name);
}

function runSyntax() {
  const started = Date.now();
  const files = [];
  for (const dir of SYNTAX_DIRS) jsFiles(path.join(root, dir), files);
  const bad = [];
  for (const file of files) {
    const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (res.status !== 0) bad.push(path.relative(root, file) + ': ' + String(res.stderr || '').trim().split('\n')[0]);
  }
  const ms = Date.now() - started;
  results.push({
    name: 'js syntax (' + files.length + ' files)',
    ok: bad.length === 0,
    ms: ms,
    output: bad.join('\n')
  });
  if (bad.length) failures.push('js syntax');
}

const suiteStart = Date.now();
for (const suite of SUITES) runSuite(suite);
runSyntax();

for (const r of results) {
  console.log((r.ok ? '  ok   ' : '  FAIL ') + r.name + ' (' + r.ms + ' ms)');
  if (!r.ok || verbose) {
    const body = indent(r.output);
    if (body) console.log(body);
  }
}
for (const s of skipped) console.log('  skip ' + s);

console.log('');
if (failures.length) {
  console.log(failures.length + ' of ' + results.length + ' checks failed: ' + failures.join(', '));
  process.exit(1);
}
console.log('All checks passed (' + results.length + ' checks, ' + (Date.now() - suiteStart) + ' ms).');
