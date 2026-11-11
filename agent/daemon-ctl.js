/* Compat entrypoint: host/agent.jsx launches this file. Requiring ctl.js does not run
   its CLI (require.main is this wrapper), so main() has to be called explicitly. */
const { main } = require('./daemon/ctl');
if (typeof main !== 'function') {
  console.error('daemon ctl main() not exported');
  process.exit(1);
}
main().catch(e => { console.error(e && e.message ? e.message : e); process.exit(1); });
