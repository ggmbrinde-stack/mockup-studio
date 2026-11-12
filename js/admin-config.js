/* Admin configuration ------------------------------------------------------
   Everything an installer can pre-set for each new user lives here. Edit this
   file, ship it inside the release, and a fresh install starts with these
   values instead of asking the user.

   The same file is read by the agent for automatic sign-in, so it must stay a
   plain `window.VBADMIN = { ... };` statement with valid JSON inside.

   defaults        what Settings starts with on a fresh install. A value the
                   user later changes in Settings is stored locally and wins
                   from then on; values they never touch keep following this
                   file after an update.
   skipWizard      true = never show the first-run setup card.
   autoSignIn      true = try the studio account before offering the manual
                   sign-in button. Requires credentialsUrl or credentialsFile.
   credentialsUrl  HTTPS address of a JSON file:
                     { "email": "studio@example.com", "password": "..." }
                   Keep it somewhere only you control; it is not in this repo.
   credentialsFile a local path to that JSON, for testing on your own machine.
                   Takes precedence over credentialsUrl.

   Note: whatever this file points at is readable by anyone who installs the
   panel, and one account used from many computers at once can look like abuse
   to vectorizer.ai. Prefer a dedicated account you can rotate.
*/
window.VBADMIN = {
  skipWizard: false,
  autoSignIn: false,
  credentialsUrl: "",
  credentialsFile: "",

  defaults: {
    lang: "en",
    pngLongSide: 1700,
    hideOriginal: false,
    warmDaemon: true,
    batchWorkers: 2
  }
};
