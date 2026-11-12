/* Checks the agent's stale-profile-lock cleanup, which is what turns a killed
   Chrome into a working one again without deleting the profile by hand.
   Run: node tools/verify-agent-lib.cjs */
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { clearStaleBrowserLock } = require('../agent/core/lib');

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log('  ok   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + ' -> ' + e.message); }
}

function profileWithPort(port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-lock-'));
  fs.writeFileSync(path.join(dir, 'DevToolsActivePort'), String(port) + '\n/devtools/browser/dead\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'lockfile'), '', 'utf8');
  return dir;
}

(async () => {
  console.log('agent lib:');

  await check('a port nobody listens on is treated as stale and cleared', async () => {
    const dir = profileWithPort(1); // reserved, nothing listens there
    const cleared = await clearStaleBrowserLock(dir);
    assert.strictEqual(cleared, true);
    assert.strictEqual(fs.existsSync(path.join(dir, 'DevToolsActivePort')), false);
    assert.strictEqual(fs.existsSync(path.join(dir, 'lockfile')), false);
  });

  await check('a live browser is left untouched', async () => {
    const server = net.createServer(() => {});
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const dir = profileWithPort(port);
    try {
      const cleared = await clearStaleBrowserLock(dir);
      assert.strictEqual(cleared, false);
      assert.strictEqual(fs.existsSync(path.join(dir, 'DevToolsActivePort')), true);
    } finally {
      await new Promise(r => server.close(r));
    }
  });

  await check('a profile with no port file is a no-op', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-lock2-'));
    assert.strictEqual(await clearStaleBrowserLock(dir), false);
  });

  console.log(failures ? '\n' + failures + ' check(s) failed' : '\nAll agent-lib checks passed');
  process.exit(failures ? 1 : 0);
})();
