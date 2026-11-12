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
    /* Clear markers left by a previous run before tagging this one: a cancelled or
       crashed batch never reached the end, and its notes would otherwise stay
       prefixed (and pile up) forever. */
    try { VB.restoreBatchNotes(); } catch (rbE) { }
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
        /* Peel off markers from earlier batches so the note neither grows one
           "VB_BATCH=job:i|" prefix per run nor leaks our bookkeeping into a field
           the user and other scripts own. The clean text is put back by
           VB.restoreBatchNotes(). */
        var originalNote = oldNote;
        while (originalNote.indexOf("VB_BATCH=") === 0) {
          var pipe = originalNote.indexOf("|");
          if (pipe < 0) { originalNote = ""; break; }
          originalNote = originalNote.substring(pipe + 1);
        }
        if (oldNote.indexOf("VB_BATCH=" + jobId + ":") === 0) {
          var headEnd = oldNote.indexOf("|");
          marker = headEnd >= 0 ? oldNote.substring(0, headEnd) : oldNote;
        } else {
          try { it.note = marker + (originalNote ? ("|" + originalNote) : ""); } catch (snE) {}
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
        meta.push({ marker: marker, noteHad: originalNote });
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

/* Put the user's own note text back once a batch is over. Called when the panel
   finishes a batch and before the next one tags anything, so no run leaves its
   bookkeeping in the document. */
VB.restoreBatchNotes = function (jobId) {
  var restored = 0;
  try {
    var jid = (jobId != null) ? String(jobId) : "";
    var batch = VB._batch || {};
    var meta = batch.meta || [];
    var sameJob = !jid || String(batch.jobId || "") === jid;
    var refs = VB._batchItems || [];
    for (var i = 0; i < refs.length; i++) {
      try {
        var it = refs[i];
        if (!it) continue;
        var note = String(it.note || "");
        if (note.indexOf("VB_BATCH=") !== 0) continue;
        var pipe = note.indexOf("|");
        var rest = pipe >= 0 ? note.substring(pipe + 1) : "";
        var wanted = (sameJob && meta[i] && typeof meta[i].noteHad === "string") ? meta[i].noteHad : rest;
        it.note = wanted;
        restored++;
      } catch (e) { }
    }
    /* After a panel reload _batchItems is gone but the document keeps the markers. */
    if (app.documents.length > 0) {
      var doc = app.activeDocument;
      var all = doc.pageItems;
      for (var k = 0; k < all.length; k++) {
        try {
          var p = all[k];
          var pn = String(p.note || "");
          if (pn.indexOf("VB_BATCH=") !== 0) continue;
          var bar = pn.indexOf("|");
          p.note = bar >= 0 ? pn.substring(bar + 1) : "";
          restored++;
        } catch (e2) { }
      }
    }
  } catch (e3) { }
  return VB.toJSON({ ok: true, restored: restored });
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
/* jobId is optional and comes from prepareBatch's reply. When the panel sends it,
   an export belonging to another window's batch is refused instead of exporting
   whatever that other batch happened to select. */
VB.exportBatchItem = function (index, pngLongSide, jobId) {
  var tempDoc = null;
  var doc = null;
  var src = null;
  try {
    index = parseInt(index, 10);
    if (!isFinite(index) || index < 0) return VB.toJSON({ ok: false, error: "badArgs" });
    var batch = VB._batch || {};
    var refs = VB._batchItems || [];
    if (jobId != null && String(jobId) !== "" && String(batch.jobId || "") !== String(jobId)) {
      VB.log("exportBatchItem " + index + " refused: another batch started (" + batch.jobId + " != " + jobId + ")");
      return VB.toJSON({ ok: false, error: "batchChanged" });
    }
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
    /* No "whatever is selected now" fallback: during a parallel batch that
       exported an unrelated object and placed it over a different one, silently. */
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
    // Budget the export in pixels, not only in long side: "Original (1 px/pt)" on a large
    // artboard used to produce a 100+ megapixel PNG that vectorizer.ai will not vectorize
    // (it opens its pre-crop size dialog instead, and the item ends as "no download").
    var fit = VB.exportResolution(size, tempUnion.width, tempUnion.height);
    exportOpts.resolution = fit.resolution;
    tempDoc.exportFile(pngFile, ExportType.PNG24, exportOpts);
    if (!pngFile.exists || pngFile.length < 10) return VB.toJSON({ ok: false, error: "exportFailed" });
    // A 3 megapixel PNG can still be large if it is noisy; the site's limit is 30 MB.
    var byteGuard = 0;
    while (pngFile.length > VB.MAX_INPUT_BYTES && fit.resolution > 8 && byteGuard < 3) {
      byteGuard++;
      fit.resolution = Math.max(8, Math.floor(fit.resolution * 0.7));
      exportOpts.resolution = fit.resolution;
      try { pngFile.remove(); } catch (rmE) { }
      tempDoc.exportFile(pngFile, ExportType.PNG24, exportOpts);
    }
    if (!pngFile.exists || pngFile.length < 10) return VB.toJSON({ ok: false, error: "exportFailed" });
    VB.log("exportBatchItem " + index + " resolution=" + fit.resolution + " px=" + fit.pixels + (fit.capped ? " (capped by " + VB.MAX_INPUT_PIXELS + " px budget)" : ""));

    VB._currentOriginalItem = src;
    VB._exportDocFullName = docFullName;
    VB._exportDocName = docName;
    VB.log("exportBatchItem " + index + " done (" + src.typename + "): " + pngFile.fsName);
    return VB.toJSON({ ok: true, pngPath: pngFile.fsName, union: union, docFullName: docFullName, docName: docName, index: index, jobId: String(batch.jobId||""), resolution: fit.resolution, megapixels: fit.megapixels || 0, pixelCapped: !!fit.capped });
  } catch (e) {
    VB.log("exportBatchItem error: " + e);
    return VB.toJSON({ ok: false, error: String(e) });
  } finally {
    if (tempDoc) { try { tempDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (ce) { } }
    try { if (doc) app.activeDocument = doc; } catch (ae) { }
  }
};
