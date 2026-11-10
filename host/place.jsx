/* Vectorizer Bridge Ã¢â‚¬â€ place the downloaded SVG over the original artwork.
   The SVG is placed on its own "Vectorizer" layer, fitted to the exported
   selection's bounds, and selected. Uses groupItems.createFromFile() since
   Illustrator cannot place SVGs as linked items via placedItems.add().
   Only the item created by this call is removed on failure. */

var VB = $.global.VB;

VB.placeSVG = function (encodedArgs) {
  var args;
  try {
    args = VB.fromJSON(decodeURIComponent(String(encodedArgs)));
  } catch (parseErr) {
    VB.log("placeSVG bad args: " + parseErr);
    return VB.toJSON({ ok: false, error: "badArgs" });
  }

  var svgPath = args.svgPath;
  var union = args.union;
  var layerName = args.layerName || "Vectorizer";
  var hideOriginal = !!args.hideOriginal;
  var allowAnyDoc = !!args.allowAnyDoc;
  var batchIndex = (args.batchIndex !== undefined && args.batchIndex !== null) ? parseInt(args.batchIndex, 10) : NaN;
  var batchJobId = (args.batchJobId != null) ? String(args.batchJobId) : "";
  var docFullName = args.docFullName || "";
  var docName = args.docName || "";

  var doc = null;
  var layer = null;
  var createdLayer = false;
  var placed = null;
  var item = null;
  var touched = 0;

  try {
    VB.log("placeSVG start: " + svgPath + " hide=" + hideOriginal);

    if (app.documents.length === 0) {
      return VB.toJSON({ ok: false, error: "noDocument" });
    }

    doc = app.activeDocument;

    // The panel remembers which document was exported. If the user switched
    // documents, do not silently paste into the wrong file. History/manual
    // place may target any open document (allowAnyDoc) and fits to artboard.
    var sameDoc = true;
    if (!allowAnyDoc && (docFullName || docName)) {
      sameDoc = false;
      if (docFullName) {
        try { sameDoc = String(doc.fullName) === docFullName; } catch (e1) { sameDoc = false; }
      } else if (docName) {
        try { sameDoc = String(doc.name) === docName; } catch (e2) { sameDoc = false; }
      }
    }
    if (!sameDoc) {
      return VB.toJSON({ ok: false, error: "docChanged" });
    }

    if (!VB.isDocEditable(doc)) {
      return VB.toJSON({ ok: false, error: "documentLocked" });
    }

    var file = new File(svgPath);
    if (!file.exists) {
      return VB.toJSON({ ok: false, error: "fileNotFound" });
    }

    // Give the OS a moment to release the file handle from the Node agent.
    // Short backoff: 10 x 150ms = 1.5s cap (was 5 x 500ms = 2.5s).
    var retryCount = 0;
    var retryMax = 10;
    while (retryCount < retryMax) {
      try {
        file.open("r");
        file.close();
        break;
      } catch (e) {
        retryCount++;
        VB.log("placeSVG: file busy, retrying " + retryCount + "/" + retryMax);
        $.sleep(150);
      }
    }

    // Pre-flight: the SVG must actually be an SVG.
    try {
      file.open("r");
      var head = file.read();
      file.close();
    } catch (readErr) {
      try { file.close(); } catch (e2) { }
      return VB.toJSON({ ok: false, error: "fileUnreadable" });
    }
    if (!/<svg/i.test(head) && !/<\?xml/i.test(head)) {
      VB.log("placeSVG: not an SVG, head=" + head.slice(0, 40));
      return VB.toJSON({ ok: false, error: "badSvgFile" });
    }

    // History/manual place may omit bounds: fit to active artboard.
    if (!union || !(union.width > 0) || !(union.height > 0)) {
      try {
        var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()];
        var r = ab.artboardRect; // [left, top, right, bottom]
        union = { left: Number(r[0]), top: Number(r[1]), width: Number(r[2]) - Number(r[0]), height: Number(r[1]) - Number(r[3]) };
      } catch (abE) { union = null; }
    }
    if (!union || !(union.width > 0) || !(union.height > 0)) {
      return VB.toJSON({ ok: false, error: "badBounds" });
    }

    // Find or create the dedicated layer.
    for (var i = 0; i < doc.layers.length; i++) {
      if (doc.layers[i].name === layerName) {
        layer = doc.layers[i];
        break;
      }
    }
    if (!layer) {
      layer = doc.layers.add();
      layer.name = layerName;
      createdLayer = true;
    }
    if (layer.locked) {
      return VB.toJSON({ ok: false, error: "layerLocked" });
    }
    if (!layer.visible) {
      layer.visible = true;
      VB.log("placeSVG: made hidden layer visible: " + layerName);
    }

    // Place directly on our layer so no other layer is modified.
    //
    // groupItems.createFromFile() is the PRIMARY path: it imports the SVG as
    // editable vector artwork (paths/strokes), which is exactly what we need to
    // replace the original selection. Illustrator's placedItems.add() instead
    // places the SVG as a *linked* PlacedItem, and its embed() throws error 129
    // when the SVG contains vector-effect="non-scaling-stroke" (which
    // vectorizer.ai always emits). A linked PlacedItem cannot be fitted or
    // edited, so that path can only be a last resort.
    //
    // Order: createFromFile -> placedItems.add()+embed() -> keep linked item.
    var embedFailed = false;
    var usedCreateFromFile = false;

    // AI 2026's ExtendScript expects a File object for createFromFile in some
    // builds and a path string in others; try File first, then path.
    try {
      item = layer.groupItems.createFromFile(file);
      usedCreateFromFile = true;
      VB.log("placeSVG: created SVG via groupItems.createFromFile(File)");
    } catch (createErr1) {
      try {
        item = layer.groupItems.createFromFile(file.fsName);
        usedCreateFromFile = true;
        VB.log("placeSVG: created SVG via groupItems.createFromFile(path)");
      } catch (createErr2) {
        VB.log("placeSVG createFromFile failed (File: " + createErr1 + "; path: " + createErr2 + "), trying placedItems.add");
        var placed = null;
        try {
          placed = layer.placedItems.add(file, [union.left, union.top]);
        } catch (addErr) {
          VB.log("placeSVG placedItems.add failed: " + addErr);
          return VB.toJSON({ ok: false, error: "svgImportFailed" });
        }
        if (!placed) {
          return VB.toJSON({ ok: false, error: "placeFailed" });
        }
        item = placed;
        try {
          var embedded = placed.embed();
          if (embedded && embedded.typename) {
            item = embedded;
          } else if (embedded && embedded.length) {
            item = embedded[embedded.length - 1];
          } else if (layer.pageItems.length > 0) {
            item = layer.pageItems[layer.pageItems.length - 1];
          }
        } catch (embedErr) {
          VB.log("placeSVG embed failed, keeping placed link: " + embedErr);
          embedFailed = true;
          item = placed;
        }
      }
    }

    if (!item) {
      return VB.toJSON({ ok: false, error: "placeFailed" });
    }

    // Fit to the original selection's box, preserving the SVG aspect ratio
    // and centering it. Set top last because Y grows upward.
    try {
      var targetRatio = union.width / union.height;
      var actualRatio = item.width / item.height;
      if (actualRatio > targetRatio) {
        item.width = union.width;
        item.height = union.width / actualRatio;
      } else {
        item.height = union.height;
        item.width = union.height * actualRatio;
      }
      item.left = union.left + (union.width - item.width) / 2;
      item.top = union.top - (union.height - item.height) / 2;
    } catch (fitErr) {
      VB.log("placeSVG fit error: " + fitErr);
    }

    try {
      item.selected = true;
      doc.selection = [item];
    } catch (selectErr) {
      VB.log("placeSVG select error: " + selectErr);
    }

    if (hideOriginal) {
      if (isFinite(batchIndex) && batchIndex >= 0) {
        var bsrc = null;
        try {
          var bjid = batchJobId || String((VB._batch && VB._batch.jobId) || "");
          if (bjid) bsrc = VB._findBatchItemByTag ? VB._findBatchItemByTag(doc, bjid, batchIndex) : null;
        } catch (bfE) { bsrc = null; }
        if (!bsrc) {
          try { if (VB._batch && VB._batchItems && VB._batchItems[batchIndex]) bsrc = VB._batchItems[batchIndex]; } catch (brE) { bsrc = null; }
        }
        try { if (bsrc && (typeof bsrc.isValid === "undefined" || bsrc.isValid)) { bsrc.hidden = true; touched++; } } catch (bhE) { VB.log("hide batch original " + batchIndex + " error: " + bhE); }
      } else {
        var orig = VB._originalItems || [];
        for (var k = 0; k < orig.length; k++) {
          try {
            var it = orig[k];
            if (it && (typeof it.isValid === "undefined" || it.isValid)) { it.hidden = true; touched++; }
          } catch (hideErr) { VB.log("hide original " + k + " error: " + hideErr); }
        }
        VB._originalItems = [];
        if (VB._currentOriginalItem) {
          try {
            var cit = VB._currentOriginalItem;
            if (cit && (typeof cit.isValid === "undefined" || cit.isValid)) { cit.hidden = true; touched++; }
          } catch (hideCErr) { VB.log("hide current original error: " + hideCErr); }
          VB._currentOriginalItem = null;
        }
      }
    }

    VB.log("placeSVG done (touched=" + touched + ", embedded=" + (!embedFailed) + ", createFromFile=" + usedCreateFromFile + ")");
    return VB.toJSON({
      ok: true,
      touched: touched,
      layer: layer.name,
      itemType: item.typename,
      embedded: !embedFailed
    });
  } catch (e) {
    VB.log("placeSVG error: " + e);
    // Remove ONLY what this call added; never wipe the whole layer.
    try { if (item && item.isValid) item.remove(); } catch (cleanupErr1) { }
    try { if (placed && placed.isValid) placed.remove(); } catch (cleanupErr2) { }
    try {
      if (createdLayer && layer && layer.pageItems.length === 0) layer.remove();
    } catch (layerErr) { }
    return VB.toJSON({ ok: false, error: String(e) });
  }
};

