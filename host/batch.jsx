/* Vectorizer Bridge — batch prepare/export (per-item). Split from export.jsx for modularity. */
var VB = $.global.VB;

VB.prepareBatch = function (pngLongSide) {
  try {
    pngLongSide = parseInt(pngLongSide, 10);
    if (!isFinite(pngLongSide)) pngLongSide = 1700;
    if (pngLongSide !== 0) {
      if (pngLongSide < 100) pngLongSide = 1700;
      if (pngLongSide > 5000) pngLongSide = 5000;
    }
    if (app.documents.length === 0) return VB.toJSON({ ok: false, error: "noDocument" });
    var doc = app.activeDocument;
    if (!VB.isDocEditable(doc)) return VB.toJSON({ ok: false, error: "documentLocked" });
    var sel = doc.selection;
    if (!sel || sel.length === 0) return VB.toJSON({ ok: false, error: "noSelection" });
    var docFullName = ""; var docName = "";
    try { docFullName = String(doc.fullName); } catch (e0) { docFullName = ""; }
    try { docName = String(doc.name); } catch (e1) { docName = ""; }

    var jobId = String((new Date()).getTime());
    var items = [];
    var refs = [];
    var meta = [];
    var seen = {};
    for (var i = 0; i < sel.length; i++) {
      var it = sel[i];
      try {
        if (!it) continue;
        var valid = true;
        try { if (typeof it.isValid !== "undefined") valid = !!it.isValid; } catch (ivE) { valid = true; }
        if (!valid) {
          // Illustrator/ExtendScript can report unexpected isValid states for some wrappers;
          // accept if we can still read typename (bounds/dup will validate).
          try { var _tn = String(it.typename || ""); if (!_tn) { if (VB.debug) VB.log("prepareBatch: item " + i + " invalid"); continue; } }
          catch (tnE) { if (VB.debug) VB.log("prepareBatch: item " + i + " invalid"); continue; }
        }
        // Use selected object as-is (can be any layer, linked/placed/group/path/etc.)
        var marker = "VB_BATCH=" + jobId + ":" + refs.length;
        var oldNote = "";
        try { oldNote = String(it.note || ""); } catch (nE) { oldNote = ""; }
        if (oldNote.indexOf("VB_BATCH=" + jobId + ":") === 0) marker = oldNote;
        else {
          try { it.note = marker + (oldNote && oldNote.indexOf("VB_BATCH=") !== 0 ? ("|" + oldNote) : ""); } catch (snE) {}
          try { var tg = it.tags.add(); tg.name = "VB_BATCH"; tg.value = marker; } catch (tgE) {}
        }
        if (seen[marker]) { if (VB.debug) VB.log("prepareBatch: item " + i + " dup marker"); continue; }
        seen[marker] = true;
        var box = VB.itemBox(it);
        if (VB.debug) VB.log("prepareBatch: item " + i + " " + it.typename + " box=" + (box ? (box.width + "x" + box.height) : "null"));
        if (!box || !(box.width > 0.01) || !(box.height > 0.01)) {
          VB.log("prepareBatch skip (no bounds): " + i + " " + it.typename);
          continue;
        }
        refs.push(it);
        meta.push({ marker: marker, noteHad: (oldNote.indexOf("VB_BATCH=") !== 0) ? oldNote : "" });
        items.push({ index: refs.length - 1, typename: it.typename, width: box.width, height: box.height, id: marker });
      } catch (e) { VB.log("prepareBatch skip item " + i + ": " + e); }
    }
    if (refs.length === 0) {
      if (VB.debug) {
        try {
          var diag = [];
          for (var di = 0; di < sel.length && di < 8; di++) {
            var dit = sel[di]; var db = null;
            try { db = VB.itemBox(dit); } catch (dbe) { db = null; }
            var info = (dit && dit.typename ? dit.typename : '?');
            try { info += ' box=' + (db ? (db.width+'x'+db.height) : 'null'); } catch (dbx) {}
            diag.push(info);
          }
          VB.log("prepareBatch emptyBounds sel=" + sel.length + ": " + diag.join(' || '));
        } catch (dlog) {}
      } else {
        VB.log("prepareBatch: no usable selected items (sel=" + sel.length + ")");
      }
      return VB.toJSON({ ok: false, error: "emptyBounds" });
    }
    VB._batch = { pngLongSide: pngLongSide, docFullName: docFullName, docName: docName, count: refs.length, jobId: jobId, meta: meta };
    VB._batchItems = refs;
    VB._currentOriginalItem = null;
    VB.log("prepareBatch: " + refs.length + " item(s), job=" + jobId);
    return VB.toJSON({ ok: true, count: refs.length, docFullName: docFullName, docName: docName, jobId: jobId, items: items });
  } catch (e) {
    VB.log("prepareBatch error: " + e);
    return VB.toJSON({ ok: false, error: String(e) });
  }
};

VB._findBatchItemByTag = function (doc, jobId, index) {
  var marker = "VB_BATCH=" + String(jobId) + ":" + String(index);
  try {
    var all = doc.pageItems;
    for (var i = 0; i < all.length; i++) {
      try {
        var it = all[i];
        var n = "";
        try { n = String(it.note || ""); } catch (ne) { n = ""; }
        if (n.indexOf(marker) === 0) return it;
        try {
          if (it.tags && it.tags.length) {
            for (var t = 0; t < it.tags.length; t++) {
              try { if (String(it.tags[t].name) === "VB_BATCH" && String(it.tags[t].value) === marker) return it; } catch (te) {}
            }
          }
        } catch (tage) {}
      } catch (ie) {}
    }
  } catch (e) {}
  return null;
};

VB._usableBatchItem = function (it) {
  if (!it) return false;
  try { if (typeof it.isValid !== "undefined" && !it.isValid) { /* probe typename */ } } catch (e) {}
  try { var tn = String(it.typename || ""); if (tn) return true; } catch (e2) {}
  return false;
};

/* Resolve and set the batch original for placement/hide by index+job. Safe for parallel batch v2
   (placeSVG can target a specific item instead of racing VB._currentOriginalItem). */
VB.resolveBatchOriginal = function (index, jobId, docFullName, docName) {
  try {
    index = parseInt(index, 10);
    if (!isFinite(index) || index < 0) return VB.toJSON({ ok: false, error: "badArgs" });
    if (app.documents.length === 0) return VB.toJSON({ ok: false, error: "noDocument" });
    var doc = app.activeDocument;
    var df = ""; var dn = "";
    try { df = String(doc.fullName); } catch (e0) { df = ""; }
    try { dn = String(doc.name); } catch (e1) { dn = ""; }
    if (docFullName && df && String(docFullName) !== df) return VB.toJSON({ ok: false, error: "docChanged" });
    if (!docFullName && docName && dn && String(docName) !== dn) return VB.toJSON({ ok: false, error: "docChanged" });
    var batch = VB._batch || {};
    var jid = (jobId != null && String(jobId) !== "") ? String(jobId) : String(batch.jobId || "");
    var src = null;
    if (jid && String(batch.jobId || "") === jid) {
      var refs = VB._batchItems || [];
      src = refs[index] || null;
      if (!VB._usableBatchItem(src)) src = null;
    }
    if (!src && jid) src = VB._findBatchItemByTag(doc, jid, index);
    if (!VB._usableBatchItem(src)) return VB.toJSON({ ok: false, error: "batchItemInvalid" });
    VB._currentOriginalItem = src;
    VB._originalItems = [];
    return VB.toJSON({ ok: true, index: index, jobId: jid, typename: src.typename });
  } catch (e) {
    VB.log("resolveBatchOriginal error: " + e);
    return VB.toJSON({ ok: false, error: String(e) });
  }
};
VB.exportBatchItem = function (index, pngLongSide) {
  var tempDoc = null;
  var doc = null;
  var src = null;
  try {
    index = parseInt(index, 10);
    if (!isFinite(index) || index < 0) return VB.toJSON({ ok: false, error: "badArgs" });
    var batch = VB._batch || {};
    var refs = VB._batchItems || [];
    src = refs[index] || null;
    if (app.documents.length === 0) return VB.toJSON({ ok: false, error: "noDocument" });
    doc = app.activeDocument;
    if (!VB.isDocEditable(doc)) return VB.toJSON({ ok: false, error: "documentLocked" });
    var docFullName = ""; var docName = "";
    try { docFullName = String(doc.fullName); } catch (e0) { docFullName = ""; }
    try { docName = String(doc.name); } catch (e1) { docName = ""; }
    if (batch.docFullName && docFullName && batch.docFullName !== docFullName) return VB.toJSON({ ok: false, error: "docChanged" });
    if (!batch.docFullName && batch.docName && docName && batch.docName !== docName) return VB.toJSON({ ok: false, error: "docChanged" });

    function usable(it) {
      if (!it) return false;
      try { if (typeof it.isValid !== "undefined" && !it.isValid) { /* fall through to typename probe */ } } catch (e) {}
      try { var tn = String(it.typename || ""); if (tn) return true; } catch (e2) {}
      return false;
    }

    if (!usable(src)) src = null;
    if (!src) src = VB._findBatchItemByTag(doc, batch.jobId, index);
    if (!usable(src)) src = null;
    if (!src) {
      // fallbacks: tagged list order, then current selection, then pageItems scan of same typename+approx bounds impossible cheaply
      try {
        var tagged = [];
        var markerPrefix = "VB_BATCH=" + String(batch.jobId) + ":";
        var all = doc.pageItems;
        for (var pi = 0; pi < all.length; pi++) {
          try {
            var pit = all[pi]; var pn = "";
            try { pn = String(pit.note || ""); } catch (ne) { pn = ""; }
            if (pn.indexOf(markerPrefix) === 0) tagged.push(pit);
          } catch (pe) {}
        }
        if (tagged[index] && usable(tagged[index])) src = tagged[index];
      } catch (te) {}
    }
    if (!usable(src)) {
      try { if (doc.selection && doc.selection.length === 1 && usable(doc.selection[0])) src = doc.selection[0]; } catch (se) {}
    }
    if (!usable(src)) {
      VB.log("exportBatchItem " + index + " cannot resolve source (job=" + batch.jobId + ")");
      return VB.toJSON({ ok: false, error: "batchItemInvalid" });
    }

    var size = parseInt(pngLongSide, 10);
    if (!isFinite(size)) size = (batch.pngLongSide != null) ? batch.pngLongSide : 1700;
    if (size !== 0) { if (size < 100) size = 1700; if (size > 5000) size = 5000; }

    var union = VB.itemBox(src);
    if (!union || !(union.width > 0.01) || !(union.height > 0.01)) return VB.toJSON({ ok: false, error: "emptyBounds" });

    VB.ensureBridgeFolder();
    var bf = new Folder(VB.getBridgeFolderPath());
    if (!bf.exists) bf.create();
    // Unique per job+index: two batches in flight must never delete or overwrite the
    // PNG another agent run is still uploading.
    var pngFile = new File(bf.fsName + "/vectorizer_export_batch_" + String(batch.jobId || "job") + "_" + index + ".png");
    if (pngFile.exists) pngFile.remove();

    tempDoc = app.documents.add();
    if (!tempDoc) return VB.toJSON({ ok: false, error: "duplicateFailed" });
    var dupOk = false;
    try { src.duplicate(tempDoc, ElementPlacement.PLACEATBEGINNING); dupOk = true; } catch (dupErr1) {
      try { src.duplicate(tempDoc); dupOk = true; } catch (dupErr2) {
        VB.log("exportBatchItem duplicate error " + index + " (" + src.typename + "): " + dupErr1 + " / " + dupErr2);
      }
    }
    if (!dupOk || tempDoc.pageItems.length === 0) return VB.toJSON({ ok: false, error: "duplicateFailed" });
    try { app.activeDocument = tempDoc; } catch (actErr) { }

    var tempBounds = [];
    for (var k = 0; k < tempDoc.pageItems.length; k++) {
      try { tempBounds.push(VB.itemBox(tempDoc.pageItems[k])); } catch (tbErr) { }
    }
    var tempUnion = VB.unionBounds(tempBounds);
    if (!tempUnion || !(tempUnion.width > 0.01) || !(tempUnion.height > 0.01)) tempUnion = union;
    if (!VB.fitArtboard(tempDoc, tempUnion)) return VB.toJSON({ ok: false, error: "artboardFailed" });

    var exportOpts = new ExportOptionsPNG24();
    exportOpts.antiAliasing = true;
    exportOpts.transparency = true;
    exportOpts.artBoardClipping = true;
    var longSidePts = Math.max(tempUnion.width, tempUnion.height);
    var resolution = 72;
    if (size === 0) resolution = 72;
    else { var longSideInches = longSidePts / 72; resolution = longSideInches > 0 ? Math.round(size / longSideInches) : 72; }
    if (!isFinite(resolution) || resolution < 1) resolution = 72;
    if (resolution > 2400) resolution = 2400;
    exportOpts.resolution = resolution;
    tempDoc.exportFile(pngFile, ExportType.PNG24, exportOpts);
    if (!pngFile.exists || pngFile.length < 10) return VB.toJSON({ ok: false, error: "exportFailed" });

    VB._currentOriginalItem = src;
    VB._exportDocFullName = docFullName;
    VB._exportDocName = docName;
    VB.log("exportBatchItem " + index + " done (" + src.typename + "): " + pngFile.fsName);
    return VB.toJSON({ ok: true, pngPath: pngFile.fsName, union: union, docFullName: docFullName, docName: docName, index: index, jobId: String(batch.jobId||""), resolution: resolution });
  } catch (e) {
    VB.log("exportBatchItem error: " + e);
    return VB.toJSON({ ok: false, error: String(e) });
  } finally {
    if (tempDoc) { try { tempDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (ce) { } }
    try { if (doc) app.activeDocument = doc; } catch (ae) { }
  }
};
