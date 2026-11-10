(function () {
  "use strict";
  var VB = window.VBPanel = window.VBPanel || {};
  var core = VB.core || (VB.core = {});
  var bridge = VB.bridge = VB.bridge || {};

  var cs = null;
  bridge.hostOk = false;

  function getCS() { return cs; }
  function setCS(v) { cs = v; }

  function logToHost(message) {
    try {
      if (!cs || !bridge.hostOk) return;
      cs.evalScript("$.global.VB.log(" + core.jsxString(String(message)) + ")");
    } catch (e) { }
  }

  function evalJsx(script, callback) {
    if (!cs) {
      if (callback) callback("EvalScript error: CSInterface unavailable");
      return;
    }
    try {
      cs.evalScript(script, function (result) {
        if (callback) callback(result);
      });
    } catch (e) {
      if (callback) callback("EvalScript error: " + e);
    }
  }

  function parseResult(result) {
    var text = String(result || "");
    if (!text || text.indexOf("EvalScript error") === 0) {
      return { ok: false, error: "badResponse", raw: text };
    }
    try {
      return JSON.parse(text);
    } catch (e) {
      return { ok: false, error: "badResponse", raw: text };
    }
  }

  function friendlyError(code) {
    switch (String(code || "")) {
      case "noDocument": return core.t("errorNoDocument");
      case "noSelection": return core.t("errorNoSelection");
      case "emptyBounds": return core.t("errorEmptyBounds");
      case "duplicateFailed": return core.t("errorDuplicateFailed");
      case "artboardFailed": return core.t("errorArtboardFailed");
      case "exportFailed": return core.t("errorExportFailed");
      case "documentLocked": return core.t("errorDocumentLocked");
      case "layerLocked": return core.t("errorLayerLocked");
      case "fileNotFound": return core.t("errorFileNotFound");
      case "fileUnreadable": return core.t("errorFileUnreadable");
      case "badSvgFile": return core.t("errorBadSvgFile");
      case "badBounds": return core.t("errorBadBounds");
      case "placeFailed": return core.t("errorPlaceFailed");
      case "docChanged": return core.t("errorDocChanged");
      case "svgImportFailed": return core.t("errorSvgImportFailed");
      case "noAgent": return core.t("errorNoAgent");
      default: return String(code || "unknown error");
    }
  }

  function loadHost(callback) {
    var ext = "";
    try {
      ext = cs.getSystemPath(SystemPath.EXTENSION);
    } catch (e) {
      callback("SystemPath.EXTENSION failed: " + e);
      return;
    }
    if (!ext) { callback("Extension path is empty"); return; }
    ext = String(ext).replace(/\\/g, "/");
    // Modular host load order: json -> core (shared) -> batch -> export -> place -> agent.
    // common.jsx/import.jsx kept for compatibility; core.jsx/place.jsx are canonical splits.
    var loader =
      "$.evalFile(new File(" + core.jsxString(ext + "/host/json.jsx") + "));" +
      "$.evalFile(new File(" + core.jsxString(ext + "/host/core.jsx") + "));" +
      "$.evalFile(new File(" + core.jsxString(ext + "/host/batch.jsx") + "));" +
      "$.evalFile(new File(" + core.jsxString(ext + "/host/export.jsx") + "));" +
      "$.evalFile(new File(" + core.jsxString(ext + "/host/place.jsx") + "));" +
      "$.evalFile(new File(" + core.jsxString(ext + "/host/agent.jsx") + "));" +
      "$.global.VB.extensionPath = " + core.jsxString(ext) + ";" +
      "$.global.VB.ping();";
    evalJsx(loader, callback);
  }

  function openLogFolder() {
    if (!bridge.hostOk) return;
    evalJsx('VB.openFolder(VB.getBridgeFolderPath())');
  }
  function openSvgsFolder() {
    if (!bridge.hostOk) return;
    evalJsx('VB.openFolder(VB.getBridgeFolderPath() + "/agent-downloads")');
  }

  function getLocalVersion(callback) {
    evalJsx('VB.getExtensionVersion()', function (res) {
      var v = String(res || '').replace(/^"|"$/g, '');
      if (callback) callback(v || (core.APP_VERSION_FALLBACK || '2.2.0'));
    });
  }
  function getPendingUpdate(callback) {
    evalJsx('VB.getPendingUpdateInfo()', function (res) {
      var r = parseResult(res);
      if (callback) callback(r);
    });
  }
  function stageUpdate(version, callback) {
    var url = 'https://github.com/ggmbrinde-stack/mockup-studio/archive/refs/heads/main.zip';
    evalJsx('VB.stageUpdate(' + core.jsxString(url) + ',' + core.jsxString(version || '') + ')', function (res) {
      var r = parseResult(res);
      if (callback) callback(r);
    });
  }
  function applyPendingUpdate(callback) {
    evalJsx('VB.applyPendingUpdate()', function (res) {
      var r = parseResult(res);
      if (callback) callback(r);
    });
  }

  bridge.getCS = getCS; bridge.setCS = setCS;
  bridge.logToHost = logToHost; bridge.evalJsx = evalJsx; bridge.parseResult = parseResult; bridge.friendlyError = friendlyError;
  bridge.loadHost = loadHost; bridge.openLogFolder = openLogFolder; bridge.openSvgsFolder = openSvgsFolder;
  bridge.getLocalVersion = getLocalVersion; bridge.getPendingUpdate = getPendingUpdate; bridge.stageUpdate = stageUpdate; bridge.applyPendingUpdate = applyPendingUpdate;
})();
