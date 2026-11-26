const fs = require('fs');
const path = require('path');
const os = require('os');

const baseDir = path.join(__dirname, '..');
const checks = [];

function check(name, fn) {
  try {
    const result = fn();
    checks.push({ name, ok: result.ok, detail: result.detail });
    console.log(`  ${result.ok ? '✓' : '✗'} ${name}${result.detail ? ' — ' + result.detail : ''}`);
    return result.ok;
  } catch (e) {
    checks.push({ name, ok: false, detail: String(e) });
    console.log(`  ✗ ${name} — ${e}`);
    return false;
  }
}

console.log('\n=== Mockup Studio Flow PoC Verification ===\n');

check('Node.js available', () => ({ ok: true, detail: process.version }));
check('chokidar installed', () => {
  const pkgPath = path.join(baseDir, 'agent', 'node_modules', 'chokidar', 'package.json');
  return { ok: fs.existsSync(pkgPath), detail: pkgPath };
});

const bridgeFolder = path.join(os.homedir(), 'Documents', 'VectorizerBridge');
check('Bridge folder exists', () => ({ ok: fs.existsSync(bridgeFolder), detail: bridgeFolder }));
check('flow-status folder writable', () => {
  const f = path.join(bridgeFolder, 'flow-status');
  if (!fs.existsSync(f)) fs.mkdirSync(f, { recursive: true });
  const test = path.join(f, '.write-test');
  try { fs.writeFileSync(test, 'test'); fs.unlinkSync(test); return { ok: true, detail: f }; } catch (e) { return { ok: false, detail: e.message }; }
});
check('flow-temp folder writable', () => {
  const f = path.join(bridgeFolder, 'flow-temp');
  if (!fs.existsSync(f)) fs.mkdirSync(f, { recursive: true });
  const test = path.join(f, '.write-test');
  try { fs.writeFileSync(test, 'test'); fs.unlinkSync(test); return { ok: true, detail: f }; } catch (e) { return { ok: false, detail: e.message }; }
});

const downloadFolder = path.join(os.homedir(), 'Downloads', 'MockupStudioFlow');
check('Download folder exists', () => ({ ok: fs.existsSync(downloadFolder), detail: downloadFolder + (fs.existsSync(downloadFolder) ? '' : ' (will be created on first download)') }));

const manifestPath = path.join(baseDir, 'agent', 'native-messaging-manifest.json');
check('Native messaging manifest exists', () => ({ ok: fs.existsSync(manifestPath), detail: manifestPath }));

const batPath = path.join(baseDir, 'agent', 'flow-bridge.bat');
check('Native host batch wrapper exists', () => ({ ok: fs.existsSync(batPath), detail: batPath }));

const agentScript = path.join(baseDir, 'agent', 'flow-bridge.js');
check('Agent script exists', () => ({ ok: fs.existsSync(agentScript), detail: agentScript }));

const extensionManifest = path.join(baseDir, 'extension', 'manifest.json');
check('Chrome extension manifest exists', () => ({ ok: fs.existsSync(extensionManifest), detail: extensionManifest }));

const uiPackage = path.join(baseDir, 'ui', 'package.json');
check('UI package.json exists', () => ({ ok: fs.existsSync(uiPackage), detail: uiPackage }));

const flowImport = path.join(baseDir, 'host', 'flow-import.jsx');
check('Flow import ExtendScript exists', () => ({ ok: fs.existsSync(flowImport), detail: flowImport }));

// Check registry (Windows)
if (process.platform === 'win32') {
  const { execSync } = require('child_process');
  try {
    const reg = execSync('reg query "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.bestofgifts.mockupstudio.flow" /ve', { encoding: 'utf8', stdio: 'pipe' });
    check('Native messaging host registered', () => ({ ok: reg.includes('native-messaging-manifest.json'), detail: 'Registry entry found' }));
  } catch {
    check('Native messaging host registered', () => ({ ok: false, detail: 'Run install-native-host.ps1 as Administrator' }));
  }
}

console.log('\n=== Summary ===');
const passed = checks.filter(c => c.ok).length;
const total = checks.length;
console.log(`${passed}/${total} checks passed`);

if (passed === total) {
  console.log('\n✓ All checks passed. PoC ready to test.');
  process.exit(0);
} else {
  console.log('\n✗ Some checks failed. Fix before testing.');
  process.exit(1);
}