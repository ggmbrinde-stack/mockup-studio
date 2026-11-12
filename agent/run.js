/* Headless vectorizer run (smart entrypoint).
   - If a warm daemon is healthy for this profile, runs the job via it (fast).
   - Otherwise runs the job in-process (one-shot, original behavior).
   - If --no-daemon is passed, skips daemon attempt.

   Usage:
     node run.js --png <file> --out <dir> --profile <dir> --status <file>
                 [--timeout <ms>] [--debug <dir>] [--work <dir>] [--no-daemon]
*/
const fs = require('fs');
const path = require('path');
const http = require('http');

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

function writeStatus(statusPath, payload) {
  try {
    if (!statusPath) return;
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

process.on('uncaughtException', (e) => {
  try { const a = parseArgs(process.argv); fail(a.status, 'uncaught: ' + (e && e.stack ? e.stack : e)); } catch (e2) { }
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  try { const a = parseArgs(process.argv); fail(a.status, 'unhandled: ' + (e && e.stack ? e.stack : e)); } catch (e2) { }
  process.exit(1);
});

function httpJson(method, port, urlPath, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ hostname: '127.0.0.1', port, path: urlPath, method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}, timeout: timeoutMs || 5000 }, (res) => {
      let out = '';
      res.on('data', c => out += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: out ? JSON.parse(out) : null }); }
        catch (e) { resolve({ status: res.statusCode, body: null, raw: out }); }
      });
    });
    req.on('timeout', () => { try { req.destroy(); } catch (e) {} reject(new Error('timeout')); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function readStatusFile(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}
async function pollStatusFile(statusPath, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 330000);
  let lastState = '';
  while (Date.now() < deadline) {
    const s = readStatusFile(statusPath);
    if (s && s.state) {
      lastState = s.state;
      if (s.state === 'done' || s.state === 'error' || s.state === 'loginRequired' || s.state === 'loginClosed' || s.state === 'cancelled') return s;
    }
    await new Promise(r => setTimeout(r, 450));
  }
  return { state: 'error', message: 'Timed out waiting for daemon result' + (lastState ? (' (last: ' + lastState + ')') : '') + '.' };
}

/* The warm daemon writes agent-daemon.json before it can answer /health (Chrome is
   launched first), and every job in a parallel batch reads that file at the same
   moment. Deleting it on the first unanswered probe made the sibling jobs decide the
   daemon was gone and start their own Chrome on the same profile - the profile-lock
   pile-up that showed up as "stuck: starting". So wait briefly for a warm daemon and
   only drop the file once it is genuinely stale. */
const DAEMON_WAIT_MS = 20000;
const DAEMON_STALE_MS = 3 * 60 * 1000;

async function waitForDaemonHealth(info, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const h = await httpJson('GET', info.port, '/health', null, 1200);
      if (h && h.body && h.body.ok) return h.body;
    } catch (e) { /* port not listening yet */ }
    if (Date.now() >= deadline) return null;
    await new Promise(r => setTimeout(r, 400));
  }
}

async function tryDaemon(args) {
  if (args['no-daemon'] || args.noDaemon) return null;
  const work = args.work || (args.profile ? path.dirname(args.profile) : '');
  if (!work) return null;
  const infoPath = path.join(work, 'agent-daemon.json');
  let info;
  try { info = JSON.parse(fs.readFileSync(infoPath, 'utf8')); } catch (e) { return null; }
  if (!info || !info.port) return null;
  if (info.profile && args.profile && path.resolve(info.profile) !== path.resolve(args.profile)) return null;
  const fresh = Number(info.time || 0) > 0 && (Date.now() - Number(info.time || 0)) < DAEMON_STALE_MS;
  const health = await waitForDaemonHealth(info, fresh ? DAEMON_WAIT_MS : 3000);
  if (!health) {
    if (!fresh) { try { fs.unlinkSync(infoPath); } catch (e) {} }
    return null;
  }
  const job = {
    png: args.png, out: args.out, profile: args.profile, status: args.status,
    timeout: parseInt(args.timeout, 10) || 300000, debug: args.debug || '', work
  };
  const jobTimeout = Math.max(60000, (parseInt(args.timeout, 10) || 300000) + 30000);
  const deadline = Date.now() + 120000; // wait for a slot
  while (Date.now() < deadline) {
    try {
      // Short request timeout: daemon should ack quickly (async /run v2) or reply 503.
      const r = await httpJson('POST', info.port, '/run', job, 8000);
      if (r && (r.status === 409 || r.status === 503)) {
        try { writeStatus(args.status, { state: 'launching', message: 'Waiting for a warm Chrome slot...', time: Date.now() }); } catch (e) {}
        await new Promise(res => setTimeout(res, 900));
        continue;
      }
      if (r && r.body && (r.body.accepted || r.status === 202 || r.body.viaDaemon)) {
        return await pollStatusFile(args.status, jobTimeout);
      }
      if (r && r.body && r.body.state) return r.body;
      return { state: 'error', message: 'Daemon returned an unexpected response.' };
    } catch (e) {
      // A failed POST is not proof the daemon is gone: it may be mid-start while a
      // sibling item is already using it. Only drop the pointer when /health also
      // fails, otherwise the next item in the batch would launch a second Chrome on
      // the same profile (the profile-lock pile-up).
      const stillUp = await waitForDaemonHealth(info, 4000);
      if (!stillUp) { try { fs.unlinkSync(infoPath); } catch (e2) {} }
      return null;
    }
  }
  return { state: 'error', message: 'Vectorizer daemon stayed busy. Reduce parallel workers or wait, then retry.' };
}

(async () => {
  const args = parseArgs(process.argv);
  const t0 = Date.now();
  try {
    if (!args.png || !args.out || !args.profile || !args.status) {
      writeStatus(args.status || '', { state: 'error', message: 'Missing --png/--out/--profile/--status.' });
      process.exit(1);
    }
    // Host/launcher writes a "starting" marker; keep status fresh even before daemon/job progress.
    try { writeStatus(args.status, { state: 'starting' }); } catch (e) {}
    let result = null;
    try { result = await tryDaemon(args); } catch (e) { result = null; }
    if (result && result.state) {
      const out = Object.assign({}, result);
      if (!out.time) out.time = Date.now();
      if (out.state === 'done' && !out.viaDaemon) out.viaDaemon = false;
      try { writeStatus(args.status, out); } catch (e) {}
      process.exit(out.state === 'done' ? 0 : 1);
    }
    // One-shot fallback (only when daemon missing/unreachable)
    let runJob;
    try { ({ runJob } = require('./job')); }
    catch (e) { throw new Error('Agent failed to load: ' + (e && e.message ? e.message : e) + '. Check agent-log.txt.'); }
    result = await runJob(Object.assign({}, args, { statusPath: args.status }));
    process.exit(result && result.state === 'done' ? 0 : 1);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    try { writeStatus(args.status, { state: 'error', message: msg, time: Date.now() }); } catch (e2) {}
    process.exit(1);
  }
})();
