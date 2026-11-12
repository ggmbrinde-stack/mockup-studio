/* Saved vectorizer.ai login for copy & paste in the setup screen.
   The email is stored as-is (it is not a secret and should be copyable straight away);
   the password is encrypted with AES-GCM under a key derived from a passcode the user
   chooses, so reading it requires the passcode. The passcode itself is never stored.

   The passcode never leaves this panel: it is typed here, stretched with PBKDF2 and used
   to open the blob. Repeated wrong passcodes are throttled, and the throttle survives a
   panel reload, so guessing at the keyboard is slow as well as offline guessing.

   Only WebCrypto is used, no dependencies: CEP loads the panel from file://, which
   Chromium treats as a secure context. */
(function () {
  "use strict";
  var VB = window.VBPanel = window.VBPanel || {};
  var core = VB.core || (VB.core = {});
  var vault = VB.vault = VB.vault || {};

  var STORE = "vb_login_vault";
  var GUARD = "vb_login_vault_guard";
  var ITERATIONS = 600000;     // stored per blob, so raising it later keeps old saves readable
  var LEGACY_ITERATIONS = 200000;
  var MIN_PASSCODE = 8;
  var FREE_TRIES = 3;          // wrong passcodes before a wait
  var BASE_WAIT = 5;           // seconds for the first wait, doubling up to MAX_WAIT
  var MAX_WAIT = 300;

  var secret = null;   // { password: "..." } while unlocked, memory only
  var editing = false;
  var busy = false;
  var ticker = null;

  function $(id) { return document.getElementById(id); }
  function fmt(key, vars) {
    var s = core.t(key) || "";
    for (var k in vars) if (vars.hasOwnProperty(k)) s = s.replace("{" + k + "}", String(vars[k]));
    return s;
  }
  function msg(text, bad) {
    var el = $("vaultMsg");
    if (!el) return;
    el.textContent = text || "";
    el.className = "hint vaultMsg" + (text ? (bad ? " bad" : " ok") : "");
  }

  function b64(buf) {
    var bytes = new Uint8Array(buf);
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function unb64(str) {
    var raw = atob(str);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }

  function cryptoOk() { return !!(window.crypto && window.crypto.subtle && window.crypto.getRandomValues); }

  function readStore() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || data.v !== 1 || !data.ct || !data.salt || !data.iv) return null;
      return data;
    } catch (e) { return null; }
  }

  function writeStore(data) {
    try { localStorage.setItem(STORE, JSON.stringify(data)); return true; }
    catch (e) { return false; }
  }

  /* Wrong-passcode throttle, persisted so closing the panel does not reset it. */
  function readGuard() {
    try {
      var d = JSON.parse(localStorage.getItem(GUARD) || "null");
      if (!d || typeof d !== "object") return { fail: 0, until: 0 };
      return { fail: parseInt(d.fail, 10) || 0, until: parseInt(d.until, 10) || 0 };
    } catch (e) { return { fail: 0, until: 0 }; }
  }
  function writeGuard(g) {
    try { localStorage.setItem(GUARD, JSON.stringify(g)); } catch (e) { }
  }
  function clearGuard() {
    try { localStorage.removeItem(GUARD); } catch (e) { }
  }
  function waitSeconds(g) {
    return Math.max(0, Math.ceil((g.until - Date.now()) / 1000));
  }

  /* PBKDF2-SHA256 -> AES-GCM 256. The salt is random per save, so two users with the
     same passcode never share a key. */
  function deriveKey(passcode, salt, iterations) {
    var enc = new TextEncoder();
    return window.crypto.subtle.importKey("raw", enc.encode(passcode), "PBKDF2", false, ["deriveKey"])
      .then(function (base) {
        return window.crypto.subtle.deriveKey(
          { name: "PBKDF2", salt: salt, iterations: iterations, hash: "SHA-256" },
          base,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"]
        );
      });
  }

  function encryptPassword(passcode, password) {
    var salt = window.crypto.getRandomValues(new Uint8Array(16));
    var iv = window.crypto.getRandomValues(new Uint8Array(12));
    return deriveKey(passcode, salt, ITERATIONS).then(function (key) {
      return window.crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, new TextEncoder().encode(password));
    }).then(function (ct) {
      return { salt: b64(salt), iv: b64(iv), ct: b64(ct), iter: ITERATIONS };
    });
  }

  function decryptPassword(passcode, data) {
    var iterations = parseInt(data.iter, 10) || LEGACY_ITERATIONS;
    return deriveKey(passcode, unb64(data.salt), iterations).then(function (key) {
      return window.crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(data.iv) }, key, unb64(data.ct));
    }).then(function (plain) { return new TextDecoder().decode(plain); });
  }

  /* While a wait is running the unlock controls stay disabled and count down, so the
     throttle is visible instead of just a message that can be ignored. */
  function stopTicker() {
    if (ticker) { clearInterval(ticker); ticker = null; }
  }
  function applyCooldown() {
    var btn = $("vaultUnlockBtn");
    var input = $("vaultPasscode");
    var g = readGuard();
    var left = waitSeconds(g);
    if (left <= 0) {
      stopTicker();
      if (btn) { btn.disabled = false; btn.textContent = core.t("vaultUnlock") || "Unlock"; }
      if (input) input.disabled = false;
      return false;
    }
    if (btn) { btn.disabled = true; btn.textContent = fmt("vaultWaitBtn", { seconds: left }); }
    if (input) input.disabled = true;
    if (!ticker) {
      ticker = setInterval(function () {
        if (waitSeconds(readGuard()) <= 0) { stopTicker(); applyCooldown(); render(); }
        else applyCooldown();
      }, 500);
    }
    return true;
  }

  function render() {
    var data = readStore();
    var saved = $("vaultSaved");
    var edit = $("vaultEdit");
    var badge = $("vaultBadge");
    var unlockRow = $("vaultUnlockRow");
    var passVal = $("vaultSavedPass");
    var emailVal = $("vaultSavedEmail");
    if (!saved || !edit) return;

    var has = !!data;
    saved.hidden = !has || editing;
    edit.hidden = has && !editing;

    if (badge) {
      badge.hidden = !has || editing;
      badge.textContent = secret ? (core.t("vaultUnlocked") || "Unlocked") : (core.t("vaultLocked") || "Locked");
      badge.className = "vaultBadge" + (secret ? " on" : "");
    }
    if (has) {
      if (emailVal) emailVal.textContent = data.email || "";
      if (passVal) {
        passVal.textContent = secret ? secret.password : "••••••••••••";
        passVal.className = "vaultValue mono" + (secret ? " revealed" : "");
      }
    }
    if (unlockRow) unlockRow.hidden = !has || editing || !!secret;
    var lockBtn = $("vaultLockBtn");
    if (lockBtn) lockBtn.hidden = !secret;
    var changeBtn = $("vaultChangeBtn");
    if (changeBtn) changeBtn.hidden = !has || editing;
    var cancelBtn = $("vaultCancelBtn");
    if (cancelBtn) cancelBtn.hidden = !has || !editing;
    var saveBtn = $("vaultSaveBtn");
    if (saveBtn) saveBtn.textContent = core.t(has ? "vaultSaveNew" : "vaultSave") || (has ? "Save new login" : "Save login");
    var confirm = $("vaultConfirmField");
    if (confirm) confirm.hidden = !!has;   // only a brand new passcode is repeated
    var passSet = $("vaultPassSet");
    if (passSet) passSet.placeholder = core.t(has ? "vaultPasscodeChange" : "vaultPasscodePlaceholder") || "";
    var copyPass = $("vaultCopyPassBtn");
    if (copyPass) copyPass.disabled = !has;
    if (!secret && unlockRow && !unlockRow.hidden) applyCooldown();
    if (!cryptoOk() && !has) {
      msg(core.t("vaultUnavailable") || "This panel cannot store a login securely (no WebCrypto).", true);
    }
  }

  /* Clipboard: the async API when present, otherwise a hidden textarea, which CEP's
     Chromium still accepts from a click handler. */
  function copy(text, okKey) {
    function done() { msg(core.t(okKey) || "Copied.", false); }
    function fallback() {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-1000px";
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (ok) done();
        else msg(core.t("vaultCopyFailed") || "Could not copy. Select the text and press Ctrl+C.", true);
      } catch (e) {
        msg(core.t("vaultCopyFailed") || "Could not copy. Select the text and press Ctrl+C.", true);
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else fallback();
  }

  function save() {
    if (busy) return;
    if (!cryptoOk()) {
      msg(core.t("vaultUnavailable") || "This panel cannot store a login securely (no WebCrypto).", true);
      return;
    }
    var email = ($("vaultEmailInput") || {}).value || "";
    var password = ($("vaultPassInput") || {}).value || "";
    var passcode = ($("vaultPassSet") || {}).value || "";
    var confirm = ($("vaultPassConfirm") || {}).value || "";
    email = email.replace(/^\s+|\s+$/g, "");
    if (!email || !password) {
      msg(core.t("vaultNeedBoth") || "Fill in the email and the password.", true);
      return;
    }
    if (passcode.length < MIN_PASSCODE) {
      msg(fmt("vaultPassShort", { min: MIN_PASSCODE }), true);
      return;
    }
    var has = !!readStore();
    if (!has && passcode !== confirm) {
      msg(core.t("vaultPassMismatch") || "The passcodes do not match.", true);
      return;
    }
    busy = true;
    encryptPassword(passcode, password).then(function (blob) {
      var ok = writeStore({ v: 1, email: email, salt: blob.salt, iv: blob.iv, ct: blob.ct, iter: blob.iter });
      busy = false;
      if (!ok) {
        msg(core.t("vaultStoreFailed") || "Could not save: panel storage is disabled.", true);
        return;
      }
      // Deliberately stay locked after saving: the passcode is what gates the password, so
      // even the person who just typed it has to enter the passcode to read it back.
      secret = null;
      editing = false;
      clearGuard();
      clearInputs();
      render();
      msg(core.t("vaultSavedMsg") || "Login saved. The password stays locked until you type the passcode.", false);
    }, function () {
      busy = false;
      msg(core.t("vaultStoreFailed") || "Could not save: panel storage is disabled.", true);
    });
  }

  function unlock() {
    var data = readStore();
    if (!data) return;
    var guard = readGuard();
    var left = waitSeconds(guard);
    if (left > 0) {
      msg(fmt("vaultCool", { seconds: left }), true);
      applyCooldown();
      return;
    }
    var passcode = ($("vaultPasscode") || {}).value || "";
    if (!passcode) {
      msg(core.t("vaultNeedPasscode") || "Type the passcode to unlock the password.", true);
      return;
    }
    if (busy) return;
    busy = true;
    decryptPassword(passcode, data).then(function (password) {
      busy = false;
      clearGuard();
      secret = { password: password };
      var input = $("vaultPasscode");
      if (input) input.value = "";
      render();
      msg(core.t("vaultUnlockOk") || "Unlocked for this session.", false);
    }, function () {
      busy = false;
      // AES-GCM authenticates, so a wrong passcode and a tampered blob look the same.
      var g = readGuard();
      g.fail = (g.fail || 0) + 1;
      if (g.fail >= FREE_TRIES) {
        var wait = Math.min(MAX_WAIT, BASE_WAIT * Math.pow(2, g.fail - FREE_TRIES));
        g.until = Date.now() + wait * 1000;
        writeGuard(g);
        var input = $("vaultPasscode");
        if (input) input.value = "";
        applyCooldown();
        msg(fmt("vaultCool", { seconds: waitSeconds(g) }), true);
        return;
      }
      writeGuard(g);
      msg(fmt("vaultWrongLeft", { tries: FREE_TRIES - g.fail, s: (FREE_TRIES - g.fail) === 1 ? "" : "s" }), true);
    });
  }

  function lock(silent) {
    secret = null;
    var input = $("vaultPasscode");
    if (input) input.value = "";
    render();
    if (!silent) msg(core.t("vaultLockedMsg") || "Password locked.", false);
  }

  function forget() {
    try { localStorage.removeItem(STORE); } catch (e) { }
    secret = null;
    editing = false;
    clearGuard();
    clearInputs();
    render();
    msg(core.t("vaultForgot") || "Saved login deleted.", false);
  }

  function clearInputs() {
    var ids = ["vaultEmailInput", "vaultPassInput", "vaultPassSet", "vaultPassConfirm", "vaultPasscode"];
    for (var i = 0; i < ids.length; i++) {
      var el = $(ids[i]);
      if (el) el.value = "";
    }
  }

  function startEdit() {
    var data = readStore();
    editing = true;
    var email = $("vaultEmailInput");
    if (email && data) email.value = data.email || "";
    var pass = $("vaultPassInput");
    if (pass) pass.value = "";
    var set = $("vaultPassSet");
    if (set) set.value = "";
    render();
    msg("");
  }

  function cancelEdit() {
    editing = false;
    clearInputs();
    render();
    msg("");
  }

  function copyEmail() {
    var data = readStore();
    if (!data || !data.email) return;
    copy(data.email, "vaultEmailCopied");
  }

  function copyPassword() {
    if (!secret) {
      var input = $("vaultPasscode");
      if (input) input.focus();
      msg(core.t("vaultNeedPasscode") || "Type the passcode to unlock the password.", true);
      return;
    }
    copy(secret.password, "vaultPassCopied");
  }

  function bind() {
    var pairs = [
      ["vaultSaveBtn", save],
      ["vaultCancelBtn", cancelEdit],
      ["vaultUnlockBtn", unlock],
      ["vaultLockBtn", function () { lock(false); }],
      ["vaultChangeBtn", startEdit],
      ["vaultForgetBtn", forget],
      ["vaultCopyEmailBtn", copyEmail],
      ["vaultCopyPassBtn", copyPassword]
    ];
    for (var i = 0; i < pairs.length; i++) core.on($(pairs[i][0]), "click", pairs[i][1]);
    core.on($("vaultPasscode"), "keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); unlock(); }
    });
    core.on($("vaultPassConfirm"), "keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); save(); }
    });
  }

  function boot() {
    if (!$("vaultBox")) return;
    bind();
    render();
  }

  vault.refresh = function () { editing = false; clearInputs(); msg(""); render(); };
  vault.lock = function () { lock(true); };
  vault.hasLogin = function () { return !!readStore(); };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, false);
  else boot();
})();
