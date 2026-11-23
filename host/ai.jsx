/* Mockup Studio — Gemini in Chrome (browser-assisted image editing).

   The user's Google AI Plus benefits live inside the consumer Gemini site, not
   in the paid Gemini API, so this workflow does NOT call any API and never
   automates Gemini's page: Illustrator exports the artwork, the panel opens
   Gemini in the user's normal Chrome window, and the user generates and
   downloads the image there. This file only handles the local file work around
   that: a predictable workspace, opening Chrome, validating the downloaded
   file and placing it back into the document.

   No credentials, cookies, tokens or profile data are read or written, and Chrome
   is never pointed at a different profile directory: it is started as the
   browser the user already has open, so their existing session is the one used. */

var VB = $.global.VB;

/* Workspace layout, all inside the existing runtime folder:
     Documents/VectorizerBridge/gemini/source    exported artwork (ours)
     Documents/VectorizerBridge/gemini/results   downloads the user saves
     Documents/VectorizerBridge/gemini/requests  prompt/source metadata per id */
VB.geminiPaths = function () {
  var root = VB.getBridgeFolderPath() + "/gemini";
  return {
    root: root,
    source: root + "/source",
    results: root + "/results",
    requests: root + "/requests"
  };
};

VB.ensureGeminiFolders = function () {
  var p = VB.geminiPaths();
  var list = [p.root, p.source, p.results, p.requests];
  for (var i = 0; i < list.length; i++) {
    try {
      var f = new Folder(list[i]);
      if (!f.exists) f.create();
    } catch (e) { }
  }
  return p;
};

/* Export the current selection as the source image for one Gemini request.
   Reuses VB.exportSelection (same selection handling, artboard fit, pixel
   budget and PNG24 options as the vectorizer path) with an explicit output
   path, so all export logic stays in one place. */
VB.prepareGeminiSource = function (pngLongSide) {
  try {
    var p = VB.ensureGeminiFolders();
    var id = "gm-" + String(new Date().getTime());
    var out = p.source + "/" + id + ".png";
    var res = null;
    try { res = VB.fromJSON(VB.exportSelection(pngLongSide, out)); } catch (parseErr) { res = null; }
    if (!res || !res.ok) return VB.toJSON(res || { ok: false, error: "exportFailed" });
    var file = new File(out);
    VB.log("prepareGeminiSource: " + out);
    return VB.toJSON({
      ok: true,
      id: id,
      path: out,
      name: file.name,
      bytes: file.length || 0,
      union: res.union,
      width: res.width,
      height: res.height,
      docFullName: res.docFullName,
      docName: res.docName,
      /* Shown to the user straight after Open Gemini: this is where the download
         has to land for the panel to pick it up. */
      resultsFolder: p.results
    });
  } catch (e) {
    VB.log("prepareGeminiSource error: " + e);
    return VB.toJSON({ ok: false, error: String(e) });
  }
};

/* Request metadata beside the source image: which artwork, which prompt, when.
   Useful for the user to retrace a result; never contains account data. */
VB.saveGeminiRequest = function (json) {
  try {
    var data = null;
    try { data = VB.fromJSON(String(json)); } catch (e0) { data = null; }
    if (!data) return "error: bad json";
    var id = String(data.id == null ? "" : data.id).replace(/[^A-Za-z0-9_-]/g, "");
    if (!id) return "error: bad id";
    var p = VB.ensureGeminiFolders();
    return VB.writeTextFile(p.requests + "/" + id + ".json", VB.toJSON(data));
  } catch (e) { return "error: " + e; }
};

/* Where Chrome lives, so Gemini opens in the user's own browser rather than
   whatever happens to be the default one. */
function chromeExe() {
  var list = [];
  try { list.push(String($.getenv("ProgramFiles")).replace(/\\/g, "/") + "/Google/Chrome/Application/chrome.exe"); } catch (e0) { }
  try { list.push(String($.getenv("ProgramFiles(x86)")).replace(/\\/g, "/") + "/Google/Chrome/Application/chrome.exe"); } catch (e1) { }
  try { list.push(String($.getenv("ProgramW6432")).replace(/\\/g, "/") + "/Google/Chrome/Application/chrome.exe"); } catch (e2) { }
  try { list.push(String($.getenv("LOCALAPPDATA")).replace(/\\/g, "/") + "/Google/Chrome/Application/chrome.exe"); } catch (e3) { }
  list.push("C:/Program Files/Google/Chrome/Application/chrome.exe");
  for (var i = 0; i < list.length; i++) {
    try {
      var f = new File(list[i]);
      if (f.exists) return f.fsName;
    } catch (e) { }
  }
  return "";
}

/* Open Gemini in Chrome. Illustrator's ExtendScript has no shell of its own, so
   this uses the same hidden-VBS technique as the agent launcher: a plain
   `start`-style Run of the user's Chrome, on their signed-in default profile.

   It is opened as an app window (--app, no tabs and no address bar) rather than a
   browser window, so it reads as part of the panel instead of "a browser just
   opened"; the profile, session and cookies are the user's own either way. */
VB.openGeminiWindow = function (url) {
  var safeUrl = String(url || "https://gemini.google.com/app").replace(/"/g, "");
  try {
    var chrome = chromeExe();
    var command = chrome ? ('"' + chrome + '" --app="' + safeUrl + '"') : ('"' + safeUrl + '"');
    var vbsPath = VB.getTempFolderPath() + "/open_gemini_window.vbs";
    var vbs = new File(vbsPath);
    vbs.encoding = "ASCII";
    if (!vbs.open("w")) return VB.toJSON({ ok: false, error: "cannot write the launcher" });
    vbs.writeln("Dim sh");
    vbs.writeln("Set sh = CreateObject(\"WScript.Shell\")");
    // VBScript escapes a quote inside a string by doubling it.
    vbs.writeln('sh.Run "' + command.replace(/"/g, '""') + '", 1, False');
    vbs.close();
    vbs.execute();
    VB.log("openGeminiWindow via " + (chrome ? chrome : "the default browser"));
    return VB.toJSON({ ok: true, via: chrome ? "chrome" : "default", chrome: chrome });
  } catch (e) {
    VB.log("openGeminiWindow error: " + e);
    return VB.toJSON({ ok: false, error: String(e) });
  }
};

/* Validate a file the user picked: it must exist, be readable and actually be a
   PNG/JPEG/WebP. Gemini can also return formats Illustrator cannot place, and a
   renamed .txt must not reach the placement call. */
VB.inspectImageFile = function (path) {
  try {
    var file = new File(String(path || ""));
    if (!file.exists) return VB.toJSON({ ok: false, error: "fileNotFound" });
    if (!file.open("r")) return VB.toJSON({ ok: false, error: "fileUnreadable" });
    var head = file.read(12);
    file.close();
    var b0 = head && head.length > 0 ? head.charCodeAt(0) : -1;
    var b1 = head && head.length > 1 ? head.charCodeAt(1) : -1;
    var b2 = head && head.length > 2 ? head.charCodeAt(2) : -1;
    var b3 = head && head.length > 3 ? head.charCodeAt(3) : -1;
    var kind = "";
    /* RIFF is a container for more than images, but bytes 8-11 say WEBP and
       they are already in the twelve bytes read above. */
    if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4E && b3 === 0x47) kind = "png";
    else if (b0 === 0xFF && b1 === 0xD8 && b2 === 0xFF) kind = "jpeg";
    else if (b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46 && head.slice(8, 12) === "WEBP") kind = "webp";
    if (!kind) return VB.toJSON({ ok: false, error: "unsupportedImage", name: file.name, path: file.fsName });
    return VB.toJSON({ ok: true, path: file.fsName, name: file.name, kind: kind, bytes: file.length || 0 });
  } catch (e) {
    VB.log("inspectImageFile error: " + e);
    return VB.toJSON({ ok: false, error: String(e) });
  }
};

/* Explicit file choice: the manual fallback the workflow always keeps, because
   Chrome decides where a download lands and we never watch the Downloads folder. */
VB.pickImageFile = function () {
  try {
    var filter = "Images:*.png;*.jpg;*.jpeg;*.webp,";
    var picked = File.openDialog("Choose the image Gemini generated", filter, false);
    if (!picked) return VB.toJSON({ ok: false, error: "cancelled" });
    return VB.inspectImageFile(picked.fsName);
  } catch (e) {
    VB.log("pickImageFile error: " + e);
    return VB.toJSON({ ok: false, error: String(e) });
  }
};

/* Recent images in the results folder, newest first. */
VB.listGeminiResults = function (limit) {
  try {
    var max = parseInt(limit, 10);
    if (!isFinite(max) || max <= 0) max = 20;
    var p = VB.ensureGeminiFolders();
    var folder = new Folder(p.results);
    if (!folder.exists) return VB.toJSON({ ok: true, files: [], folder: p.results });
    var files = folder.getFiles(function (f) {
      try { return f instanceof File && /\.(png|jpe?g|webp)$/i.test(f.name); } catch (e) { return false; }
    }) || [];
    files.sort(function (a, b) {
      var ma = 0, mb = 0;
      try { ma = a.modified ? a.modified.getTime() : 0; } catch (e) { }
      try { mb = b.modified ? b.modified.getTime() : 0; } catch (e2) { }
      return mb - ma;
    });
    var out = [];
    for (var i = 0; i < files.length && i < max; i++) {
      var f = files[i];
      var sz = 0;
      try { sz = f.length || 0; } catch (e3) { }
      out.push({ name: f.name, path: f.fsName, bytes: sz });
    }
    return VB.toJSON({ ok: true, files: out, folder: p.results });
  } catch (e) {
    VB.log("listGeminiResults error: " + e);
    return VB.toJSON({ ok: false, error: String(e) });
  }
};

/* The newest image in the results folder that appeared after `since` (epoch ms),
   or none. This is what lets the panel finish a request by itself: only our own
   folder is scanned, never the Downloads tree. One second of slack, because
   filesystem timestamps are coarser than the clock that arms the watch. */
VB.newestGeminiResult = function (sinceMs) {
  try {
    var since = Number(sinceMs);
    if (!isFinite(since)) since = 0;
    var p = VB.ensureGeminiFolders();
    var folder = new Folder(p.results);
    if (!folder.exists) return VB.toJSON({ ok: true, file: null });
    var files = folder.getFiles(function (f) {
      try { return f instanceof File && /\.(png|jpe?g|webp)$/i.test(f.name); } catch (e) { return false; }
    }) || [];
    var best = null, bestTime = -1;
    for (var i = 0; i < files.length; i++) {
      var when = 0;
      try { when = files[i].modified ? files[i].modified.getTime() : 0; } catch (e2) { when = 0; }
      if (when + 1000 < since) continue;
      if (when >= bestTime) { best = files[i]; bestTime = when; }
    }
    if (!best) return VB.toJSON({ ok: true, file: null });
    return VB.toJSON({ ok: true, file: { name: best.name, path: best.fsName, bytes: best.length || 0 } });
  } catch (e) { return VB.toJSON({ ok: false, error: String(e) }); }
};

/* Place a raster result on its own layer. Unlike placeSVG this is a raster
   import, so placedItems.add() + embed() is the right call. The artwork already
   in the document is never hidden, moved or removed: the result is added on top.

   args.requireDoc pins the placement to one file: a mismatch returns docChanged
   and touches nothing. The watcher always sends it, so an automatic placement
   can never land in another document; the button sends nothing, because pressing
   Place is the user's own choice of the document in front of them. */
VB.placeImageFile = function (encodedArgs) {
  var args = null;
  try { args = VB.fromJSON(decodeURIComponent(String(encodedArgs))); } catch (e0) { args = null; }
  if (!args) return VB.toJSON({ ok: false, error: "badArgs" });

  var imagePath = String(args.path || "");
  var layerName = String(args.layerName || "Gemini Image");
  var union = args.union;
  var doc = null, layer = null, item = null, placed = null, createdLayer = false;

  try {
    if (app.documents.length === 0) return VB.toJSON({ ok: false, error: "noDocument" });
    doc = app.activeDocument;
    if (!VB.isDocEditable(doc)) return VB.toJSON({ ok: false, error: "documentLocked" });

    /* Only automatic placement is pinned to the document the source came from:
       a result must never appear in another file behind the user's back. A
       manual Place sends no requireDoc, because pressing it is the choice. */
    var requireDoc = args.requireDoc;
    if (requireDoc && (requireDoc.fullName || requireDoc.name)) {
      var sameDoc = true;
      if (requireDoc.fullName) {
        try { sameDoc = String(doc.fullName) === String(requireDoc.fullName); } catch (e1) { sameDoc = false; }
      } else {
        try { sameDoc = String(doc.name) === String(requireDoc.name); } catch (e2) { sameDoc = false; }
      }
      if (!sameDoc) return VB.toJSON({ ok: false, error: "docChanged" });
    }

    var file = new File(imagePath);
    if (!file.exists) return VB.toJSON({ ok: false, error: "fileNotFound" });

    /* Target box: the exported selection when known, otherwise the active
       artboard with a small margin, so a full-artboard result fits. */
    var box = union && union.width > 0 && union.height > 0 ? union : null;
    if (!box) {
      try {
        var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()];
        var r = ab.artboardRect;
        var m = Math.min(Number(r[2]) - Number(r[0]), Number(r[1]) - Number(r[3])) * 0.02;
        box = {
          left: Number(r[0]) + m,
          top: Number(r[1]) - m,
          width: (Number(r[2]) - Number(r[0])) - m * 2,
          height: (Number(r[1]) - Number(r[3])) - m * 2
        };
      } catch (abErr) { box = null; }
    }

    for (var i = 0; i < doc.layers.length; i++) {
      if (doc.layers[i].name === layerName) { layer = doc.layers[i]; break; }
    }
    if (!layer) {
      layer = doc.layers.add();
      layer.name = layerName;
      createdLayer = true;
    }
    if (layer.locked) return VB.toJSON({ ok: false, error: "layerLocked" });
    if (!layer.visible) layer.visible = true;

    try {
      placed = layer.placedItems.add();
      placed.file = file;
    } catch (addErr) {
      VB.log("placeImageFile: placedItems.add failed: " + addErr);
      return VB.toJSON({ ok: false, error: "placeFailed" });
    }

    var embedded = true;
    item = placed;
    try {
      var result = placed.embed();
      if (result && result.typename) item = result;
      else if (layer.pageItems.length > 0) item = layer.pageItems[layer.pageItems.length - 1];
    } catch (embedErr) {
      // Keep the link rather than failing: the image is still on the artboard.
      embedded = false;
      item = placed;
      VB.log("placeImageFile: embed failed, kept as link: " + embedErr);
    }

    if (box) {
      try {
        var targetRatio = box.width / box.height;
        var actualRatio = item.width / item.height;
        if (actualRatio > targetRatio) {
          item.width = box.width;
          item.height = box.width / actualRatio;
        } else {
          item.height = box.height;
          item.width = box.height * actualRatio;
        }
        item.left = box.left + (box.width - item.width) / 2;
        item.top = box.top - (box.height - item.height) / 2;
      } catch (fitErr) { VB.log("placeImageFile fit error: " + fitErr); }
    }

    try {
      item.selected = true;
      doc.selection = [item];
    } catch (selErr) { VB.log("placeImageFile select error: " + selErr); }

    VB.log("placeImageFile done: " + imagePath + " layer=" + layer.name + " embedded=" + embedded);
    return VB.toJSON({ ok: true, layer: layer.name, embedded: embedded });
  } catch (e) {
    VB.log("placeImageFile error: " + e);
    try { if (item && item.isValid) item.remove(); } catch (cleanupErr1) { }
    try { if (createdLayer && layer && layer.pageItems.length === 0) layer.remove(); } catch (layerErr) { }
    return VB.toJSON({ ok: false, error: String(e) });
  }
};

/* Housekeeping: our own source images and request records age out; the results
   folder is the user's and is never touched. */
VB.cleanGeminiWorkspace = function (days) {
  try {
    var maxAge = parseInt(days, 10);
    if (!isFinite(maxAge) || maxAge <= 0) maxAge = 7;
    var p = VB.geminiPaths();
    var cutoff = new Date().getTime() - maxAge * 24 * 60 * 60 * 1000;
    var removed = 0;
    var folders = [p.source, p.requests];
    for (var i = 0; i < folders.length; i++) {
      var folder = new Folder(folders[i]);
      if (!folder.exists) continue;
      var files = folder.getFiles() || [];
      for (var j = 0; j < files.length; j++) {
        try {
          var f = files[j];
          if (!(f instanceof File)) continue;
          var when = f.modified ? f.modified.getTime() : 0;
          if (when > 0 && when < cutoff && f.remove()) removed++;
        } catch (e) { }
      }
    }
    if (removed) VB.log("cleanGeminiWorkspace removed " + removed + " old file(s)");
    return VB.toJSON({ ok: true, removed: removed });
  } catch (e) { return VB.toJSON({ ok: false, error: String(e) }); }
};
