/* Vectorizer Bridge — Flow image import (raster). */
var VB = $.global.VB;

VB.importImage = function (filePath, layerName) {
  try {
    var f = new File(filePath);
    if (!f.exists) return VB.toJSON({ ok: false, error: "fileNotFound" });
    if (app.documents.length === 0) return VB.toJSON({ ok: false, error: "noDocument" });
    var doc = app.activeDocument;
    if (!VB.isDocEditable(doc)) return VB.toJSON({ ok: false, error: "documentLocked" });
    
    var placed = doc.placedItems.add();
    placed.file = f;
    placed.embed();
    
    try {
      var layer = doc.layers.getByName(layerName);
      placed.move(layer, ElementPlacement.PLACEATEND);
    } catch (e) {
      var newLayer = doc.layers.add();
      newLayer.name = layerName;
      placed.move(newLayer, ElementPlacement.PLACEATEND);
    }
    
    return VB.toJSON({ ok: true, message: "Image placed on " + layerName });
  } catch (e) {
    return VB.toJSON({ ok: false, error: String(e) });
  }
};