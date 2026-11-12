/* Automatic sign-in for preconfigured installs.
   Reads the studio account from js/admin-config.js (credentialsFile, or a
   credentialsUrl returning {"email","password"}), opens vectorizer.ai in the
   same persistent profile the agent uses, signs in, and leaves the session on
   disk for every later run.

   Writes one of these states to the status file:
     autoSignIn     started, the panel shows "signing in"
     done           signed in (alreadySignedIn:true when the profile had a session)
     loginRequired  no credentials, wrong password, or extra verification such as
                    a captcha - the panel then offers the normal manual sign-in
     error          something failed before the browser could be used

   Usage: node autologin.js --profile <dir> --status <file> [--config <file>]
*/
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const puppeteer = require('puppeteer-core');
const { writeStatus, fail, parseArgs, findBrowser, sanitizeProfile } = require('./lib');

const SITE = 'https://vectorizer.ai/';
const PAGE_TIMEOUT_MS = 45000;
const FORM_TIMEOUT_MS = 20000;

/* admin-config.js is a browser file (`window.VBADMIN = {...};`), so run it with a throwaway
   window object instead of parsing it. A syntax error there just means "not configured". */
function readConfig(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const sandbox = {};
    new Function('window', text)(sandbox);
    return sandbox.VBADMIN || {};
  } catch (e) {
    return {};
  }
}

function getJson(url, redirectsLeft) {
  return new Promise((resolve, reject) => {
    const lib = url.indexOf('https:') === 0 ? https : http;
    const req = lib.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        return resolve(getJson(new URL(res.headers.location, url).toString(), redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('credentials URL returned HTTP ' + res.statusCode));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('credentials URL did not return JSON')); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('credentials URL timed out')); });
    req.on('error', reject);
  });
}

async function loadCredentials(cfg) {
  if (cfg.credentialsFile) {
    try {
      const local = JSON.parse(fs.readFileSync(cfg.credentialsFile, 'utf8'));
      if (local && local.email && local.password) return local;
    } catch (e) { /* fall through to the URL */ }
  }
  if (cfg.credentialsUrl) {
    const remote = await getJson(cfg.credentialsUrl, 3);
    if (remote && remote.email && remote.password) return remote;
  }
  return null;
}

/* The header shows "Log in" when signed out and the account menu when signed in, so its
   presence is the cheapest reliable signal. */
async function loginHref(page) {
  return page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a'));
    const hit = links.find((a) => /^\s*log\s*in\s*$/i.test(a.innerText || ''));
    return hit ? hit.href : '';
  });
}

async function submitLogin(page) {
  const clicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button[type="submit"], input[type="submit"]'));
    const hit = buttons.find((b) => /log\s*in/i.test((b.innerText || b.value || '')));
    if (!hit) return false;
    hit.click();
    return true;
  });
  if (!clicked) throw new Error('the sign-in form has no Log In button');
}

async function main() {
  const args = parseArgs(process.argv);
  const profile = args.profile;
  const statusPath = args.status;
  if (!profile || !statusPath) throw new Error('missing --profile or --status');

  const configPath = args.config || path.join(__dirname, '..', 'js', 'admin-config.js');
  const cfg = readConfig(configPath);

  const executablePath = findBrowser();
  if (!executablePath) throw new Error('Chrome or Edge was not found');

  const creds = await loadCredentials(cfg);
  if (!creds) {
    // Nothing to sign in with: this is the normal case for a self-service install.
    writeStatus(statusPath, { state: 'loginRequired', message: 'no studio account configured' });
    return;
  }

  sanitizeProfile(profile);
  try { fs.mkdirSync(profile, { recursive: true }); } catch (e) { }
  writeStatus(statusPath, { state: 'autoSignIn' });

  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    userDataDir: profile,
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-crash-restore-bubble',
      '--disable-features=Translate,TranslateUI,MediaRouter',
      '--disable-blink-features=AutomationControlled'
    ],
    defaultViewport: { width: 1280, height: 860 }
  });

  try {
    const page = await browser.newPage();
    await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
    await new Promise((r) => setTimeout(r, 1500));

    const href = await loginHref(page);
    if (!href) {
      writeStatus(statusPath, { state: 'done', alreadySignedIn: true });
      return;
    }

    await page.goto(href, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
    await page.waitForSelector('#login_email', { timeout: FORM_TIMEOUT_MS });
    await page.click('#login_email');
    await page.type('#login_email', String(creds.email), { delay: 15 });
    await page.click('#login_password');
    await page.type('#login_password', String(creds.password), { delay: 15 });

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null),
      submitLogin(page)
    ]);

    // A captcha, a second factor or a rejected password all leave the browser on the
    // sign-on host; only a return to the site counts as success.
    let signedIn = false;
    try {
      await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
      await new Promise((r) => setTimeout(r, 1500));
      signedIn = !(await loginHref(page));
    } catch (e) {
      signedIn = false;
    }

    if (signedIn) writeStatus(statusPath, { state: 'done' });
    else writeStatus(statusPath, { state: 'loginRequired', message: 'the sign-in form did not accept the configured account' });
  } finally {
    try { await browser.close(); } catch (e) { }
  }
}

main().catch((e) => {
  const args = parseArgs(process.argv);
  const message = e && e.message ? e.message : String(e);
  if (args.status) fail(args.status, message);
  else console.error(message);
  process.exit(1);
});
