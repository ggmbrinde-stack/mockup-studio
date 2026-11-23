#!/usr/bin/env node
/* "What's new" card and the feature tour.

   The card is only as good as its data, so this suite keeps the announcement
   for the version in CSXS/manifest.xml present, checks that every string it
   points at exists in both languages, and checks that every tour target is a
   real element: a tour that highlights nothing is worse than no tour.

   Run: node tools/verify-tour.cjs */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
let failures = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + ' -> ' + e.message); }
}
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const html = read('index.html');
const manifest = read('CSXS/manifest.xml');
const panel = read('js/panel.js');
const app = read('js/core/app.js');
const css = read('css/style.css');
const en = read('js/locales/en.js');
const pt = read('js/locales/pt.js');

/* Run the shipped data file, so what is checked is what the panel loads. */
const sandbox = { window: {} };
vm.runInNewContext(read('js/whats-new.js'), sandbox);
const data = sandbox.window.VBWHATSNEW || {};

const version = (/ExtensionBundleVersion="([0-9][0-9.]*)"/.exec(manifest) || [])[1] || '';

console.log('What\'s new / tour');

check('the manifest version is readable and numeric', () => {
  assert.ok(/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version), 'manifest version is "' + version + '"');
});

check('the installed version has an announcement', () => {
  assert.ok(data[version], 'no entry for ' + version + ' in js/whats-new.js');
  const entry = data[version];
  assert.ok(Array.isArray(entry.bullets) && entry.bullets.length > 0, 'no bullets for ' + version);
  assert.ok(Array.isArray(entry.tour) && entry.tour.length > 0, 'no tour steps for ' + version);
});

check('every announced string exists in both languages', () => {
  const keys = [];
  for (const v of Object.keys(data)) {
    const entry = data[v] || {};
    for (const k of (entry.bullets || [])) keys.push(k);
    for (const s of (entry.tour || [])) { keys.push(s.titleKey); keys.push(s.bodyKey); }
  }
  assert.ok(keys.length > 0, 'nothing announced');
  const missing = [];
  for (const key of keys) {
    if (!key) { missing.push('(empty key in data)'); continue; }
    if (!new RegExp('\\b' + key + ':').test(en)) missing.push('en.' + key);
    if (!new RegExp('\\b' + key + ':').test(pt)) missing.push('pt.' + key);
  }
  assert.strictEqual(missing.join(', '), '', 'missing ' + missing.join(', '));
});

check('every tour target is a real element id', () => {
  const missing = [];
  for (const v of Object.keys(data)) {
    for (const s of ((data[v] || {}).tour || [])) {
      if (!s.target || html.indexOf('id="' + s.target + '"') < 0) missing.push(v + ':' + s.target);
    }
  }
  assert.strictEqual(missing.join(', '), '', 'no element for ' + missing.join(', '));
});

check('the card is in the markup and can be hidden', () => {
  ['tourCard', 'tourTitle', 'tourStep', 'tourBody', 'tourBack', 'tourSkip', 'tourNext', 'whatsNewBtn']
    .forEach((id) => assert.ok(html.indexOf('id="' + id + '"') >= 0, 'missing #' + id));
  assert.ok(/id="tourCard"[^>]*hidden/.test(html), 'the card would flash before the tour decides');
});

check('the panel loads the data before the tour and starts it', () => {
  /* Match the tags, not the bare paths: the card's comment mentions both files. */
  const dataAt = html.indexOf('<script src="js/whats-new.js">');
  const tourAt = html.indexOf('<script src="modules/tour/tour.js">');
  const bootAt = html.indexOf('<script src="js/panel.js">');
  assert.ok(dataAt >= 0 && tourAt >= 0, 'scripts are not both loaded');
  assert.ok(dataAt < tourAt && tourAt < bootAt, 'script order is wrong');
  assert.ok(/VBPanel\.tour[\s\S]{0,80}\.init/.test(panel), 'panel.js does not start the tour');
});

check('the panel exposes its own version for the tour to key on', () => {
  assert.ok(/core\.extensionVersion = function/.test(app));
  assert.ok(/readExtensionVersion\(\)/.test(app), 'the manifest is no longer read');
});

check('the card is styled and kept out of the compact window', () => {
  assert.ok(/\.tourCard\s*\{/.test(css));
  assert.ok(/\.tourTarget\s*\{/.test(css));
  assert.ok(/body\[data-mode="mini"\] #tourCard/.test(css), 'the floating window would show the tour card');
});

check('the tour can never run twice for the same version', () => {
  const tour = read('modules/tour/tour.js');
  assert.ok(/ms\.whatsNewSeen/.test(tour));
  assert.ok(/seen\(\) === version\(\)/.test(tour));
  assert.ok(/setupOpen\(\)/.test(tour), 'the tour does not wait for the first-run wizard');
});

console.log(failures ? '\n' + failures + ' check(s) failed' : '\nAll What\'s-new checks passed');
process.exit(failures ? 1 : 0);
