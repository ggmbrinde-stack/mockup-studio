/* Safe self-updater for the Mockup Studio CEP extension.

   Design rules (deliberately conservative):
   - Never runs automatically. Only the panel's explicit "Update now" starts an apply.
   - HTTPS only, to an allowlist of GitHub hosts, with redirect and size limits.
   - The release asset must publish a SHA-256 digest; it is verified before anything is unpacked.
   - The archive is staged and validated (manifest version + required files) before the live
     install is touched, and the current install is backed up first.
   - The actual file swap runs in a separate PowerShell process that waits for this one to exit,
     so nothing rewrites the folder it is currently running from.
   - Any failure rolls the backup back and reports it in the status file.

   Usage:
     node update.js --action check   --work <bridgeDir> --install <extensionDir> --status <json>
     node update.js --action apply   --work <bridgeDir> --install <extensionDir> --status <json>
     node update.js --action restore --work <bridgeDir> --install <extensionDir> --status <json>
   Test/dev overrides (no network):
     --version 2.3.1 --zip <path.zip> --sha256 <hex>
*/
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a || a.charAt(0) !== '-') continue;
    const key = a.replace(/^-+/, '');
    const next = argv[i + 1];
    if (next && next.charAt(0) !== '-') { out[key] = next; i++; } else { out[key] = true; }
  }
  return out;
}

/* The repository is declared once, in js/admin-config.js, which ships with the panel and
   that the panel reads for its "View release notes" link. The literal is only a last
   resort for a tree where that file is missing. */
const FALLBACK_REPO = 'ggmbrinde-stack/mockup-studio';
function readAdminRepo() {
  try {
    const cfg = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin-config.js'), 'utf8');
    const m = /updateRepo\s*:\s*"([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)"/.exec(cfg);
    return m ? m[1] : '';
  } catch (e) { return ''; }
}
const DEFAULT_REPO = readAdminRepo() || FALLBACK_REPO;
const ALLOWED_HOSTS = new Set([
  'api.github.com',
  'github.com',
  'objects.githubusercontent.com',
  // GitHub redirects release assets here; without it every download is refused.
  'release-assets.githubusercontent.com',
  'codeload.github.com',
  'raw.githubusercontent.com'
]);
const REQUIRED_FILES = ['index.html', 'host/core.jsx', 'host/place.jsx', 'js/bridge/host.js', 'agent/run.js'];
const MAX_BYTES = 80 * 1024 * 1024;

const APPLIER = [
  'param(',
  "  [string]$Mode = 'apply',",
  '  [string]$Source,',
  '  [string]$Dest,',
  '  [string]$Backup,',
  '  [string]$Status,',
  '  [string]$Version,',
  '  [string]$Previous',
  ')',
  "$ErrorActionPreference = 'Stop'",
  'function Write-Status([string]$json) {',
  '  try {',
  "    $tmp = $Status + '.tmp'",
  '    [IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding($false)))',
  '    Move-Item -LiteralPath $tmp -Destination $Status -Force',
  '  } catch {}',
  '}',
  "function Now() { (Get-Date).ToUniversalTime().ToString('o') }",
  'function Copy-Tree([string]$From, [string]$To) {',
  '  New-Item -ItemType Directory -Force -Path $To | Out-Null',
  "  $rc = @($From, $To, '/MIR', '/R:1', '/W:1', '/NFL', '/NDL', '/NP',",
  "    '/XD', 'agent\\node_modules', 'node_modules', '.git', 'agent-downloads', 'agent-debug', 'vectorizer-profile',",
  "    '/XF', 'agent-status*.json', 'agent-daemon.json', 'agent-log.txt', 'log.txt', '*.zip')",
  '  & robocopy @rc | Out-Null',
  '  if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }',
  '}',
  'Start-Sleep -Milliseconds 2000',
  'try {',
  "  if ($Mode -eq 'restore') {",
  '    Copy-Tree $Source $Dest',
  '    Write-Status (ConvertTo-Json -Compress -InputObject @{ state = "restored"; version = $Version; time = (Now); restart = $true })',
  '    exit 0',
  '  }',
  '  Copy-Tree $Dest $Backup',
  '  Copy-Tree $Source $Dest',
  "  $manifest = Join-Path $Dest 'CSXS\\manifest.xml'",
  '  $text = Get-Content -LiteralPath $manifest -Raw',
  "  if ($text -notmatch ('ExtensionBundleVersion=\"' + [regex]::Escape($Version) + '\"')) { throw ('installed manifest does not report version ' + $Version) }",
  '  Write-Status (ConvertTo-Json -Compress -InputObject @{ state = "done"; version = $Version; previous = $Previous; backup = $Backup; restart = $true; time = (Now) })',
  '} catch {',
  '  $msg = $_.Exception.Message',
  '  try { if ($Backup -and (Test-Path $Backup)) { Copy-Tree $Backup $Dest } } catch {}',
  '  Write-Status (ConvertTo-Json -Compress -InputObject @{ state = "error"; message = $msg; rolledBack = $true; time = (Now) })',
  '}',
  ''
].join('\n');

function writeStatus(file, obj) {
  try {
    const payload = Object.assign({ time: Date.now() }, obj);
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
    fs.renameSync(tmp, file);
  } catch (e) { }
}

function get(url, redirects) {
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error('Invalid update URL.')); }
    if (u.protocol !== 'https:') return reject(new Error('Refusing a non-HTTPS update URL.'));
    if (!ALLOWED_HOSTS.has(u.hostname)) return reject(new Error('Refusing an unexpected update host: ' + u.hostname));
    const req = https.get(u, {
      headers: { 'User-Agent': 'MockupStudio-Updater', 'Accept': 'application/vnd.github+json' },
      timeout: 30000
    }, res => {
      if ([301, 302, 303, 307, 308].indexOf(res.statusCode) >= 0) {
        res.resume();
        if (redirects >= 4) return reject(new Error('Too many redirects while downloading the update.'));
        const loc = res.headers.location;
        if (!loc) return reject(new Error('Redirect without a target while downloading the update.'));
        return resolve(get(new URL(loc, u).href, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('GitHub returned HTTP ' + res.statusCode + '. Try again later.'));
      }
      const chunks = [];
      let size = 0;
      res.on('data', c => {
        size += c.length;
        if (size > MAX_BYTES) { req.destroy(); reject(new Error('The update download is unexpectedly large; refusing it.')); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('The update download timed out.')));
    req.on('error', e => reject(new Error(e && e.code === 'ENOTFOUND' ? 'Could not reach GitHub (no internet connection).' : (e.message || String(e)))));
  });
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readManifestVersion(manifestPath) {
  try {
    const text = fs.readFileSync(manifestPath, 'utf8');
    const m = text.match(/ExtensionBundleVersion="([^"]+)"/);
    return m ? String(m[1]) : '';
  } catch (e) { return ''; }
}

function readInstalledVersion(installDir) {
  const v = readManifestVersion(path.join(installDir, 'CSXS', 'manifest.xml'));
  if (!v) throw new Error('Cannot read the installed version (CSXS/manifest.xml).');
  return v;
}

function parseVersion(v) {
  const m = String(v || '').match(/^(\d+)\.(\d+)\.(\d+)$/);
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)] : null;
}

function compareVersions(a, b) {
  const A = parseVersion(a), B = parseVersion(b);
  if (!A || !B) return null;
  for (let i = 0; i < 3; i++) { if (A[i] !== B[i]) return A[i] - B[i]; }
  return 0;
}

function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }

async function resolveRelease(opts, status) {
  // Offline/test release: an explicit version + zip + sha256 skips GitHub entirely.
  if (opts.version && opts.zip) {
    if (!fs.existsSync(opts.zip)) throw new Error('Test archive not found: ' + opts.zip);
    return { version: String(opts.version).replace(/^v/, ''), file: opts.zip, sha256: String(opts.sha256 || '').toLowerCase() };
  }
  const repo = String(opts.repo || DEFAULT_REPO);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('Invalid repository name for updates.');
  writeStatus(status, { state: 'checking' });
  let raw;
  try {
    raw = await get('https://api.github.com/repos/' + repo + '/releases/latest');
  } catch (e) {
    if (/HTTP 404/.test(e.message)) throw new Error('No published update yet: this repository has no GitHub release.');
    if (/HTTP 403/.test(e.message)) throw new Error('GitHub rate limit reached. Try again in a few minutes.');
    throw e;
  }
  const body = JSON.parse(raw.toString('utf8'));
  if (body && body.message) throw new Error('GitHub: ' + body.message);
  const tag = String(body.tag_name || '').replace(/^v/, '');
  if (!parseVersion(tag)) throw new Error('The latest release tag ("' + tag + '") is not a plain x.y.z version.');
  const asset = (body.assets || []).filter(a => a && /\.zip$/i.test(a.name || ''))[0];
  if (!asset) throw new Error('The latest release has no .zip asset to install.');
  const digest = String(asset.digest || '');
  if (!/^sha256:[0-9a-f]{64}$/i.test(digest)) throw new Error('The release asset has no SHA-256 digest; publish one before updating.');
  // Release notes double as the changelog shown in the panel's Updates section.
  // Prefer the release body (what changed) and fall back to its title.
  const noteBody = String(body.body || '').trim();
  const notes = noteBody ? noteBody.slice(0, 2000) : String(body.name || '').trim();
  return { version: tag, url: asset.browser_download_url, sha256: digest.slice(7).toLowerCase(), notes: notes };
}

function extract(zipPath, dest) {
  fs.mkdirSync(dest, { recursive: true });
  let r = spawnSync('tar', ['-xf', zipPath, '-C', dest], { windowsHide: true });
  if (r.status === 0) return;
  const q = s => "'" + String(s).replace(/'/g, "''") + "'";
  r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
    'Expand-Archive -LiteralPath ' + q(zipPath) + ' -DestinationPath ' + q(dest) + ' -Force'], { windowsHide: true });
  if (r.status !== 0) throw new Error('Could not unpack the update archive.');
}

function findStagedRoot(dir) {
  if (fs.existsSync(path.join(dir, 'CSXS', 'manifest.xml'))) return dir;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return null; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const cand = path.join(dir, entry.name);
    if (fs.existsSync(path.join(cand, 'CSXS', 'manifest.xml'))) return cand;
  }
  return null;
}

function runApplier(args) {
  // Runs to completion so the status file is written before this process exits.
  // Replacing our own .js here is safe: Node already loaded the module.
  const applier = path.join(os.tmpdir(), 'mockup-update-' + Date.now() + '.ps1');
  fs.writeFileSync(applier, APPLIER, 'utf8');
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', applier].concat(args), {
    windowsHide: true, encoding: 'utf8'
  });
  if (r.error) throw new Error('Could not start the update helper: ' + r.error.message);
  const detail = String(r.stderr || r.stdout || '').trim();
  if (r.status !== 0) throw new Error('The update helper failed' + (detail ? ': ' + detail.slice(0, 400) : ' (exit ' + r.status + ')'));
}

async function check(opts, status) {
  const current = readInstalledVersion(opts.install);
  writeStatus(status, { state: 'checking', current });
  const rel = await resolveRelease(opts, status);
  const c = compareVersions(rel.version, current);
  if (c === null) throw new Error('Cannot compare versions (installed ' + current + ', latest ' + rel.version + ').');
  if (c > 0) writeStatus(status, { state: 'available', current, latest: rel.version, notes: rel.notes || '' });
  else writeStatus(status, { state: 'uptodate', current, latest: rel.version, notes: rel.notes || '' });
}

async function apply(opts, status) {
  const current = readInstalledVersion(opts.install);
  const rel = await resolveRelease(opts, status);
  const c = compareVersions(rel.version, current);
  if (c === null) throw new Error('Cannot compare versions (installed ' + current + ', latest ' + rel.version + ').');
  if (c <= 0) { writeStatus(status, { state: 'uptodate', current, latest: rel.version }); return; }
  if (!rel.sha256) throw new Error('This release publishes no SHA-256 checksum; refusing to install unverified code.');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mockup-update-'));
  const zipPath = rel.file || path.join(tmp, 'release.zip');
  if (!rel.file) {
    writeStatus(status, { state: 'downloading', current, latest: rel.version });
    fs.writeFileSync(zipPath, await get(rel.url));
  }
  const digest = sha256File(zipPath);
  if (digest !== rel.sha256) throw new Error('Checksum mismatch (expected ' + rel.sha256.slice(0, 12) + '..., got ' + digest.slice(0, 12) + '...). The download was corrupted; nothing was changed.');

  writeStatus(status, { state: 'installing', current, latest: rel.version });
  const staging = path.join(tmp, 'staged');
  extract(zipPath, staging);
  const root = findStagedRoot(staging);
  if (!root) throw new Error('The archive does not contain CSXS/manifest.xml.');
  const stagedVersion = readManifestVersion(path.join(root, 'CSXS', 'manifest.xml'));
  if (stagedVersion !== rel.version) throw new Error('Archive reports version ' + stagedVersion + ' but the release is ' + rel.version + '.');
  for (const relPath of REQUIRED_FILES) {
    if (!fs.existsSync(path.join(root, relPath))) throw new Error('The archive is missing ' + relPath + '.');
  }
  const backup = path.join(opts.work, 'backups', current + '-' + stamp());
  writeStatus(status, { state: 'installing', current, latest: rel.version, backup });
  runApplier(['-Mode', 'apply', '-Source', root, '-Dest', opts.install, '-Backup', backup, '-Status', status, '-Version', rel.version, '-Previous', current]);
}

function restore(opts, status) {
  const backupsDir = path.join(opts.work, 'backups');
  let names = [];
  try {
    names = fs.readdirSync(backupsDir).filter(n => {
      try { return fs.statSync(path.join(backupsDir, n)).isDirectory(); } catch (e) { return false; }
    }).sort().reverse();
  } catch (e) { names = []; }
  if (!names.length) throw new Error('No previous version is backed up yet.');
  const src = path.join(backupsDir, names[0]);
  const version = readManifestVersion(path.join(src, 'CSXS', 'manifest.xml'));
  if (!version) throw new Error('The newest backup is incomplete (' + names[0] + ').');
  writeStatus(status, { state: 'installing', restoring: true, version });
  runApplier(['-Mode', 'restore', '-Source', src, '-Dest', opts.install, '-Status', status, '-Version', version]);
}

async function main() {
  const args = parseArgs(process.argv);
  const action = String(args.action || '').toLowerCase();
  if (['check', 'apply', 'restore'].indexOf(action) < 0) throw new Error('Usage: node update.js --action check|apply|restore --work <dir> --install <dir> --status <file>');
  const work = args.work || '';
  const install = args.install || path.resolve(__dirname, '..');
  const status = args.status || (work ? path.join(work, 'agent-update.json') : '');
  if (!work || !status) throw new Error('Missing --work/--status.');
  const opts = { action, work, install, status, repo: args.repo, version: args.version, zip: args.zip, sha256: args.sha256 };

  if (action === 'check') return check(opts, status);
  if (action === 'apply') return apply(opts, status);
  return restore(opts, status);
}

if (require.main === module) {
  main().catch(e => {
    const msg = e && e.message ? e.message : String(e);
    let args = {};
    try { args = parseArgs(process.argv); } catch (x) { }
    const work = args.work || '';
    const status = args.status || (work ? path.join(work, 'agent-update.json') : '');
    if (status) writeStatus(status, { state: 'error', message: msg });
    try { console.error('update failed: ' + msg); } catch (x) { }
    process.exit(1);
  });
}

module.exports = { compareVersions, parseVersion, readManifestVersion, APPLIER };
