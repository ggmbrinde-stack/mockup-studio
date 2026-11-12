/* Shared helpers for the Vectorizer Bridge agent. Runs under the system Node,
   driven by the CEP panel. No network calls of its own: it only drives Chrome. */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const SITE = 'https://vectorizer.ai/';

/* A normal desktop Chrome UA. Headless Chrome's default UA is refused by the
   site's worker connection ("Connect to worker -10"), but a regular UA works. */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';

function chromeCandidates() {
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  return [
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    local ? path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ].filter(Boolean);
}

function findBrowser() {
  for (const candidate of chromeCandidates()) {
    try { if (fs.existsSync(candidate)) return candidate; } catch (e) { }
  }
  return '';
}

function writeStatus(statusPath, payload) {
  try {
    const tmp = statusPath + '.tmp';
    const body = Object.assign({ time: Date.now(), pid: process.pid }, payload);
    fs.writeFileSync(tmp, JSON.stringify(body), 'utf8');
    fs.renameSync(tmp, statusPath);
  } catch (e) { }
}

function fail(statusPath, message, extra) {
  const body = Object.assign({ state: 'error', message: String(message || 'unknown error') }, extra || {});
  writeStatus(statusPath, body);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out[key] = next; i++; }
      else { out[key] = 'true'; }
    }
  }
  return out;
}

/* Flags shared by every Chrome this extension starts. The translate bubble is
   switched off so it never covers the page, and the crash-restore bubble is
   suppressed because a cancelled run can leave the profile marked as crashed. */
/* The batch opens several pages in one headless Chrome. Chrome throttles
   background renderers (requestAnimationFrame stops, timers drop to once a
   second), and puppeteer's waitForFunction polls with rAF by default - so every
   page except the active one sat still until its wait timed out. That is the
   "second item stalls while the first finishes" batch hang. */
const COMMON_ARGS = [
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-crash-restore-bubble',
  '--disable-features=Translate,TranslateUI,MediaRouter',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding'
];

/* A hard-killed Chrome writes exit_type "Crashed" into the profile. Chrome then
   offers "Restore pages?" and can open a blank window instead of the site, which
   looks like an all-black sign-in page. Reset that flag before each launch. */
function sanitizeProfile(profile) {
  try {
    const prefs = path.join(profile, 'Default', 'Preferences');
    if (!fs.existsSync(prefs)) return;
    const data = JSON.parse(fs.readFileSync(prefs, 'utf8'));
    const settings = data.profile || (data.profile = {});
    if (settings.exit_type !== 'Normal' || settings.exited_cleanly !== true) {
      settings.exit_type = 'Normal';
      settings.exited_cleanly = true;
      fs.writeFileSync(prefs, JSON.stringify(data));
    }
  } catch (e) { /* a missing or locked profile is not fatal */ }
}

async function launch({ profile, headless }) {
  const executablePath = findBrowser();
  if (!executablePath) throw new Error('Chrome or Edge was not found');

  sanitizeProfile(profile);

  const args = COMMON_ARGS.concat([
    '--disable-blink-features=AutomationControlled',
    '--window-size=1280,860'
  ]);
  if (headless) args.push('--window-position=-32000,-32000');

  return puppeteer.launch({
    executablePath,
    headless: headless ? 'new' : false,
    userDataDir: profile,
    args,
    defaultViewport: { width: 1280, height: 860 }
  });
}

/* Args for the visible sign-in window. It is started as a plain Chrome process
   on purpose: the automation build can open without a visible window (Chrome
   only shows its popups), which reads as a black sign-in window.

   appWindow: true opens the site as a standalone app window (no tabs, no
   address bar) on the same profile the agent uses, which keeps the session and
   the agent's cookies identical. false opens a normal tab, which is what the
   optional "Install app" flow needs because Chrome only offers its install UI
   in a regular window. */
function signInArgs({ profile, appWindow }) {
  const args = COMMON_ARGS.concat([
    '--user-data-dir=' + profile,
    '--window-size=1280,860',
    '--window-position=80,60'
  ]);
  if (appWindow) return args.concat(['--app=' + SITE]);
  return args.concat(['--new-window', SITE]);
}

module.exports = {
  SITE,
  UA,
  findBrowser,
  writeStatus,
  fail,
  parseArgs,
  launch,
  sanitizeProfile,
  signInArgs
};
