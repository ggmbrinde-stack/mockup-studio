/* First-run setup for the panel.
   Shown once per CEP profile: language, a one-time sign-in to vectorizer.ai, and the
   three defaults that matter at the start (PNG size, hide original, warm Chrome).
   Everything it writes goes through the same settings object and handlers as Settings,
   so the two can never disagree. "Run setup again" in Settings reopens it. */
(function () {
  "use strict";
  var VB = window.VBPanel = window.VBPanel || {};
  var core = VB.core || (VB.core = {});
  var setup = VB.setup = VB.setup || {};

  var KEY = "vb_setup_done";
  var TOTAL = 3;
  var step = 1;

  function $(id) { return document.getElementById(id); }
  function overlayEl() { return $("setupOverlay"); }
  function isDone() { try { return localStorage.getItem(KEY) === "1"; } catch (e) { return true; } }
  function markDone() { try { localStorage.setItem(KEY, "1"); } catch (e) { } }
  function fire(el) {
    try { el.dispatchEvent(new Event("change", { bubbles: true })); }
    catch (e) { try { if (el.onchange) el.onchange(); } catch (e2) { } }
  }

  function showStep(n) {
    if (n < 1) n = 1;
    if (n > TOTAL) n = TOTAL;
    step = n;
    var steps = document.querySelectorAll("#setupOverlay [data-setup-step]");
    for (var i = 0; i < steps.length; i++) {
      var v = parseInt(steps[i].getAttribute("data-setup-step"), 10);
      steps[i].hidden = (v !== n);
    }
    var back = $("setupBackBtn");
    if (back) back.disabled = (n === 1);
    var next = $("setupNextBtn");
    if (next) next.textContent = (n === TOTAL) ? (core.t("setupFinish") || "Finish") : (core.t("setupNext") || "Next");
    var skip = $("setupSkipBtn");
    if (skip) skip.textContent = core.t("setupSkip") || "Skip setup";
    if (n === 2) startAutoSignIn();
  }

  /* Preconfigured installs (js/admin-config.js) sign in on their own. The manual button is
     always there as the fallback: a captcha, a changed password or no credentials at all
     lands the user on it with a one-line reason instead of a dead end. */
  var AUTO = { tried: false, busy: false, timer: null };

  function adminCfg() { return window.VBADMIN || {}; }

  function autoStatus(text) {
    var el = $("setupSignInStatus");
    if (el) el.textContent = text || "";
  }

  function autoFallback(reason) {
    AUTO.busy = false;
    var text = core.t("setupAutoFailed") || "Automatic sign-in did not work here. Use the button above to sign in once.";
    if (reason) text = text + " (" + reason + ")";
    autoStatus(text);
    var btn = $("setupSignInBtn");
    if (btn) btn.className = "btn small primary";
  }

  function pollAutoSignIn(attempt) {
    if (attempt > 120) { autoFallback("timeout"); return; }
    AUTO.timer = setTimeout(function () {
      if (!VB.bridge || !VB.bridge.hostOk) { autoFallback("no host"); return; }
      VB.bridge.evalJsx("VB.agentStatus('')", function (txt) {
        var st = null;
        try { st = JSON.parse(txt); } catch (e) { st = null; }
        var state = (st && st.state) ? String(st.state) : "";
        if (state === "done") {
          AUTO.busy = false;
          autoStatus(core.t("setupAutoOk") || "Signed in. Nothing else is needed.");
          return;
        }
        if (state === "loginRequired" || state === "error") {
          autoFallback(state === "error" && st && st.message ? String(st.message) : "");
          return;
        }
        pollAutoSignIn(attempt + 1);
      });
    }, 700);
  }

  function startAutoSignIn() {
    if (AUTO.tried || AUTO.busy) return;
    if (!adminCfg().autoSignIn || !VB.bridge || !VB.bridge.hostOk) return;
    AUTO.tried = true;
    AUTO.busy = true;
    autoStatus(core.t("setupAutoSignIn") || "Signing in with the studio account…");
    VB.bridge.evalJsx("VB.agentStart('autologin','')", function (started) {
      if (String(started || "").indexOf("started") !== 0) { autoFallback(String(started || "")); return; }
      pollAutoSignIn(0);
    });
  }

  function markLangButtons() {
    var buttons = document.querySelectorAll("#setupOverlay [data-setup-lang]");
    for (var i = 0; i < buttons.length; i++) {
      var on = buttons[i].getAttribute("data-setup-lang") === (core.state.lang || "en");
      buttons[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  /* Step 3 starts from what is stored, so reopening the wizard never silently resets
     a preference the user already changed in Settings. */
  function syncFromControlsToSettings(apply) {
    var s = core.state.settings;
    var preset = $("setupPngPreset");
    if (!apply) {
      if (preset) {
        var v = parseInt(s.pngLongSide, 10);
        preset.value = (v === 1200 || v === 1700 || v === 2400 || v === 0) ? String(v) : "1700";
      }
      var hide0 = $("setupHideOriginal"); if (hide0) hide0.checked = !!s.hideOriginal;
      var warm0 = $("setupWarmDaemon"); if (warm0) warm0.checked = !!s.warmDaemon;
      return;
    }
    var wasWarm = !!s.warmDaemon;
    if (preset) {
      var pv = parseInt(preset.value, 10);
      if (isFinite(pv)) s.pngLongSide = pv;
    }
    var hide = $("setupHideOriginal"); if (hide) s.hideOriginal = !!hide.checked;
    var warm = $("setupWarmDaemon"); if (warm) s.warmDaemon = !!warm.checked;
    core.saveSettings();
    core.applySettingsToUI();
    // Reuse the Settings handler: it starts/stops the warm Chrome (or leaves it alone).
    if (!!s.warmDaemon !== wasWarm) {
      var warmBox = $("settingsWarmDaemon");
      if (warmBox) { warmBox.checked = !!s.warmDaemon; fire(warmBox); }
    }
  }

  function open() {
    var o = overlayEl();
    if (!o) return;
    syncFromControlsToSettings(false);
    markLangButtons();
    o.hidden = false;
    showStep(1);
    var signInStatus = $("setupSignInStatus");
    if (signInStatus) signInStatus.textContent = "";
  }

  function close() {
    var o = overlayEl();
    if (o) o.hidden = true;
  }

  function finish() {
    syncFromControlsToSettings(true);
    markDone();
    close();
    core.log(core.t("setupDoneLog") || "Setup finished.");
    core.setStatus(core.t("statusReady"));
    try { core.events.emit("setup:finished", {}); } catch (e) { }
  }

  function skip() {
    markDone();
    close();
    core.log("Setup skipped.");
  }

  function setLang(lang) {
    if (lang !== "en" && lang !== "pt") return;
    core.state.lang = lang;
    core.saveSettings();
    core.renderLocale();
    markLangButtons();
    showStep(step);
  }

  function startSignIn() {
    var status = $("setupSignInStatus");
    if (!VB.bridge || !VB.bridge.hostOk) {
      if (status) status.textContent = core.t("errorHost");
      return;
    }
    var btn = $("signInBtn");
    if (btn) btn.click();
    if (status) status.textContent = core.t("setupSignInStatus") || "";
  }

  function bind() {
    var next = $("setupNextBtn");
    if (next) core.on(next, "click", function () { if (step >= TOTAL) finish(); else showStep(step + 1); });
    var back = $("setupBackBtn");
    if (back) core.on(back, "click", function () { showStep(step - 1); });
    var skipBtn = $("setupSkipBtn");
    if (skipBtn) core.on(skipBtn, "click", skip);
    var signInBtn = $("setupSignInBtn");
    if (signInBtn) core.on(signInBtn, "click", startSignIn);
    var again = $("setupAgainBtn");
    if (again) core.on(again, "click", open);

    var langs = document.querySelectorAll("#setupOverlay [data-setup-lang]");
    for (var i = 0; i < langs.length; i++) {
      (function (el) {
        core.on(el, "click", function () { setLang(el.getAttribute("data-setup-lang")); });
      })(langs[i]);
    }

    document.addEventListener("keydown", function (ev) {
      var o = overlayEl();
      if (!o || o.hidden) return;
      if (ev.key === "Escape") { ev.preventDefault(); skip(); }
    }, true);
  }

  function boot() {
    bind();
    if (isDone()) return;
    // A configured install skips the card completely: its defaults are already applied.
    if (adminCfg().skipWizard) { markDone(); return; }
    // Let panel.js finish its own boot (locale text, host bridge) before covering it.
    setTimeout(open, 200);
  }

  setup.open = open;
  setup.finish = finish;
  setup.isDone = isDone;
  setup.reset = function () { try { localStorage.removeItem(KEY); } catch (e) { } };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, false);
  else boot();
})();
