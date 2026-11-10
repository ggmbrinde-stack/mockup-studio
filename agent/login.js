/* One-time sign-in helper.
   Opens a normal, visible Chrome window on vectorizer.ai using the same
   persistent profile the headless agent will use. The user signs in, closes the
   window, and the session (cookies) stays in Documents\VectorizerBridge\vectorizer-profile.

   The window is a plain Chrome process, not an automated one: with the
   automation build the browser window could come up without ever becoming
   visible (only its popups showed), which looked like an all-black sign-in page.

   Usage: node login.js --profile <dir> --status <file> */

const { spawn } = require('child_process');
const fs = require('fs');
const { writeStatus, fail, parseArgs, findBrowser, sanitizeProfile, signInArgs } = require('./lib');

const SIGN_IN_LIMIT_MS = 20 * 60 * 1000;

function main() {
  const args = parseArgs(process.argv);
  const profile = args.profile;
  const statusPath = args.status;

  if (!profile || !statusPath) throw new Error('missing --profile or --status');

  const executablePath = findBrowser();
  if (!executablePath) throw new Error('Chrome or Edge was not found');

  writeStatus(statusPath, { state: 'loginWindow' });
  sanitizeProfile(profile);
  try { fs.mkdirSync(profile, { recursive: true }); } catch (e) { }

  // App window by default; the Install-app flow asks for a normal tab, because
  // Chrome only shows its install UI there.
  const appWindow = String(args.window || 'app') !== 'tab';
  const child = spawn(executablePath, signInArgs({ profile, appWindow }), {
    detached: true,
    stdio: 'ignore'
  });

  let settled = false;
  function done(state) {
    if (settled) return;
    settled = true;
    writeStatus(statusPath, { state: state, browserPid: child.pid });
    process.exit(0);
  }

  child.on('error', (e) => {
    if (settled) return;
    settled = true;
    fail(statusPath, 'Could not start Chrome: ' + e.message);
    process.exit(1);
  });

  child.on('exit', () => done('loginClosed'));
  child.unref();

  // The window has no automation channel, so its pid is what the panel uses to
  // close it on Cancel. Keep this process alive only to notice the window exit.
  writeStatus(statusPath, { state: 'loginOpen', browserPid: child.pid });
  setTimeout(() => done('loginClosed'), SIGN_IN_LIMIT_MS);
}

try {
  main();
} catch (e) {
  const args = parseArgs(process.argv);
  if (args.status) fail(args.status, e && e.message ? e.message : e);
  else console.error(e && e.message ? e.message : String(e));
  process.exit(1);
}
