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
    // Each file is isolated so a single failing host script cannot prevent VB.ping()/host readiness.
    var files = [
      ext + "/host/json.jsx",
      ext + "/host/core.jsx",
      ext + "/host/batch.jsx",
      ext + "/host/export.jsx",
      ext + "/host/place.jsx",
      ext + "/host/agent.jsx",
      ext + "/host/watch.jsx"
    ];
    var loader = "(function(){";
    loader += "$.global.VB=$.global.VB||{};$.global.VB._loadErrors=[];";
    loader += "function _ld(p){try{$.evalFile(new File(p));}catch(e){try{$.global.VB._loadErrors.push(String(p)+':'+String(e));}catch(e2){}}}";
    for (var i = 0; i < files.length; i++) {
      loader += "_ld(" + core.jsxString(files[i]) + ");";
    }
    loader += "$.global.VB.extensionPath=" + core.jsxString(ext) + ";";
    loader += "try{return $.global.VB.ping();}catch(e){return 'error:ping:'+String(e);}";
    loader += "})()";
    evalJsx(loader, function (result) {
      // Best-effort: surface isolated host load errors to panel log without breaking hostOk.
      if (String(result) === "ok") {
        try {
          evalJsx("(function(){try{var e=$.global.VB&&$.global.VB._loadErrors;return (e&&e.length)?e.join(' | '):'';}catch(x){return '';}})()", function (errs) {
            var msg = String(errs || "");
            if (msg && msg !== "EvalScript error") core.log("Host load warnings: " + msg);
          });
        } catch (e2) {}
      }
      callback(result);
    });
  }

  function openLogFolder() {
    if (!bridge.hostOk) return;
    evalJsx('VB.openFolder(VB.getBridgeFolderPath())');
  }
  function openSvgsFolder() {
    if (!bridge.hostOk) return;
    evalJsx('VB.openFolder(VB.getBridgeFolderPath() + "/agent-downloads")');
  }

  bridge.getCS = getCS; bridge.setCS = setCS;
  bridge.logToHost = logToHost; bridge.evalJsx = evalJsx; bridge.parseResult = parseResult; bridge.friendlyError = friendlyError;
  bridge.loadHost = loadHost; bridge.openLogFolder = openLogFolder; bridge.openSvgsFolder = openSvgsFolder;
})();
