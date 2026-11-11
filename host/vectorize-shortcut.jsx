/* Vectorizer Bridge - native shortcut entry point (Illustrator Actions / app.doScript).
   ES3 only. Exports current selection to PNG and launches agent run using a dedicated
   status file so the panel poll loop can place the result when available. */
var VB = $.global.VB;

VB.vectorizeShortcut = function (pngLongSide) {
  var tempDoc = null;
  var doc = null;
  var docFullName = "";
  var docName = "";
  try {
    pngLongSide = parseInt(pngLongSide, 10);
    if (!isFinite(pngLongSide)) pngLongSide = 1700;
    if (pngLongSide !== 0) {
      if (pngLongSide < 100) pngLongSide = 1700;
      if (pngLongSide > 5000) pngLongSide = 5000;
    }

    VB.log("vectorizeShortcut start (longSide=" + (pngLongSide === 0 ? "original" : pngLongSide) + ")");

    if (app.documents.length === 0) return VB.toJSON({ ok: false, error: "noDocument" });
    doc = app.activeDocument;
    try { docFullName = String(doc.fullName); } catch (e0) { docFullName = ""; }
    try { docName = String(doc.name); } catch (e1) { docName = ""; }
    if (!VB.isDocEditable(doc)) return VB.toJSON({ ok: false, error: "documentLocked" });

    var sel = doc.selection;
    if (!sel || sel.length === 0) return VB.toJSON({ ok: false, error: "noSelection" });

    VB.ensureBridgeFolder();
    var bf = new Folder(VB.getBridgeFolderPath());
    if (!bf.exists) bf.create();

    var bounds = [];
    for (var i = 0; i < sel.length; i++) {
      try {
        var box = VB.itemBox(sel[i]);
        if (box && box.width > 0.01 && box.height > 0.01) { box.typename = sel[i].typename; bounds.push(box); }
      } catch (e) { VB.log("vectorizeShortcut capture bound error item " + i + ": " + e); }
    }
    if (bounds.length === 0) return VB.toJSON({ ok: false, error: "emptyBounds" });
    var union = VB.unionBounds(bounds);
    if (!union || union.width <= 0.01 || union.height <= 0.01) return VB.toJSON({ ok: false, error: "emptyBounds" });

    var pngFile = new File(bf.fsName + "/vectorizer_export_shortcut.png");
    if (pngFile.exists) pngFile.remove();

    tempDoc = app.documents.add();
    if (!tempDoc) return VB.toJSON({ ok: false, error: "duplicateFailed" });
    var items = sel;
    try { app.activeDocument = doc; if (doc.selection && doc.selection.length > 0) items = doc.selection; } catch (reactivateErr) {}
    for (var j = 0; j < items.length; j++) { try { items[j].duplicate(tempDoc); } catch (dupErr) { VB.log("vectorizeShortcut duplicate error item " + j + ": " + dupErr); } }
    if (tempDoc.pageItems.length === 0) return VB.toJSON({ ok: false, error: "duplicateFailed" });
    try { app.activeDocument = tempDoc; } catch (activateErr) {}

    var tempBounds = [];
    for (var k = 0; k < tempDoc.pageItems.length; k++) { try { tempBounds.push(VB.itemBox(tempDoc.pageItems[k])); } catch (tbe) {} }
    var tempUnion = VB.unionBounds(tempBounds);
    if (!tempUnion || !(tempUnion.width > 0.01) || !(tempUnion.height > 0.01)) tempUnion = union;
    if (!VB.fitArtboard(tempDoc, tempUnion)) return VB.toJSON({ ok: false, error: "artboardFailed" });

    var exportOpts = new ExportOptionsPNG24();
    exportOpts.antiAliasing = true; exportOpts.transparency = true; exportOpts.artBoardClipping = true;
    var longSidePts = Math.max(tempUnion.width, tempUnion.height);
    var resolution = (pngLongSide === 0) ? 72 : Math.round(pngLongSide / Math.max(longSidePts / 72, 0.01));
    if (!isFinite(resolution) || resolution < 1) resolution = 72;
    if (resolution > 2400) resolution = 2400;
    exportOpts.resolution = resolution;
    tempDoc.exportFile(pngFile, ExportType.PNG24, exportOpts);
    if (!pngFile.exists || pngFile.length < 10) return VB.toJSON({ ok: false, error: "exportFailed" });

    // Preserve selection/original context for placement
    VB._originalItems = sel;
    VB._exportDocFullName = docFullName;
    VB._exportDocName = docName;

    var statusPath = VB.getBridgeFolderPath() + "/agent-status-shortcut.json";
    // Pre-write starting marker (agentStart will also write/validate; keep consistent)
    try {
      var statusFile = new File(statusPath);
      statusFile.encoding = "UTF-8";
      if (statusFile.open("w")) { statusFile.write('{"time":' + (new Date().getTime()) + ',"state":"starting"}'); statusFile.close(); }
    } catch (eStatus) { VB.log("vectorizeShortcut status prewrite error: " + eStatus); }

    var started = VB.agentStart('run', pngFile.fsName, statusPath);
    if (String(started) !== "started") {
      VB.log("vectorizeShortcut agentStart failed: " + started);
      return VB.toJSON({ ok: false, error: String(started) || "agentStartFailed", pngPath: pngFile.fsName, statusPath: statusPath });
    }

    VB.log("vectorizeShortcut launched: " + pngFile.fsName + " status=" + statusPath);
    return VB.toJSON({ ok: true, pngPath: pngFile.fsName, statusPath: statusPath, union: union, docFullName: docFullName, docName: docName, width: union.width, height: union.height, resolution: resolution });
  } catch (e) {
    VB.log("vectorizeShortcut error: " + e);
    return VB.toJSON({ ok: false, error: String(e) });
  } finally {
    if (tempDoc) { try { tempDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (closeErr) {} }
    try { if (doc) app.activeDocument = doc; } catch (activeErr) { }
  }
};
