/* Illustrator-side watcher.
   ExtendScript cannot call into the panel, so the panel registers for the CSXS event this
   file dispatches. A scheduled task compares a cheap signature and only fires when it
   changes, which costs far less than the panel polling evalScript every second.

   Loaded from js/bridge/host.js. Keep this file ES3-compatible. */
if (typeof VB === 'undefined') { VB = {}; }
VB.watch = VB.watch || {};

VB.watch._task = null;
VB.watch._plugin = null;
VB.watch._last = null;
/* The panel and the floating window are two CEP extensions sharing this script engine,
   so they share one scheduled task. Counting the listeners stops the last window to
   close from cancelling the updates the other window still needs. */
VB.watch._refs = 0;

/* PlugPlugExternalObject is what gives ExtendScript the CSXSEvent class. It is created once
   because constructing it per tick is measurably slow. */
VB.watch._dispatch = function (type, data) {
  try {
    if (!VB.watch._plugin) VB.watch._plugin = new ExternalObject('lib:PlugPlugExternalObject');
    var ev = new CSXSEvent();
    ev.type = type;
    ev.data = String(data);
    ev.dispatch();
    return true;
  } catch (e) {
    return false;
  }
};

VB.watch.payload = function () {
  try {
    if (!app.documents || app.documents.length === 0) return VB.toJSON({ doc: '', sel: 0, open: false });
    var doc = app.activeDocument;
    var count = 0;
    try { count = doc.selection ? doc.selection.length : 0; } catch (eSel) { count = 0; }
    return VB.toJSON({ doc: String(doc.name || ''), sel: count, open: true });
  } catch (e) {
    return VB.toJSON({ doc: '', sel: 0, open: false });
  }
};

VB.watch.tick = function () {
  try {
    var payload = VB.watch.payload();
    if (payload === VB.watch._last) return 'same';
    VB.watch._last = payload;
    VB.watch._dispatch('vb.selectionChanged', payload);
    return 'sent';
  } catch (e) {
    return 'error';
  }
};

/* 500 ms is the compromise: dragging a selection marquee finishes well inside a frame or
   two of that, and the task itself is a couple of property reads, not a document scan. */
VB.watch.start = function () {
  try {
    VB.watch._refs = (VB.watch._refs || 0) + 1;
    if (VB.watch._task) return 'ok';
    VB.watch._last = null;
    VB.watch._task = app.scheduleTask('VB.watch.tick()', 500, true);
    VB.watch.tick();
    return 'ok';
  } catch (e) {
    VB.watch._refs = Math.max(0, (VB.watch._refs || 1) - 1);
    VB.watch._task = null;
    return 'error: ' + e;
  }
};

VB.watch.stop = function () {
  VB.watch._refs = Math.max(0, (VB.watch._refs || 0) - 1);
  /* Another window is still listening: keep the task running. */
  if (VB.watch._refs > 0) return 'ok';
  try { if (VB.watch._task) app.cancelTask(VB.watch._task); } catch (e) { }
  VB.watch._task = null;
  VB.watch._last = null;
  return 'ok';
};

VB.watch.status = function () {
  return VB.toJSON({ running: !!VB.watch._task, last: VB.watch._last, refs: VB.watch._refs || 0 });
};
