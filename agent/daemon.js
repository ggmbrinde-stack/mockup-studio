/* Stable entrypoint: agent/daemon.js -> agent/daemon/server.js
   server.js only runs itself when it is the main module (daemon/ctl.js spawns it
   that way), so this wrapper has to call main() itself. */
const server = require('./daemon/server');

server.main().catch((e) => {
  try { console.error(e && e.stack ? e.stack : e); } catch (e2) {}
  process.exit(1);
});
