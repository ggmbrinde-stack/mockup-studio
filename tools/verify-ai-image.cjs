#!/usr/bin/env node
/* Gemini in Chrome — the browser-assisted image workflow.

   This feature exists because the Google AI Plus benefits live in the consumer
   Gemini app, not in paid API quota. That promise is easy to break silently: one
   `generativelanguage.googleapis.com` call, one Playwright script or one
   `--user-data-dir` would turn it into a billed API integration or an
   unsupported automation of the site. So this suite checks the boundary, the
   local file contract, and the panel wiring — plus the one piece of real logic
   that can run outside Illustrator: the image validation.

   Run: node tools/verify-ai-image.cjs */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
let failures = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + ' -> ' + e.message); }
}
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const host = read('host/ai.jsx');
const exporter = read('host/export.jsx');
const loader = read('js/bridge/host.js');
const html = read('index.html');
const css = read('css/style.css');
const panel = read('js/panel.js');
const module_ = read('modules/ai-image/ai-image.js');
const en = read('js/locales/en.js');
const pt = read('js/locales/pt.js');

/* The section, so markup checks do not accidentally pass on another block. */
const sectionAt = html.indexOf('id="aiImageBox"');
const section = sectionAt < 0 ? '' : html.slice(sectionAt, html.indexOf('</details>', sectionAt));

console.log('Gemini in Chrome');

check('the host API is complete', () => {
  ['geminiPaths', 'ensureGeminiFolders', 'prepareGeminiSource', 'saveGeminiRequest', 'openGeminiWindow',
    'inspectImageFile', 'pickImageFile', 'listGeminiResults', 'newestGeminiResult', 'placeImageFile', 'cleanGeminiWorkspace']
    .forEach((fn) => assert.ok(new RegExp('VB\\.' + fn + ' = function').test(host), 'missing VB.' + fn));
});

check('the host loads it after the exporter and before the agent', () => {
  const exportAt = loader.indexOf('/host/export.jsx');
  const aiAt = loader.indexOf('/host/ai.jsx');
  const agentAt = loader.indexOf('/host/agent.jsx');
  assert.ok(aiAt >= 0, 'js/bridge/host.js does not load host/ai.jsx');
  assert.ok(exportAt < aiAt, 'the exporter must be defined first');
  assert.ok(aiAt < agentAt, 'the agent launcher should stay last of the three');
});

check('the source image reuses the existing exporter', () => {
  assert.ok(/VB\.exportSelection\(pngLongSide, out\)/.test(host), 'the source is not exported through VB.exportSelection');
  assert.ok(/VB\.exportSelection = function \(pngLongSide, outPath\)/.test(exporter), 'exportSelection has no output path');
  assert.ok(/outPath && String\(outPath\)\.length/.test(exporter), 'exportSelection ignores the output path');
  /* No second export path: PNG24 options and the pixel budget must not be duplicated. */
  assert.ok(host.indexOf('ExportOptionsPNG24') < 0, 'ai.jsx duplicates the PNG export options');
  assert.ok(host.indexOf('exportResolution') < 0, 'ai.jsx duplicates the resolution budget');
});

/* Comments explain the guarantee ("no cookies are read"); the code is what has
   to hold. Strip comments before looking for the things that would break it. */
function code(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}
const hostCode = code(host);
const moduleCode = code(module_);

check('it uses the consumer site, never the paid API', () => {
  assert.ok(/https:\/\/gemini\.google\.com\/app/.test(moduleCode), 'the consumer Gemini URL is not used');
  const forbidden = [
    'generativelanguage', 'x-goog-api-key', 'aiplatform', 'googleapis.com',
    'google-cloud', 'apiKey', 'GEMINI_API_KEY', 'OPENAI', 'secrets.json'
  ];
  for (const term of forbidden) {
    assert.ok(hostCode.indexOf(term) < 0, 'host/ai.jsx mentions ' + term);
    assert.ok(moduleCode.indexOf(term) < 0, 'modules/ai-image/ai-image.js mentions ' + term);
  }
});

check('the browser is never automated or inspected', () => {
  const forbidden = [
    'puppeteer', 'playwright', 'selenium', 'chrome.debugger',
    '--user-data-dir', '--remote-debugging', 'cookies', 'localStorage'
  ];
  for (const term of forbidden) {
    assert.ok(hostCode.indexOf(term) < 0, 'host/ai.jsx mentions ' + term);
    assert.ok(moduleCode.indexOf(term) < 0, 'modules/ai-image/ai-image.js mentions ' + term);
  }
  /* Chrome is started as the user's own browser, in its own app window: their
     profile, no separate user-data-dir, no profile-directory override. */
  assert.ok(/--app="/.test(hostCode), 'Gemini is not opened as an app window');
  assert.ok(/\/Google\/Chrome\/Application\/chrome\.exe/.test(hostCode), 'Chrome is not located');
  assert.ok(hostCode.indexOf('--profile-directory') < 0, 'Chrome is not started on the users own profile');
});

check('the workspace is under the bridge folder and the results are the user\'s', () => {
  assert.ok(/VB\.getBridgeFolderPath\(\) \+ "\/gemini"/.test(host), 'the workspace is not inside Documents/VectorizerBridge');
  ['/source', '/results', '/requests'].forEach(function (sub) {
    assert.ok(host.indexOf('"' + sub + '"') >= 0, 'no ' + sub + ' folder');
  });
  /* Cleanup may only age out what this feature wrote itself. */
  const cleanAt = host.indexOf('VB.cleanGeminiWorkspace = function');
  assert.ok(cleanAt > 0, 'no cleanup function');
  const cleanBody = host.slice(cleanAt);
  assert.ok(cleanBody.indexOf('p.source') >= 0 && cleanBody.indexOf('p.requests') >= 0, 'cleanup does not target our own folders');
  assert.ok(cleanBody.indexOf('p.results') < 0, 'cleanup would delete the user\'s results');
});

check('the panel section exists with the documented controls', () => {
  assert.ok(section, 'no #aiImageBox section');
  ['aiImgUseSelection', 'aiImgOpen', 'aiImgCopy', 'aiImgResultsFolder', 'aiImgPick', 'aiImgPlace',
    'aiImgPrompt', 'aiImgTemplate', 'aiImgSourcePreview', 'aiImgResultPreview', 'aiImgResults', 'aiImgStatus']
    .forEach((id) => assert.ok(section.indexOf('id="' + id + '"') >= 0, 'missing #' + id));
  ['aiImgTplProduct', 'aiImgTplBackground', 'aiImgTplPhoto', 'aiImgTplGeneral']
    .forEach((key) => assert.ok(section.indexOf('data-i18n="' + key + '"') >= 0, 'no template ' + key));
  assert.ok(/role="status"/.test(section), 'the status line is not announced');
});

check('the module is loaded after the gemini API block and before boot', () => {
  const geminiAt = html.indexOf('<script src="modules/ai/gemini.js">');
  const imageAt = html.indexOf('<script src="modules/ai-image/ai-image.js">');
  const bootAt = html.indexOf('<script src="js/panel.js">');
  assert.ok(imageAt >= 0, 'the module is not loaded');
  assert.ok(geminiAt < imageAt && imageAt < bootAt, 'script order is wrong');
  assert.ok(/VBPanel\.aiImage[\s\S]{0,80}\.init/.test(panel), 'panel.js does not start the module');
});

check('the module only talks to the host for file and placement work', () => {
  ['prepareGeminiSource', 'openGeminiWindow', 'pickImageFile', 'listGeminiResults', 'placeImageFile', 'saveGeminiRequest', 'cleanGeminiWorkspace']
    .forEach((fn) => assert.ok(module_.indexOf(fn) >= 0, 'the module never calls ' + fn));
  assert.ok(/bridge\.evalJsx/.test(module_), 'the module does not use the host bridge');
  /* Placement has to keep the original artwork: no replace path in this version,
     and the host no longer offers one to reach for. */
  assert.ok(!/hideOriginal/.test(module_), 'the module passes a hide-original flag');
  assert.ok(!/hideOriginal|allowAnyDoc/.test(host), 'the host kept a placement path this workflow never uses');
  assert.ok(/layerName: LAYER_NAME/.test(module_), 'the result does not get its own layer');
});

/* Boot order bug this suite now guards: at DOM ready bridge.hostOk is still false
   even inside a docked panel, because vectorizer.init() only then starts
   bridge.loadHost(). Reading the flag once left every button disabled for good. */
check('it waits for the asynchronous host instead of reading the flag once', () => {
  const waitBody = module_.slice(module_.indexOf('function waitForHost('), module_.indexOf('function refreshResults('));
  assert.ok(waitBody.length > 0, 'no host readiness wait');
  assert.ok(/bridge\.hostOk/.test(waitBody), 'the wait never checks hostOk');
  assert.ok(/setTimeout\(function \(\) \{ waitForHost\(/.test(module_), 'the wait does not retry');
  assert.ok(/waitForHost\(HOST_TRIES\)/.test(module_), 'init does not start the wait');
  assert.ok(!/setStatus\(bridge\.hostOk \?/.test(module_), 'the status is still decided once at boot');
});

check('every string the module itself shows exists in both languages', () => {
  const keys = new Set();
  for (const m of module_.matchAll(/\btxt\(\s*"([A-Za-z0-9_]+)"/g)) keys.add(m[1]);
  for (const m of module_.matchAll(/key:\s*"(aiImgTpl[A-Za-z]+Text)"/g)) keys.add(m[1]);
  assert.ok(keys.size > 20, 'only ' + keys.size + ' strings found in the module');
  const missing = [...keys].filter((k) => !new RegExp('\\b' + k + ':').test(en) || !new RegExp('\\b' + k + ':').test(pt));
  assert.strictEqual(missing.join(', '), '', 'missing ' + missing.join(', '));
});

/* The vectorize flow ends by itself; this one ends in Gemini. The return leg is
   the compromise: watch our own results folder, then place. It must not become
   a browser automation, a Downloads-folder crawler, or a race against the user. */
check('the return leg waits for the download instead of asking twice', () => {
  assert.ok(/function startWatch\(/.test(module_), 'no watcher');
  const openBody = module_.slice(module_.indexOf('function openGemini('), module_.indexOf('function copyPrompt('));
  assert.ok(/startWatch\(\)/.test(openBody), 'Open Gemini does not arm the watch');
  const pickBody = module_.slice(module_.indexOf('function pickResult('), module_.indexOf('function useResult('));
  assert.ok(/stopWatch\(\)/.test(pickBody), 'a manual pick does not stop the watch');
  assert.ok(/newestGeminiResult/.test(module_), 'the watcher never asks the host for new files');
  /* A watch is identified by a counter, not by its own timestamp: the answer to
     one poll must be rejected when another watch has been armed or stopped since. */
  assert.ok(/var watchSeq = 0/.test(module_), 'watches are not distinguishable');
  assert.ok(/function stopWatch\(\) \{[^}]*watchSeq\+\+/.test(module_), 'stopping a watch does not invalidate it');
  assert.ok(/if \(seq !== watchSeq\) return/.test(module_), 'a late answer could place after the user took over');
  assert.ok(/aiImgAutoPlaced/.test(module_), 'an automatic placement looks like a manual one');

  const fn = host.slice(host.indexOf('VB.newestGeminiResult = function'), host.indexOf('VB.placeImageFile = function'));
  assert.ok(fn.indexOf('p.results') >= 0, 'the host does not scan the results folder');
  assert.ok(!/Downloads/i.test(fn), 'the host scans the Downloads folder');
});

/* Caught on screen, not by reading: the export set `source` but re-synced the
   buttons before it existed, so Open Gemini / Copy / Show file stayed disabled
   and the workflow had no way forward at all. */
check('a prepared source enables the next step', () => {
  const body = module_.slice(module_.indexOf('function useSelection('), module_.indexOf('function openGemini('));
  const afterSource = body.slice(body.indexOf('source = r;'));
  assert.ok(afterSource.length > 0, 'useSelection no longer assigns the source');
  assert.ok(/syncButtons\(\)/.test(afterSource), 'the source-dependent buttons are not re-enabled after the export');
});

/* Two guarantees the user asked for by name: the destination is stated the
   moment Gemini opens, and an automatic placement can never land in a document
   other than the one the source came from. */
check('the destination is stated and opened right after Open Gemini', () => {
  assert.ok(/resultsFolder: p\.results/.test(host), 'the export does not report where to save the download');
  const openBody = module_.slice(module_.indexOf('function openGemini('), module_.indexOf('function copyPrompt('));
  assert.ok(/aiImgSaveInto/.test(openBody), 'Open Gemini does not say where to save the download');
  assert.ok(/openResultsFolder\(\)/.test(openBody), 'Open Gemini does not open the results folder');
  assert.ok(/resultsFolder/.test(openBody), 'the folder path is not shown, only a generic sentence');
  assert.ok(/startWatch\(\)/.test(openBody), 'the watch is not armed');
});

check('automatic placement is pinned to the export document, manual place is not', () => {
  assert.ok(/requireDoc/.test(host), 'the host has no document requirement for automatic placement');
  assert.ok(/requireDoc[\s\S]{0,200}docChanged/.test(host), 'a mismatch is not refused');
  assert.ok(/docFullName: res\.docFullName/.test(host), 'the export does not record which document it came from');
  const placeBody = module_.slice(module_.indexOf('function placeResult('), module_.indexOf('function renderResults('));
  assert.ok(/if \(auto && source\) args\.requireDoc/.test(placeBody), 'the watcher does not pin the document');
  assert.ok(/aiImgDocChangedAuto/.test(placeBody), 'a refused automatic placement is not explained');
  /* The result must survive the refusal, so Place still works. */
  assert.ok(!/result = null/.test(placeBody), 'the result is dropped when placement is refused');
});

check('newestGeminiResult only returns an image newer than the moment it was armed', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-gemini-'))
  const results = path.join(tmp, 'gemini', 'results');
  fs.mkdirSync(results, { recursive: true });
  const older = path.join(results, 'older.png');
  const fresh = path.join(results, 'fresh.jpg');
  fs.writeFileSync(older, Buffer.from([0x89, 0x50, 0x4E, 0x47]));
  fs.writeFileSync(fresh, Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]));
  fs.writeFileSync(path.join(results, 'notes.txt'), 'not an image');
  const hourAgo = new Date(Date.now() - 3600 * 1000);
  fs.utimesSync(older, hourAgo, hourAgo);

  function FileStub(filePath) {
    this.fsName = filePath;
    this.name = path.basename(filePath);
    this.exists = fs.existsSync(filePath);
    this.length = this.exists ? fs.statSync(filePath).size : 0;
    this.modified = this.exists ? fs.statSync(filePath).mtime : new Date(0);
    this.open = function () { return true; };
    this.read = function () { return ''; };
    this.close = function () { };
  }
  function FolderStub(dirPath) {
    this.fsName = dirPath;
    this.exists = fs.existsSync(dirPath);
    this.create = function () { try { fs.mkdirSync(dirPath, { recursive: true }); this.exists = true; return true; } catch (e) { return false; } };
    this.getFiles = function (filter) {
      if (!this.exists) return [];
      const out = [];
      for (const name of fs.readdirSync(dirPath)) {
        const full = path.join(dirPath, name);
        if (!fs.statSync(full).isFile()) continue;
        const f = new FileStub(full);
        if (!filter || filter(f)) out.push(f);
      }
      return out;
    };
  }

  const vb = { toJSON: (o) => JSON.stringify(o), log: () => { }, getBridgeFolderPath: () => tmp, writeTextFile: () => 'ok', readTextFile: () => '' };
  const ctx = vm.createContext({ $: { global: { VB: vb } }, File: FileStub, Folder: FolderStub, isFinite: isFinite, Number: Number, String: String, Date: Date, Math: Math, parseInt: parseInt });
  vm.runInContext(host, ctx);
  try {
    const armed = Date.now() - 1000;
    const found = JSON.parse(vb.newestGeminiResult(armed));
    assert.strictEqual(found.file && found.file.name, 'fresh.jpg', 'the newest image was not picked');
    /* Nothing newer than the arm: a download from an earlier request must not fire. */
    assert.strictEqual(JSON.parse(vb.newestGeminiResult(Date.now() + 60000)).file, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

check('the block is styled and stays out of the compact window', () => {
  assert.ok(/\.aiImgRow\s*\{/.test(css), 'no .aiImgRow style');
  assert.ok(/\.aiImgThumb\s*\{/.test(css), 'no thumbnail style');
  assert.ok(/\.aiImgResults\s*\{/.test(css), 'no results list style');
  assert.ok(/\.mode-mini #aiImageBox|\.windowMode #aiImageBox/.test(css), 'the floating window would show the block');
});

check('every string the block needs exists in both languages', () => {
  const markupKeys = [];
  const attr = /data-i18n(?:-placeholder)?="([A-Za-z0-9_]+)"/g;
  let m;
  while ((m = attr.exec(section))) markupKeys.push(m[1]);
  assert.ok(markupKeys.length > 5, 'the section has almost no translatable text');
  const missing = markupKeys.filter((k) => !new RegExp('\\b' + k + ':').test(en) || !new RegExp('\\b' + k + ':').test(pt));
  assert.strictEqual(missing.join(', '), '', 'missing ' + missing.join(', '));

  /* Every aiImg* key that exists must exist in both files, so a half-translated
     string never shows the raw key in the panel. */
  const keys = [];
  const keyRe = /^\s+(aiImg[A-Za-z0-9_]+):/gm;
  while ((m = keyRe.exec(en))) keys.push(m[1]);
  assert.ok(keys.length > 40, 'only ' + keys.length + ' aiImg keys in en.js');
  const halfDone = keys.filter((k) => !new RegExp('^\\s+' + k + ':', 'm').test(pt));
  assert.strictEqual(halfDone.join(', '), '', 'pt.js is missing ' + halfDone.join(', '));
});

/* The one piece of logic that runs outside Illustrator: a downloaded file must
   really be a PNG/JPEG/WebP before it reaches the placement call. */
check('inspectImageFile validates the file by its bytes', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-aiimg-'));
  const png = path.join(tmp, 'shot.png');
  const jpeg = path.join(tmp, 'renamed.png');   /* wrong extension on purpose */
  const webp = path.join(tmp, 'shot.webp');
  const text = path.join(tmp, 'notes.png');     /* a renamed text file */
  fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64'));
  fs.writeFileSync(jpeg, Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]));
  fs.writeFileSync(webp, Buffer.from([0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]));
  fs.writeFileSync(text, 'hello, this is not an image');

  function FileStub(filePath) {
    this.fsName = filePath;
    this.name = path.basename(filePath);
    this.exists = fs.existsSync(filePath);
    this.length = this.exists ? fs.statSync(filePath).size : 0;
    this._buf = null;
    this.open = function () { try { this._buf = fs.readFileSync(filePath); return true; } catch (e) { return false; } };
    this.read = function (n) {
      if (!this._buf) return '';
      let out = '';
      for (let i = 0; i < n && i < this._buf.length; i++) out += String.fromCharCode(this._buf[i]);
      return out;
    };
    this.close = function () { this._buf = null; };
  }

  const vb = {
    toJSON: (o) => JSON.stringify(o),
    log: () => { },
    getBridgeFolderPath: () => tmp
  };
  const ctx = vm.createContext({ $: { global: { VB: vb } }, File: FileStub, Folder: function () { } });
  vm.runInContext(host, ctx);
  const inspect = (p) => JSON.parse(vb.inspectImageFile(p));
  try {
    assert.strictEqual(inspect(png).kind, 'png', 'a PNG was not recognised');
    assert.strictEqual(inspect(jpeg).kind, 'jpeg', 'a JPEG was not recognised by its bytes');
    assert.strictEqual(inspect(webp).kind, 'webp', 'a WebP was not recognised');
    assert.strictEqual(inspect(text).ok, false, 'a text file was accepted as an image');
    assert.strictEqual(inspect(text).error, 'unsupportedImage');
    assert.strictEqual(inspect(path.join(tmp, 'nope.png')).error, 'fileNotFound');
    assert.strictEqual(inspect(png).name, 'shot.png');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

console.log(failures ? '\n' + failures + ' check(s) failed' : '\nAll Gemini in Chrome checks passed');
process.exit(failures ? 1 : 0);
