/* Daemon control: start/stop/status for the warm Chrome daemon.
   Usage:
     node daemon-ctl.js start --profile <dir> --work <dir> [--workers N]
     node daemon-ctl.js stop  --work <dir>
     node daemon-ctl.js status --work <dir>
*/
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { parseArgs } = require('../core/lib');

function infoPathFor(args) {
  if (args.info) return args.info;
  const work = args.work || (args.profile ? path.dirname(args.profile) : '');
  return work ? path.join(work, 'agent-daemon.json') : '';
}

function readInfo(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }

function reqJson(method, port, urlPath, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: urlPath, method, timeout: timeoutMs || 2000 }, res => {
      let out = ''; res.on('data', c => out += c); res.on('end', () => { try { resolve(JSON.parse(out)); } catch (e) { resolve(null); } });
    });
    req.on('timeout', () => { try { req.destroy(); } catch (e) {} reject(new Error('timeout')); });
    req.on('error', reject); req.end();
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const cmd = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : (args.cmd || '');
  const ip = infoPathFor(args);
  if (!ip) throw new Error('missing --work/--profile/--info');
  const info = readInfo(ip);

  if (cmd === 'status') {
    if (!info || !info.port) { console.log(JSON.stringify({ ok: false, state: 'stopped' })); return; }
    try { console.log(JSON.stringify(await reqJson('GET', info.port, '/health', 1500))); }
    catch (e) { console.log(JSON.stringify({ ok: false, state: 'stale' })); }
    return;
  }
  if (cmd === 'stop') {
    if (info && info.port) { try { await reqJson('POST', info.port, '/stop', 2000); } catch (e) {} }
    try { fs.unlinkSync(ip); } catch (e) {}
    console.log(JSON.stringify({ ok: true, state: 'stopped' }));
    return;
  }
  if (cmd === 'start') {
    const profile = args.profile;
    const work = args.work || path.dirname(profile);
    if (!profile) throw new Error('missing --profile');
    let workers = parseInt(args.workers, 10);
    if (!isFinite(workers) || workers < 1) workers = 1;
    if (workers > 4) workers = 4;
    if (info && info.port) {
      try {
        const h = await reqJson('GET', info.port, '/health', 1500);
        if (h && h.ok) {
          const cur = parseInt(h.workers || info.workers || 1, 10);
          if (cur === workers) { console.log(JSON.stringify(h)); return; }
          try { await reqJson('POST', info.port, '/stop', 2000); } catch (e) {}
          try { fs.unlinkSync(ip); } catch (e) {}
        }
      } catch (e) {}
    }
    const child = spawn(process.execPath, [path.join(__dirname, 'server.js'), '--profile', profile, '--work', work, '--info', ip, '--workers', String(workers)], {
      detached: true, stdio: 'ignore', cwd: __dirname, windowsHide: true
    });
    child.unref();
    // wait briefly for info file
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 200));
      const ni = readInfo(ip);
      if (ni && ni.port) { console.log(JSON.stringify({ ok: true, state: 'starting', port: ni.port, pid: ni.pid, workers: ni.workers || workers })); return; }
    }
    console.log(JSON.stringify({ ok: false, state: 'start-timeout' }));
    return;
  }
  throw new Error('usage: node daemon-ctl.js start|stop|status --profile <dir> --work <dir> [--workers N]');
}

if (require.main === module) {
  main().catch(e => { console.error(e && e.message ? e.message : e); process.exit(1); });
}

module.exports = { infoPathFor, main };

