/* Warm Chrome daemon for Vectorizer Bridge (v2: bounded page pool).
   Keeps a headless browser and a pool of reusable pages on the signed-in
   profile so per-run cold launch/profile-attach cost is avoided, and batch
   jobs can run in parallel (bounded by --workers) without extra profile locks.

   IPC: HTTP on 127.0.0.1, port written to <work>/agent-daemon.json.
   Endpoints:
     GET  /health  -> { ok, pid, busy, active, workers, browserPid, profile, state }
     POST /run     -> runs one vectorize job (JSON body = run args), returns status JSON
                      503 when all workers are busy (caller may retry/fallback)
     POST /stop    -> stops daemon and browser

   Notes:
   - Exclusive to the vectorizer-profile while running. Visible sign-in/login
     uses the same profile, so the host stops the daemon before launching login.
   - Jobs run on independent pages; each job gets its own CDP/Fetch session.
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const { SITE, UA, writeStatus, parseArgs, launch, sanitizeProfile } = require('../core/lib');
const { runJob, makeRunError } = require('../vectorizer/job');

// One stray rejection must never take the warm daemon (and every parallel job) down.
process.on('unhandledRejection', (e) => {
  try { console.error('unhandledRejection:', e && e.stack ? e.stack : e); } catch (e2) {}
});

function readJson(req, max = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > max) { try { req.destroy(); } catch (e) {} reject(new Error('body too large')); } });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('bad json body')); }
    });
    req.on('error', reject);
  });
}

function send(res, code, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(data);
}

async function resetPageForReuse(page) {
  try {
    const client = await page.target().createCDPSession();
    try { await client.send('Fetch.disable'); } catch (e) {}
    try { await client.detach(); } catch (e) {}
  } catch (e) {}
  try { if (page.removeAllListeners) page.removeAllListeners('response'); } catch (e) {}
  try { if (page.removeAllListeners) page.removeAllListeners('dialog'); } catch (e) {}
  try { await page.setExtraHTTPHeaders({}); } catch (e) {}
}

async function main() {
  const args = parseArgs(process.argv);
  const profile = args.profile;
  const work = args.work || (profile ? path.dirname(profile) : '');
  const infoPath = args.info || (work ? path.join(work, 'agent-daemon.json') : '');
  const idleMs = parseInt(args['idle-ms'], 10) || (10 * 60 * 1000);
  let maxWorkers = parseInt(args.workers, 10);
  if (!isFinite(maxWorkers) || maxWorkers < 1) maxWorkers = 1;
  if (maxWorkers > 4) maxWorkers = 4;
  if (!profile || !work || !infoPath) throw new Error('missing --profile/--work/--info');

  let browser = null;
  let active = 0;
  let idleTimer = null;
  let stopping = false;
  const freePages = [];

  function bumpIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    if (stopping || active > 0) return;
    idleTimer = setTimeout(() => { shutdown('idle'); }, idleMs);
    try { if (idleTimer.unref) idleTimer.unref(); } catch (e) {}
  }

  async function shutdown(reason) {
    if (stopping) return;
    stopping = true;
    try { if (idleTimer) clearTimeout(idleTimer); } catch (e) {}
    try { if (browser) await browser.close(); } catch (e) {}
    try { fs.unlinkSync(infoPath); } catch (e) {}
    process.exit(0);
  }

  let writeInfo = (port) => {
    try {
      const tmp = infoPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({
        time: Date.now(),
        pid: process.pid,
        browserPid: browser && browser.process ? browser.process().pid : null,
        port, profile, workers: maxWorkers, state: 'ready'
      }), 'utf8');
      fs.renameSync(tmp, infoPath);
    } catch (e) {}
  };

  sanitizeProfile(profile);
  fs.mkdirSync(work, { recursive: true });

  browser = await Promise.race([
    launch({ profile, headless: true }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Chrome launch timed out (60s)')), 60000))
  ]);
  try { browser.on('disconnected', () => { shutdown('browser-disconnected'); }); } catch (e) {}

  async function newWorkerPage() {
    const page = await browser.newPage();
    try { await page.setUserAgent(UA); } catch (e) {}
    try { await page.setViewport({ width: 1280, height: 860 }); } catch (e) {}
    return page;
  }

  async function acquirePage() {
    while (freePages.length) {
      const p = freePages.pop();
      try { if (p && !p.isClosed()) return p; } catch (e) {}
    }
    return newWorkerPage();
  }

  async function releasePage(page) {
    if (!page) return;
    try { if (page.isClosed()) return; } catch (e) { return; }
    try { await resetPageForReuse(page); } catch (e) {}
    try { await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 5000 }); } catch (e) {}
    try {
      if (!page.isClosed() && freePages.length < maxWorkers) freePages.push(page);
      else if (!page.isClosed()) await page.close();
    } catch (e) { try { if (!page.isClosed()) freePages.push(page); } catch (e2) {} }
  }

  // Pre-warm one page to keep first-run latency low (matches prior behavior).
  try { freePages.push(await newWorkerPage()); } catch (e) {}

  const server = http.createServer(async (req, res) => {
    try {
      const url = (req.url || '').split('?')[0];
      if (req.method === 'GET' && url === '/health') {
        return send(res, 200, { ok: true, pid: process.pid, browserPid: browser && browser.process ? browser.process().pid : null, active, busy: active, workers: maxWorkers, profile, state: 'ready' });
      }
      if (req.method === 'POST' && url === '/stop') {
        send(res, 200, { ok: true, stopping: true });
        return shutdown('stop');
      }
      if (req.method === 'POST' && url === '/run') {
        if (active >= maxWorkers) return send(res, 503, makeRunError('daemon busy'));
        // Reserve the slot BEFORE awaiting the body. Two items starting together both
        // passed this check when it sat after the await, so a 2-worker daemon could run
        // three jobs and every later admission decision was off by one.
        active++;
        let job;
        try { job = await readJson(req); } catch (e) { active--; return send(res, 400, makeRunError('unreadable job body')); }
        const statusPath = job && (job.status || job.statusPath);
        if (!job || !job.png || !job.out || !job.profile || !statusPath) {
          active--;
          return send(res, 400, makeRunError('missing --png/--out/--profile/--status'));
        }
        // Acknowledge immediately. runJob runs in background and writes progress/result
        // to statusPath (panel/run.js poll that file). This avoids long-held HTTP
        // connections and stuck run.js processes in parallel batches.
        if (idleTimer) { try { clearTimeout(idleTimer); } catch (e) {} idleTimer = null; }
        try { writeStatus(statusPath, { state: 'launching', message: 'Accepted by warm Chrome daemon…', time: Date.now(), pid: process.pid, browserPid: browser && browser.process ? browser.process().pid : null, viaDaemon: true, warm: true }); } catch (e) {}
        send(res, 202, { state: 'accepted', accepted: true, viaDaemon: true, pid: process.pid });
        (async () => {
          let page = null;
          try {
            page = await acquirePage();
            await runJob(Object.assign({}, job, { statusPath, browser, page, reuse: true, _ensurePage: async () => page, _resetPageForReuse: resetPageForReuse }));
          } catch (e) {
            const msg = e && e.message ? e.message : String(e);
            try { writeStatus(statusPath, { state: 'error', message: msg, time: Date.now(), pid: process.pid, viaDaemon: true }); } catch (e2) {}
            try { if (page && !page.isClosed()) await page.close(); page = null; } catch (e3) {}
          } finally {
            active--;
            if (page) releasePage(page).catch(() => {});
            bumpIdle();
          }
        })().catch(() => {});
        return;
      }
      send(res, 404, { ok: false, error: 'not found' });
    } catch (e) {
      try { send(res, 500, { ok: false, error: e && e.message ? e.message : String(e) }); } catch (e2) {}
    }
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });
  const port = server.address().port;
  writeInfo(port);
  bumpIdle();

  // Heartbeat: the host treats an old agent-daemon.json timestamp as a dead daemon,
  // so keep refreshing it while we are alive (it used to be written once at startup).
  const heartbeat = setInterval(() => { if (!stopping) writeInfo(port); }, 60000);
  try { if (heartbeat.unref) heartbeat.unref(); } catch (e) {}
}

main().catch(e => {
  try { console.error(e && e.stack ? e.stack : e); } catch (e2) {}
  process.exit(1);
});

