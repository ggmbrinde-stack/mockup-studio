/* Vectorizer Bridge - shared ExtendScript helpers (Illustrator 2025/2026+)
   Loaded with $.evalFile() from js/panel.js. Keep this file ES3-compatible:
   no let/const, no arrow functions, no Array.forEach. */

$.global.VB = $.global.VB || {};
var VB = $.global.VB;

VB.extensionPath = VB.extensionPath || "";

/* Simple readiness check used by the panel. */
VB.ping = function () {
  return "ok";
};

/* JSON helpers. host/json.jsx adds a JSON object to ExtendScript (ES3 has
   none); these wrappers keep working even if that file failed to load, so an
   error can never turn into "badResponse: JSON is undefined". */
VB.toJSON = function (value) {
  try {
    if (typeof JSON !== "undefined" && JSON && typeof JSON.stringify === "function") {
      return JSON.stringify(value);
    }
  } catch (e) { }

  // Last resort for the {ok:false, error:"..."} payloads used by the panel.
  try {
    var message = (value && value.error !== undefined) ? value.error : value;
    return '{"ok":false,"error":"' + String(message)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/[\r\n\t]/g, " ") + '"}';
  } catch (e2) {
    return '{"ok":false,"error":"unknown"}';
  }
};

VB.fromJSON = function (text) {
  if (typeof JSON !== "undefined" && JSON && typeof JSON.parse === "function") {
    return JSON.parse(text);
  }
  return eval("(" + String(text) + ")");
};

/* Proves in the running Illustrator that JSON really works: the panel runs
   this once at load and shows the result in the log. Without it, a broken
   serializer only shows up later as "badResponse" on the first export. */
VB.selfTest = function () {
  var sample = {
    ok: true,
    num: 42.5,
    flag: true,
    list: [1, "two", null],
    text: "quote \" backslash \\ newline\nend"
  };
  var parsed = false;
  var size = 0;
  try {
    var text = VB.toJSON(sample);
    size = text.length;
    var back = VB.fromJSON(text);
    parsed = !!back &&
      back.ok === true &&
      back.num === 42.5 &&
      back.flag === true &&
      back.list && back.list.length === 3 && back.list[1] === "two" &&
      back.text === sample.text;
  } catch (e) {
    VB.log("selfTest error: " + e);
  }
  return VB.toJSON({ ok: true, selftest: "json", parsed: parsed, size: size });
};

/* Documents\VectorizerBridge â€” only files created by this panel live here. */
VB.getBridgeFolderPath = function () {
  try {
    return String(Folder.myDocuments.fsName).replace(/\\/g, "/") + "/VectorizerBridge";
  } catch (e) {
    return (Folder.myDocuments ? String(Folder.myDocuments.fsName) : "C:/") + "/VectorizerBridge";
  }
};

VB.ensureBridgeFolder = function () {
  try {
    var f = new Folder(VB.getBridgeFolderPath());
    if (!f.exists) f.create();
    return f;
  } catch (e) {
    return null;
  }
};

/* Append a timestamped line to Documents\VectorizerBridge\log.txt.
   Logging must never throw and must never touch the user's document. */
VB.log = function (msg) {
  try {
    var folder = VB.ensureBridgeFolder();
    if (!folder) return;
    var logFile = new File(folder.fsName + "/log.txt");
    logFile.encoding = "UTF-8";
    logFile.open("a");
    logFile.writeln(new Date().toLocaleString() + "  " + String(msg));
    logFile.close();
  } catch (e) { /* ignore */ }
};

VB.getActiveDocFullName = function () {
  try {
    if (app.documents.length === 0) return "";
    return String(app.activeDocument.fullName);
  } catch (e) {
    return "";
  }
};

VB.getActiveDocName = function () {
  try {
    if (app.documents.length === 0) return "";
    return String(app.activeDocument.name);
  } catch (e) {
    return "";
  }
};

VB.isDocEditable = function (doc) {
  try {
    var _ = doc.pageItems.length; // throws if the document is locked/unavailable
    return true;
  } catch (e) {
    return false;
  }
};

/* Temp folder for our helper files. */
VB.getTempFolderPath = function () {
  try {
    var f = Folder.temp;
    if (f && f.exists) return String(f.fsName).replace(/\\/g, "/");
  } catch (e) { }
  return VB.getBridgeFolderPath();
};

/* Run a shell command and return its output.
   Returns null when the host app exposes no shell. Illustrator's ExtendScript
   has no global `system` object (only some Adobe apps do), so every shell call
   must have a File.execute() fallback. */
VB.runCommand = function (command) {
  try {
    if (typeof system !== "undefined" && system && typeof system.callSystem === "function") {
      return String(system.callSystem(command));
    }
  } catch (e) { }
  try {
    if ($.global.system && typeof $.global.system.callSystem === "function") {
      return String($.global.system.callSystem(command));
    }
  } catch (e2) { }
  return null;
};

VB.readTextFile = function (path) {
  try {
    var f = new File(path);
    if (!f.exists) return "";
    f.encoding = "UTF-8";
    if (!f.open("r")) return "";
    var text = f.read();
    f.close();
    return String(text || "");
  } catch (e) {
    return "";
  }
};

/* Open a URL in the system default browser (Windows). */
VB.openUrl = function (url) {
  var safe = String(url).replace(/"/g, "");
  var out = VB.runCommand('start "" "' + safe + '"');
  if (out !== null) return "ok";

  // No shell: write a Windows internet shortcut and let the OS open it.
  try {
    var shortcut = new File(VB.getTempFolderPath() + "/open_vectorizer.url");
    if (shortcut.open("w")) {
      shortcut.writeln("[InternetShortcut]");
      shortcut.writeln("URL=" + safe);
      shortcut.close();
      shortcut.execute();
      VB.log("openUrl: launched via .url shortcut");
      return "ok";
    }
    return "error: could not write the .url shortcut";
  } catch (e) {
    VB.log("openUrl error: " + e);
    return "error: " + e;
  }
};

/* Open a folder in Explorer. */
VB.openFolder = function (path) {
  var safe = String(path).replace(/"/g, "");
  var out = VB.runCommand('explorer "' + safe + '"');
  if (out !== null) return "ok";

  try {
    var folder = new Folder(safe);
    if (!folder.exists) return "error: folder not found";
    folder.execute();
    VB.log("openFolder: launched via Folder.execute()");
    return "ok";
  } catch (e) {
    VB.log("openFolder error: " + e);
    return "error: " + e;
  }
};

/* Bounding box of a page item. Prefer visibleBounds so strokes and effects
   are included (left, top, width, height in points). */
VB.itemBox = function (item) {
  function okBox(b) { return b && isFinite(b.left) && isFinite(b.top) && b.width > 0.01 && b.height > 0.01; }
  function fromRect(vb) {
    if (!vb || vb.length !== 4) return null;
    var b = { left: Number(vb[0]), top: Number(vb[1]), width: Number(vb[2]) - Number(vb[0]), height: Number(vb[1]) - Number(vb[3]) };
    return okBox(b) ? b : null;
  }
  try { var b1 = fromRect(item.visibleBounds); if (b1) return b1; } catch (e1) { }
  try { var b2 = fromRect(item.geometricBounds); if (b2) return b2; } catch (e2) { }
  try { if (typeof item.controlBounds !== "undefined") { var b3 = fromRect(item.controlBounds); if (b3) return b3; } } catch (e3) { }
  try { var b4 = { left: Number(item.left), top: Number(item.top), width: Number(item.width), height: Number(item.height) }; if (okBox(b4)) return b4; } catch (e4) { }
  try { if (item.position && item.position.length === 2) { var b5 = { left: Number(item.position[0]), top: Number(item.position[1]), width: Number(item.width), height: Number(item.height) }; if (okBox(b5)) return b5; } } catch (e5) { }
  try {
    if (item.typename === "GroupItem" || item.clipped || item.pageItems) {
      var kids = item.pageItems || item.pathItems || [];
      var boxes = [];
      for (var i = 0; i < kids.length; i++) { try { var kb = VB.itemBox(kids[i]); if (okBox(kb)) boxes.push(kb); } catch (ke) {} }
      var u = VB.unionBounds(boxes);
      if (okBox(u)) return u;
    }
  } catch (e6) { }
  if (VB.debug) VB.log("itemBox: no usable bounds for " + (item && item.typename ? item.typename : "?"));
  return { left: 0, top: 0, width: 0, height: 0 };
};

/* Illustrator coordinates: item.top is the top edge and Y grows upward,
   so the bottom edge is top - height. Artboard rects are [l, t, r, b]. */
VB.unionBounds = function (bounds) {
  if (!bounds || bounds.length === 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  var minL = bounds[0].left;
  var maxT = bounds[0].top;
  var maxR = bounds[0].left + bounds[0].width;
  var minB = bounds[0].top - bounds[0].height;
  for (var i = 1; i < bounds.length; i++) {
    var b = bounds[i];
    if (b.left < minL) minL = b.left;
    if (b.top > maxT) maxT = b.top;
    if (b.left + b.width > maxR) maxR = b.left + b.width;
    if (b.top - b.height < minB) minB = b.top - b.height;
  }
  return { left: minL, top: maxT, width: maxR - minL, height: maxT - minB };
};

/* Fit a temporary document's artboard to a rect (no padding).
   Returns true on success so the caller can abort instead of exporting a
   PNG clipped to the wrong (default) artboard. */
VB.fitArtboard = function (doc, rect) {
  try {
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    var ab = doc.artboards[0];
    ab.artboardRect = [
      rect.left,
      rect.top,
      rect.left + rect.width,
      rect.top - rect.height
    ];
    return true;
  } catch (e) {
    VB.log("fitArtboard error: " + e);
    return false;
  }
};

/* Read extension version from CSXS/manifest.xml */
VB.getExtensionVersion = function () {
  try {
    var ext = VB.extensionPath || "";
    if (!ext) return "";
    var path = ext.replace(/\\/g, "/") + "/CSXS/manifest.xml";
    var txt = VB.readTextFile(path);
    if (!txt) return "";
    var m = txt.match(/ExtensionBundleVersion=\"([^\"]+)\"/);
    if (m && m[1]) return String(m[1]);
  } catch (e) { VB.log("getExtensionVersion error: " + e); }
  return "";
};

/* List recent SVG files in agent-downloads (for panel history). */
VB.listVectorizedSvgs = function (limit) {
  try {
    limit = parseInt(limit, 10);
    if (!isFinite(limit) || limit < 1) limit = 30;
    if (limit > 120) limit = 120;
    var folder = new Folder(VB.getBridgeFolderPath() + "/agent-downloads");
    if (!folder.exists) return VB.toJSON({ ok: true, files: [], folder: folder.fsName || "" });
    var files = folder.getFiles(function (f) { try { return f instanceof File && /\.svg$/i.test(f.name); } catch (e) { return false; } }) || [];
    files.sort(function (a, b) {
      var ma = 0, mb = 0; try { ma = a.modified ? a.modified.getTime() : 0; } catch (e) {}
      try { mb = b.modified ? b.modified.getTime() : 0; } catch (e2) {}
      return mb - ma;
    });
    var out = [];
    for (var i = 0; i < files.length && i < limit; i++) {
      var f = files[i], mt = 0, sz = 0;
      try { mt = f.modified ? f.modified.getTime() : 0; } catch (e3) {}
      try { sz = f.length || 0; } catch (e4) {}
      out.push({ name: String(f.name), path: String(f.fsName).replace(/\\/g, "/"), modified: mt, size: sz });
    }
    return VB.toJSON({ ok: true, files: out, folder: String(folder.fsName || "").replace(/\\/g, "/") });
  } catch (e) { return VB.toJSON({ ok: false, error: String(e) }); }
};

VB.openFile = function (path) {
  try {
    var safe = String(path).replace(/"/g, '');
    var f = new File(safe);
    if (!f.exists) return 'error: file not found';
    f.execute();
    return 'ok';
  } catch (e) { try { return VB.openFolder(path); } catch (e2) { return 'error: ' + e; } }
};
VB.revealFile = function (path) {
  try {
    var safe = String(path).replace(/"/g, '');
    var f = new File(safe);
    if (!f.exists) return 'error: file not found';
    var out = VB.runCommand('explorer /select,"' + f.fsName + '"');
    if (out !== null) return 'ok';
    try { return VB.openFolder(f.parent ? f.parent.fsName : safe); } catch (e3) { return 'ok'; }
  } catch (e) { return 'error: ' + e; }
};
