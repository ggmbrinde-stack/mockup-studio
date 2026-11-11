/* Shared vectorization job used by one-shot run.js and the warm daemon.
   Exports runJob(opts) which drives a single PNG->SVG flow and writes status.
*/
const fs = require('fs');
const path = require('path');
const { SITE, UA, writeStatus, launch } = require('../core/lib');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function saveShot(page, debugDir, name) {
  if (!debugDir) return;
  try {
    fs.mkdirSync(debugDir, { recursive: true });
    await page.screenshot({ path: path.join(debugDir, name) });
  } catch (e) { }
}

function pathOf(url) {
  try { return new URL(url).pathname; } catch (e) { return ''; }
}

function isLoginPage(url) {
  return /^\/(support|pricing|login|signin|sign-in)\/?$/.test(pathOf(url));
}

async function waitForExportPage(page, timeoutMs) {
  try {
    const quick = await page.evaluate(() => ({
      ready: !!document.querySelector('button.export_download_button, a.App-downloadLink'),
      href: location.href
    }));
    if (quick.ready) return 'ready';
    if (isLoginPage(quick.href)) return 'login';
  } catch (e) { }
  try {
    const outcome = await Promise.race([
      page.waitForFunction(
        () => !!document.querySelector('button.export_download_button, a.App-downloadLink'),
        { timeout: timeoutMs, polling: 200 }
      ).then(() => 'ready'),
      page.waitForFunction(
        () => /^\/(support|pricing|login|signin|sign-in)\/?$/.test(location.pathname),
        { timeout: timeoutMs, polling: 200 }
      ).then(() => 'login')
    ]);
    return outcome;
  } catch (e) {
    try {
      const state = await page.evaluate(() => ({
        ready: !!document.querySelector('button.export_download_button, a.App-downloadLink'),
        href: location.href
      }));
      if (state.ready) return 'ready';
      if (isLoginPage(state.href)) return 'login';
    } catch (e2) { }
    try { if (isLoginPage(page.url())) return 'login'; } catch (e3) { }
    return 'timeout';
  }
}

function makeRunError(message) {
  return { state: 'error', message: String(message || 'unknown error') };
}

async function runJob(opts) {
  const png = opts.png;
  const outDir = opts.out;
  const profile = opts.profile;
  const statusPath = opts.statusPath || opts.status;
  const timeout = parseInt(opts.timeout, 10) || 5 * 60 * 1000;
  const debugDir = opts.debug || '';
  const runT0 = Date.now();

  if (!png || !outDir || !profile || !statusPath) throw new Error('missing --png/--out/--profile/--status');
  if (!fs.existsSync(png)) throw new Error('input PNG not found: ' + png);

  fs.mkdirSync(outDir, { recursive: true });
  const runStamp = new Date().toISOString().replace(/[:.]/g, '-');

  let browser = opts.browser || null;
  let page = opts.page || null;
  const ownBrowser = !opts.browser;
  let client = null;
  let onDialog = null;
  let onResponse = null;
  let onRequestPaused = null;
  let downloadUrl = null;
  let downloadResolve = null;
  let fetchTimer = null;

  try {
    if (!browser) {
      writeStatus(statusPath, { state: 'launching' });
      browser = await Promise.race([
        launch({ profile, headless: true }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Chrome launch timed out (60s). Close other Chrome windows using this profile or restart Chrome.')), 60000))
      ]);
    } else {
      writeStatus(statusPath, { state: 'launching', warm: true });
    }

    if (!page) {
      if (opts._ensurePage) page = await opts._ensurePage(browser);
      else {
        page = (await browser.pages())[0] || await browser.newPage();
        try { await page.setUserAgent(UA); } catch (e) {}
      }
    }
    // Clean prior run listeners/state if reused.
    if (opts.reuse) {
      if (opts._resetPageForReuse) { try { await opts._resetPageForReuse(page); } catch (e) {} }
      try { page.removeAllListeners('response'); } catch (e) {}
      try { page.removeAllListeners('dialog'); } catch (e) {}
    }

    client = await page.target().createCDPSession();
    onResponse = res => {
      const u = res.url();
      if (/\/download\?/.test(u) && !downloadUrl) { downloadUrl = u; if (downloadResolve) downloadResolve(u); }
    };
    page.on('response', onResponse);
    // Browser.setDownloadBehavior is browser-global and contends across parallel
    // jobs/pages; we capture the SVG via per-page CDP Fetch interception below.
    onDialog = async d => { try { await d.dismiss(); } catch (e) { } };
    page.on('dialog', onDialog);

    writeStatus(statusPath, { state: 'loading' });
    await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#FileInput-Field', { timeout: 30000 });

    writeStatus(statusPath, { state: 'uploading' });
    const input = await page.$('#FileInput-Field');
    await input.uploadFile(png);

    writeStatus(statusPath, { state: 'vectorizing' });
    try {
      await page.waitForFunction(() => {
        const progress = document.getElementById('App-Progress-Dialog');
        if (progress && progress.offsetParent !== null) return false;
        const lightbox = document.getElementById('App-ProgressLightbox');
        if (lightbox && lightbox.offsetParent !== null) return false;
        const a = document.querySelector('.App-downloadLink');
        return !!a && /^\/images\/[^/#]+/.test((a.getAttribute('href') || '').split('#')[0]);
      }, { timeout: Math.min(120000, Math.max(30000, timeout - 5000)) });
    } catch (e) {
      try {
        await page.waitForFunction(() => {
          const a = document.querySelector('.App-downloadLink');
          return !!a && a.getAttribute('aria-disabled') !== 'true';
        }, { timeout: 30000 });
      } catch (e2) { }
    }

    try {
      const siteError = await page.evaluate(() => {
        const a = document.querySelector('.App-downloadLink');
        if (!a) return false;
        const ctx = (a.parentElement && a.parentElement.innerText) || '';
        return /TASK ERROR|Network Error|Connect to worker/i.test(ctx);
      });
      if (siteError) {
        await saveShot(page, debugDir, 'site-error.png');
        const err = { state: 'error', message: 'vectorizer.ai could not process the image (site error).' };
        writeStatus(statusPath, err); return err;
      }
    } catch (e) { }

    writeStatus(statusPath, { state: 'result' });

    const link = await page.evaluate(() => {
      const links = [...document.querySelectorAll('.App-downloadLink')].filter(a => a.offsetParent !== null);
      const a = links[0];
      if (!a) return null;
      return (a.getAttribute('href') || '').split('#')[0];
    });
    if (!link) { const err = { state: 'error', message: 'Download link not found.' }; writeStatus(statusPath, err); return err; }

    let target = link;
    try { target = new URL(link, SITE).href; } catch (e) { }
    try { await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 }); }
    catch (e) { console.error('goto download page failed: ' + e.message); }

    if (isLoginPage(page.url()) || /\/support|\/pricing/i.test(page.url())) {
      const err = { state: 'loginRequired', message: 'vectorizer.ai needs a signed-in account with downloads. Use "Sign in" once.' };
      writeStatus(statusPath, err); return err;
    }

    const pageState = await waitForExportPage(page, 20000);
    if (debugDir) {
      try { fs.writeFileSync(path.join(debugDir, 'page-state.txt'), 'pageState=' + pageState + ' url=' + page.url()); } catch (e) { }
    }
    if (pageState === 'login') {
      await saveShot(page, debugDir, 'login-required.png');
      const err = { state: 'loginRequired', message: 'vectorizer.ai needs a signed-in account with downloads. Use "Sign in" once.' };
      writeStatus(statusPath, err); return err;
    }
    if (pageState !== 'ready') {
      await saveShot(page, debugDir, 'no-export-button.png');
      const err = { state: 'error', message: 'Download page did not load.' };
      writeStatus(statusPath, err); return err;
    }

    writeStatus(statusPath, { state: 'downloading' });
    const svgPath = path.join(outDir, 'vectorizer_export_' + runStamp + '.svg');
    let fetchResolve;
    const fetchPromise = new Promise((resolve, reject) => {
      fetchResolve = resolve;
      fetchTimer = setTimeout(() => reject(new Error('Fetch.requestPaused timeout')), 60000);
    });
    // This run can return early (login bounce, site error) while the wait is still
    // pending. Without a handler that becomes an unhandled rejection 60s later,
    // which kills the warm daemon and can overwrite an already-written status.
    fetchPromise.catch(() => {});
    onRequestPaused = async (ev) => {
      try {
        const result = await client.send('Fetch.getResponseBody', { requestId: ev.requestId });
        let data = result.base64Encoded ? Buffer.from(result.body, 'base64') : Buffer.from(result.body, 'utf8');
        if (data.length > 0) {
          const head = data.toString('utf8', 0, 64);
          if (!/<svg/i.test(head) && !/<\?xml/i.test(head)) throw new Error('response body is not an SVG: ' + head.slice(0, 40));
          fs.writeFileSync(svgPath, data);
        }
        try { await client.send('Fetch.fulfillRequest', { requestId: ev.requestId, responseCode: 200, body: result.body, base64Encoded: !!result.base64Encoded }); } catch (e) {}
        fetchResolve(svgPath);
      } catch (e) {
        console.error('Fetch error:', e);
        try { await client.send('Fetch.fulfillRequest', { requestId: ev.requestId, responseCode: 200, body: '', base64Encoded: false }); } catch (e2) {}
        fetchResolve(null);
      }
    };
    client.on('Fetch.requestPaused', onRequestPaused);
    try {
      await client.send('Fetch.enable', { patterns: [{ urlPattern: '*://*vectorizer.ai*/download*', requestStage: 'Response' }] });
    } catch (e) {
      try { await client.send('Fetch.disable'); } catch (e2) {}
      const err = { state: 'error', message: 'Fetch.enable failed: ' + (e && e.message ? e.message : e) };
      writeStatus(statusPath, err); return err;
    }

    await page.evaluate(() => {
      const btn = document.querySelector('button.export_download_button') || document.querySelector('a.App-downloadLink');
      if (btn) btn.click();
    });

    try {
      await page.waitForFunction(() => {
        const u = location.pathname;
        return /^\/(pricing|support|login|signin|sign-in)\/?$/.test(u);
      }, { timeout: 1200, polling: 100 });
    } catch (e) { }

    if (isLoginPage(page.url()) || /\/support|\/pricing/i.test(page.url())) {
      try { await client.send('Fetch.disable'); } catch (e) {}
      await saveShot(page, debugDir, 'login-required.png');
      const err = { state: 'loginRequired', message: 'vectorizer.ai needs a signed-in account with downloads. Use "Sign in" once.' };
      writeStatus(statusPath, err); return err;
    }

    let result;
    try { result = await fetchPromise; }
    catch (e) {
      try { await client.send('Fetch.disable'); } catch (e2) {}
      const err = { state: 'error', message: 'No download started. The site layout may have changed.' };
      writeStatus(statusPath, err); return err;
    }
    try { await client.send('Fetch.disable'); } catch (e) {}

    if (!result || !fs.existsSync(svgPath) || fs.statSync(svgPath).size === 0) {
      await saveShot(page, debugDir, 'no-download.png');
      const err = { state: 'error', message: 'The download did not finish writing.' };
      writeStatus(statusPath, err); return err;
    }

    const done = { state: 'done', svgPath, elapsedMs: Date.now() - runT0, warm: !!opts.browser };
    writeStatus(statusPath, done);
    return done;
  } finally {
    if (fetchTimer) { try { clearTimeout(fetchTimer); } catch (e) {} fetchTimer = null; }
    try { if (client) { try { await client.send('Fetch.disable'); } catch (e) {} try { client.detach(); } catch (e) {} } } catch (e) {}
    try { if (page && onResponse) page.removeListener('response', onResponse); } catch (e) {}
    try { if (page && onDialog) page.removeListener('dialog', onDialog); } catch (e) {}
    try { if (client && onRequestPaused) client.removeListener('Fetch.requestPaused', onRequestPaused); } catch (e) {}
    // In daemon/reuse mode, keep page+browser alive; reset to a light state.
    if (opts.reuse && page) {
      try { await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 5000 }); } catch (e) {}
    }
    if (ownBrowser && browser) { try { await browser.close(); } catch (e) {} }
  }
}

module.exports = { runJob, makeRunError, isLoginPage, waitForExportPage };

