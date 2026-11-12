/* Saved vectorizer.ai login for copy & paste in the setup screen.
   The email is stored as-is (it is not a secret and should be copyable straight away);
   the password is encrypted with AES-GCM under a key derived from a passcode the user
   chooses, so reading it requires the passcode. The passcode itself is never stored.
   Only WebCrypto is used, no dependencies: CEP loads the panel from file://, which
   Chromium treats as a secure context. */
(function () {
  "use strict";
  var VB = window.VBPanel = window.VBPanel || {};
  var core = VB.core || (VB.core = {});
  var vault = VB.vault = VB.vault || {};

  var STORE = "vb_login_vault";
  var ITERATIONS = 200000;
  var MIN_PASSCODE = 4;

  var secret = null;   // { password: "..." } while unlocked, memory only
  var editing = false;
  var busy = false;

  function $(id) { return document.getElementById(id); }
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

  /* PBKDF2-SHA256 -> AES-GCM 256. The salt is random per save, so two users with the
     same passcode never share a key. */
  function deriveKey(passcode, salt) {
    var enc = new TextEncoder();
    return window.crypto.subtle.importKey("raw", enc.encode(passcode), "PBKDF2", false, ["deriveKey"])
      .then(function (base) {
        return window.crypto.subtle.deriveKey(
          { name: "PBKDF2", salt: salt, iterations: ITERATIONS, hash: "SHA-256" },
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
    return deriveKey(passcode, salt).then(function (key) {
      return window.crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, new TextEncoder().encode(password));
    }).then(function (ct) {
      return { salt: b64(salt), iv: b64(iv), ct: b64(ct) };
    });
  }

  function decryptPassword(passcode, data) {
    return deriveKey(passcode, unb64(data.salt)).then(function (key) {
      return window.crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(data.iv) }, key, unb64(data.ct));
    }).then(function (plain) { return new TextDecoder().decode(plain); });
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
      msg((core.t("vaultPassShort") || "Use at least 4 characters."), true);
      return;
    }
    var has = !!readStore();
    if (!has && passcode !== confirm) {
      msg(core.t("vaultPassMismatch") || "The passcodes do not match.", true);
      return;
    }
    busy = true;
    encryptPassword(passcode, password).then(function (blob) {
      var ok = writeStore({ v: 1, email: email, salt: blob.salt, iv: blob.iv, ct: blob.ct });
      busy = false;
      if (!ok) {
        msg(core.t("vaultStoreFailed") || "Could not save: panel storage is disabled.", true);
        return;
      }
      // Deliberately stay locked after saving: the passcode is what gates the password, so
      // even the person who just typed it has to enter the passcode to read it back.
      secret = null;
      editing = false;
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
    var passcode = ($("vaultPasscode") || {}).value || "";
    if (!passcode) {
      msg(core.t("vaultNeedPasscode") || "Type the passcode to unlock the password.", true);
      return;
    }
    if (busy) return;
    busy = true;
    decryptPassword(passcode, data).then(function (password) {
      busy = false;
      secret = { password: password };
      var input = $("vaultPasscode");
      if (input) input.value = "";
      render();
      msg(core.t("vaultUnlockOk") || "Unlocked for this session.", false);
    }, function () {
      busy = false;
      // AES-GCM authenticates, so a wrong passcode and a tampered blob look the same.
      msg(core.t("vaultWrong") || "Wrong passcode.", true);
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
