/* Gemini in Chrome — browser-assisted image editing.

   Why not the API: Google AI Plus benefits live in the consumer Gemini app, not
   in paid Gemini API quota, so this module never calls an API, never holds a key
   and never drives Gemini's page. It does the local half of the job:

     select artwork -> export a source PNG -> open gemini.google.com in Chrome
     -> the user generates and downloads there -> pick the file -> place it

   Nothing here needs a key, an account or a bill. */
(function () {
  "use strict";
  var VB = window.VBPanel = window.VBPanel || {};
  var core = VB.core || (VB.core = {});
  var bridge = VB.bridge || (VB.bridge = {});
  var aiImage = VB.aiImage = VB.aiImage || {};

  var GEMINI_URL = "https://gemini.google.com/app";
  var LAYER_NAME = "Gemini Image";
  /* Base64 of a very large PNG is slower than letting the browser read the file
     itself, and the source preview only needs to be recognisable. */
  var MAX_INLINE_PREVIEW = 8 * 1024 * 1024;

  var busy = false;
  var inited = false;
  var autoPicked = false;   /* the result came from the watcher, not the button */
  /* The host handshake is asynchronous (vectorizer.init -> bridge.loadHost), so
     this module always boots before Illustrator answers. */
  var HOST_WAIT_MS = 250;
  var HOST_TRIES = 120;   /* ~30 s, then admit there is no host */
  var waitingNote = false;
  var source = null;   /* { id, path, name, bytes, width, height, union, docName, docFullName, resultsFolder } */
  var result = null;   /* { path, name, kind, bytes } */

  function $(id) { return document.getElementById(id); }

  function txt(key, fallback) {
    try { var v = core.t(key); if (v && v !== key) return v; } catch (e) { }
    return fallback;
  }

  function hostString(res) {
    var s = String(res == null ? "" : res);
    if (s.length > 1 && s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') s = s.slice(1, -1);
    return s;
  }

  function hostJson(res) {
    var parsed = null;
    try { parsed = JSON.parse(hostString(res) || ""); } catch (e) { parsed = null; }
    if (!parsed) return { ok: false, error: "badResponse" };
    return parsed;
  }

  /* ---- status ---------------------------------------------------------- */

  function setStatus(message, tone) {
    var el = $("aiImgStatus");
    if (!el) return;
    el.textContent = message || "";
    el.className = "hint aiImgStatus" + (tone ? " " + tone : "");
  }

  /* Host error codes reuse the panel's existing translations where they exist
     (noSelection, documentLocked, fileNotFound); the rest are ours. */
  function errorText(r) {
    var code = String((r && r.error) || "");
    var key = {
      unsupportedImage: "aiImgUnsupported",
      badResponse: "aiImgBadResponse",
      fileNotFound: "errorFileNotFound",
      fileUnreadable: "errorFileUnreadable",
      noDocument: "errorNoDocument",
      noSelection: "errorNoSelection",
      documentLocked: "errorDocumentLocked",
      layerLocked: "errorLayerLocked",
      placeFailed: "errorPlaceFailed",
      docChanged: "errorDocChanged"
    }[code];
    var text = key ? txt(key, "") : "";
    if (text) return text;
    if (bridge.friendlyError) {
      try { var f = bridge.friendlyError(code); if (f && f !== code) return f; } catch (e) { }
    }
    return code || txt("aiImgBadResponse", "Something went wrong.");
  }

  var BUTTONS = ["aiImgUseSelection", "aiImgOpen", "aiImgCopy", "aiImgPick", "aiImgPlace", "aiImgResultsFolder", "aiImgShowSource"];
  /* Buttons that act on something: the exported source, or the chosen result. */
  var NEEDS_SOURCE = { aiImgOpen: 1, aiImgCopy: 1, aiImgShowSource: 1 };
  var NEEDS_RESULT = { aiImgPlace: 1 };

  /* One rule for all of them: enabled only when Illustrator answers, nothing is
     running, and this button's own subject exists. */
  function syncButtons() {
    for (var i = 0; i < BUTTONS.length; i++) {
      var el = $(BUTTONS[i]);
      if (!el) continue;
      var subject = NEEDS_RESULT[el.id] ? result : NEEDS_SOURCE[el.id] ? source : true;
      el.disabled = busy || !bridge.hostOk || !subject;
    }
  }

  function setBusy(on) {
    busy = !!on;
    syncButtons();
  }

  /* ---- images ---------------------------------------------------------- */

  function extKind(name) {
    var m = /\.([a-z0-9]+)$/i.exec(String(name || ""));
    var ext = m ? m[1].toLowerCase() : "";
    if (ext === "png") return "png";
    if (ext === "jpg" || ext === "jpeg") return "jpeg";
    if (ext === "webp") return "webp";
    return "";
  }

  function mime(kind) {
    if (kind === "jpeg") return "image/jpeg";
    if (kind === "webp") return "image/webp";
    return "image/png";
  }

  function fileUrl(path) {
    var p = String(path || "").replace(/\\/g, "/");
    if (p.charAt(0) !== "/") p = "/" + p;
    return "file://" + encodeURI(p);
  }

  /* CEP can read a local file into a data URL, which is the reliable way to show
     a preview at any path; the file:// URL is the fallback when cep.fs is
     unavailable (plain browser, or a file the API would not read). */
  function previewSrc(path, kind, bytes) {
    if (bytes && bytes > MAX_INLINE_PREVIEW) return fileUrl(path);
    try {
      var fsApi = window.cep && window.cep.fs;
      var enc = (window.cep && window.cep.encoding && window.cep.encoding.Base64) || "Base64";
      if (fsApi && fsApi.readFile) {
        var r = fsApi.readFile(path, enc);
        if (r && r.err === 0 && r.data) return "data:" + mime(kind) + ";base64," + r.data;
      }
    } catch (e) { }
    return fileUrl(path);
  }

  function humanSize(bytes) {
    var n = Number(bytes) || 0;
    if (!n) return "";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
    return (Math.round(n / (1024 * 1024) * 10) / 10) + " MB";
  }

  function showImage(prefix, file, kind) {
    var img = $(prefix + "Preview");
    var empty = $(prefix + "Empty");
    if (!img) return;
    if (!file || !file.path) {
      img.removeAttribute("src");
      img.hidden = true;
      if (empty) empty.hidden = false;
      return;
    }
    var src = previewSrc(file.path, kind || file.kind || extKind(file.name), file.bytes);
    if (src) img.setAttribute("src", src);
    img.hidden = false;
    if (empty) empty.hidden = true;
  }

  /* ---- clipboard ------------------------------------------------------- */

  /* navigator.clipboard is not always granted inside CEP, so the older
     execCommand path stays as the fallback; both are plain user-initiated
     copies of our own text, nothing is read back. */
  function legacyCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { ta.setSelectionRange(0, text.length); } catch (selErr) { }
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (cmdErr) { ok = false; }
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) { return false; }
  }

  function copyText(text, done) {
    var value = String(text || "");
    if (!value) return done(false);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value).then(function () { done(true); }, function () { done(legacyCopy(value)); });
        return;
      }
    } catch (e) { }
    done(legacyCopy(value));
  }

  /* ---- prompt ---------------------------------------------------------- */

  function promptValue() {
    var el = $("aiImgPrompt");
    return String((el && el.value) || "");
  }

  function templateValue() {
    var el = $("aiImgTemplate");
    return String((el && el.value) || "");
  }

  var TEMPLATES = {
    product: "aiImgTplProductText",
    background: "aiImgTplBackgroundText",
    photo: "aiImgTplPhotoText",
    general: "aiImgTplGeneralText"
  };

  function applyTemplate() {
    var name = templateValue();
    var el = $("aiImgPrompt");
    if (!el || !TEMPLATES[name]) return;
    var text = txt(TEMPLATES[name], "");
    if (!text) return;
    var current = String(el.value || "");
    el.value = current ? (current + "\n" + text) : text;
    try { el.focus(); } catch (e) { }
  }

  function saveRequest() {
    if (!source || !bridge.hostOk) return;
    var payload = {
      id: source.id,
      app: "mockup-studio",
      doc: source.docName || "",
      source: source.path,
      width: source.width || 0,
      height: source.height || 0,
      prompt: promptValue(),
      template: templateValue(),
      createdAt: new Date().toISOString()
    };
    bridge.evalJsx('VB.saveGeminiRequest ? VB.saveGeminiRequest(' + core.jsxString(JSON.stringify(payload)) + ') : ""', function () { });
  }

  function pngSize() {
    var size = 1700;
    try {
      var v = parseInt(core.state.settings.pngLongSide, 10);
      if (isFinite(v)) size = v;
    } catch (e) { }
    /* "Original (1 px/pt)" is a vectorizer convenience; an untouched-resolution
       PNG is far larger than an AI model needs, so fall back to the balanced size. */
    if (!size) size = 1700;
    return size;
  }

  /* ---- actions --------------------------------------------------------- */

  function useSelection() {
    if (busy) return;
    /* A new export ends the previous request: a watch armed for the old artwork
       would fit its download to this selection and report it as this one's. */
    stopWatch();
    if (!bridge.hostOk) return setStatus(txt("aiImgNoHost", "Open the panel inside Illustrator."), "bad");
    setBusy(true);
    setStatus(txt("aiImgPreparing", "Exporting the selection…"));
    bridge.evalJsx("VB.prepareGeminiSource(" + pngSize() + ")", function (res) {
      setBusy(false);
      var r = hostJson(res);
      if (!r.ok) return setStatus(errorText(r), "bad");
      source = r;
      var name = $("aiImgSourceName");
      if (name) name.textContent = r.name || "";
      var meta = $("aiImgSourceMeta");
      if (meta) {
        var bits = [];
        if (r.width && r.height) bits.push(Math.round(r.width) + "×" + Math.round(r.height) + " pt");
        if (r.bytes) bits.push(humanSize(r.bytes));
        if (r.docName) bits.push(r.docName);
        meta.textContent = bits.join(" · ");
      }
      showImage("aiImgSource", { path: r.path, name: r.name, bytes: r.bytes }, "png");
      /* Sync AFTER the source exists, or Open Gemini / Copy / Show file stay
         disabled and the workflow has no way forward. */
      syncButtons();
      saveRequest();
      setStatus(txt("aiImgSourceReady", "Source ready. Open Gemini, upload this file and paste the prompt."), "ok");
    });
  }

  function openGemini() {
    if (!source) return setStatus(txt("aiImgSelectFirst", "Choose the artwork first."), "bad");
    if (!bridge.hostOk) return setStatus(txt("aiImgNoHost", "Open the panel inside Illustrator."), "bad");
    saveRequest();
    var requested = promptValue();
    copyText(requested, function (copied) {
      bridge.evalJsx('VB.openGeminiWindow ? VB.openGeminiWindow(' + core.jsxString(GEMINI_URL) + ') : ""', function (res) {
        var r = hostJson(res);
        if (!r.ok) return setStatus(errorText(r), "bad");
        var parts = [txt("aiImgGeminiOpened", "Gemini is open in Chrome.")];
        /* Only talk about the clipboard when there was something to copy: an
           empty prompt is not a clipboard failure. */
        if (requested)
          parts.push(copied ? txt("aiImgPromptCopied", "The prompt is on your clipboard.")
            : txt("aiImgCopyFailed", "Copy the prompt with the button below."));
        if (r.via !== "chrome") parts.push(txt("aiImgNoChrome", "Chrome was not found, so the link opened in the default browser."));
        /* Where the download has to go is the one thing that must not be missed,
           so it is the last thing said — and the folder is opened below, because
           an Explorer window beats a status line nobody reads. The upload step is
           not repeated here: the hint at the top of this block already says it. */
        if (source && source.resultsFolder) {
          var hint = txt("aiImgSaveInto", "Save the download into {path} — the panel picks it up from there.");
          if (hint.indexOf("{path}") >= 0) hint = hint.split("{path}").join(source.resultsFolder);
          parts.push(hint);
        } else {
          parts.push(txt("aiImgAwaiting", "Upload the source with “Show file”, generate, and save the image into the results folder."));
        }
        setStatus(parts.join(" "), r.via === "chrome" ? "ok" : "");
        openResultsFolder();
        refreshResults();
        /* The return leg: wait for the download instead of asking for it twice. */
        startWatch();
      });
    });
  }

  function copyPrompt() {
    var text = promptValue();
    if (!text) return setStatus(txt("aiImgNeedPrompt", "Write what you want first."), "bad");
    copyText(text, function (ok) {
      if (ok) setStatus(txt("aiImgPromptCopied", "The prompt is on your clipboard."), "ok");
      else setStatus(txt("aiImgCopyFailed", "Copy the prompt with the button below."), "bad");
    });
  }

  function showSource() {
    if (!source || !bridge.hostOk) return;
    bridge.evalJsx('VB.revealFile ? VB.revealFile(' + core.jsxString(source.path) + ') : ""');
  }

  function openResultsFolder() {
    if (!bridge.hostOk) return;
    bridge.evalJsx('VB.openFolder ? VB.openFolder(VB.geminiPaths().results) : ""');
  }

  function pickResult() {
    if (busy) return;
    /* The user is choosing by hand: never place something behind their back. */
    stopWatch();
    if (!bridge.hostOk) return setStatus(txt("aiImgNoHost", "Open the panel inside Illustrator."), "bad");
    setBusy(true);
    bridge.evalJsx('VB.pickImageFile ? VB.pickImageFile() : ""', function (res) {
      setBusy(false);
      var r = hostJson(res);
      if (!r.ok) {
        /* A cancelled dialog is not an error worth a red line. */
        if (String(r.error) === "cancelled") return setStatus(txt("aiImgCancelled", "No file chosen."));
        return setStatus(errorText(r), "bad");
      }
      useResult(r);
    });
  }

  function useResult(info) {
    if (!info || !info.path) return;
    result = info;
    var name = $("aiImgResultName");
    if (name) name.textContent = info.name || "";
    showImage("aiImgResult", info, info.kind || extKind(info.name));
    syncButtons();
    setStatus(txt("aiImgResultReady", "Result ready. Place it to add the image to the document."), "ok");
  }

  function placeResult() {
    if (busy) return;
    if (!result) return setStatus(txt("aiImgNeedResult", "Choose the downloaded image first."), "bad");
    stopWatch();
    if (!bridge.hostOk) return setStatus(txt("aiImgNoHost", "Open the panel inside Illustrator."), "bad");
    var auto = autoPicked;
    autoPicked = false;
    setBusy(true);
    setStatus(txt("aiImgPlacing", "Placing the image…"));
    var args = {
      path: result.path,
      layerName: LAYER_NAME,
      /* Fits the exported selection, so a result generated from that artwork
         lands where the artwork was instead of on top of the whole artboard. */
      union: source ? source.union : null
    };
    /* The watcher only places into the document the source was exported from.
       A manual Place sends nothing here and is the user's own call. */
    if (auto && source) args.requireDoc = { fullName: source.docFullName || "", name: source.docName || "" };
    var encoded = encodeURIComponent(JSON.stringify(args));
    bridge.evalJsx('VB.placeImageFile ? VB.placeImageFile(' + core.jsxString(encoded) + ') : ""', function (res) {
      setBusy(false);
      var r = hostJson(res);
      if (!r.ok) {
        /* Automatic placement refused: never move the user's document for them.
           The result stays selected, so one press of Place finishes the job. */
        if (auto && String(r.error) === "docChanged") {
          return setStatus(txt("aiImgDocChangedAuto", "The image is ready, but the active document is not the one you exported from. Open that file and press “Place in Illustrator”."));
        }
        return setStatus(errorText(r), "bad");
      }
      var msg = auto ? txt("aiImgAutoPlaced", "Found in the results folder and placed on the “Gemini Image” layer.")
        : txt("aiImgPlaced", "Placed on the “Gemini Image” layer.");
      setStatus(r.embedded === false
        ? msg + " " + txt("aiImgLinked", "It is linked to the file, not embedded.")
        : msg, "ok");
    });
  }

  /* ---- recent results -------------------------------------------------- */

  function renderResults(list) {
    var box = $("aiImgResults");
    if (!box) return;
    while (box.firstChild) box.removeChild(box.firstChild);
    if (!list || !list.length) {
      var empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = txt("aiImgNoResults", "Nothing here yet. Downloads you save in this folder appear here.");
      box.appendChild(empty);
      return;
    }
    for (var i = 0; i < list.length; i++) {
      (function (item) {
        var row = document.createElement("div");
        row.className = "aiImgResultRow";
        var name = document.createElement("div");
        name.className = "aiImgResultName";
        name.textContent = item.name || "";
        var sub = document.createElement("div");
        sub.className = "svg-history-sub";
        sub.textContent = humanSize(item.bytes);
        var meta = document.createElement("div");
        meta.className = "aiImgResultMeta";
        meta.appendChild(name);
        meta.appendChild(sub);
        var use = document.createElement("button");
        use.type = "button";
        use.className = "btn small";
        use.setAttribute("data-i18n", "aiImgUse");
        use.textContent = txt("aiImgUse", "Use");
        use.addEventListener("click", function () { useResult({ path: item.path, name: item.name, kind: extKind(item.name), bytes: item.bytes }); }, false);
        row.appendChild(meta);
        row.appendChild(use);
        box.appendChild(row);
      })(list[i]);
    }
  }

  /* Boot order, not a user error: at DOM ready bridge.hostOk is still false even
     when the panel is docked in Illustrator, because vectorizer.init() only then
     starts bridge.loadHost(). Reading the flag once left every button disabled
     and the status stuck on "Open the panel inside Illustrator" for good. */
  function waitForHost(tries) {
    if (bridge.hostOk) {
      waitingNote = false;
      syncButtons();
      if (!source && !result) setStatus(txt("aiImgIdle", "Select artwork in Illustrator and press “Use selection”."));
      /* Once per panel open: age out our own old sources and request records.
         The results folder is the user's and is never touched. */
      bridge.evalJsx('VB.cleanGeminiWorkspace ? VB.cleanGeminiWorkspace(7) : ""');
      refreshResults();
      return;
    }
    if (tries <= 0) {
      waitingNote = false;
      setStatus(txt("aiImgNoHost", "Open the panel inside Illustrator."), "bad");
      return;
    }
    if (!waitingNote) {
      waitingNote = true;
      setStatus(txt("aiImgConnecting", "Connecting to Illustrator…"));
    }
    setTimeout(function () { waitForHost(tries - 1); }, HOST_WAIT_MS);
  }

  function refreshResults() {
    if (!bridge.hostOk) return renderResults([]);
    bridge.evalJsx('VB.listGeminiResults ? VB.listGeminiResults(8) : ""', function (res) {
      var r = hostJson(res);
      renderResults(r.ok ? r.files : []);
    });
  }

  /* ---- watching for the download ---------------------------------------

     A vectorize run ends by itself; this one ends in Gemini. The closest thing
     that needs no browser automation: once Gemini is open, look in the results
     folder for an image newer than the moment we armed, then place it. Only our
     own folder is scanned — nothing else on the machine is touched. */

  var WATCH_MS = 3000;
  var WATCH_LIMIT_MS = 15 * 60 * 1000;
  var watching = 0;        /* epoch ms the watch was armed, 0 = off */
  /* Identifies one watch. A counter rather than the timestamp itself: two arms
     inside the same millisecond (fast retry, or a clock that steps back) would
     otherwise make a late answer from the previous watch look current. */
  var watchSeq = 0;
  var watchTimer = null;
  var watchPath = "";      /* last file already handled */

  function stopWatch() {
    watching = 0;
    watchSeq++;
    if (watchTimer) { clearTimeout(watchTimer); watchTimer = null; }
  }

  function startWatch() {
    stopWatch();
    watchPath = "";
    watching = new Date().getTime();
    pollWatch(watchSeq);
  }

  function pollWatch(seq) {
    watchTimer = null;
    if (!watching || seq !== watchSeq || !bridge.hostOk) return stopWatch();
    var arm = watching;
    if (new Date().getTime() - arm > WATCH_LIMIT_MS) {
      setStatus(txt("aiImgWatchTimeout", "Still no download. Save the image wherever you like and use “Choose result…”."));
      return stopWatch();
    }
    watchTimer = setTimeout(function () { pollWatch(seq); }, WATCH_MS);
    bridge.evalJsx('VB.newestGeminiResult ? VB.newestGeminiResult(' + arm + ') : ""', function (res) {
      /* A late answer must not act on a watch the user already ended. */
      if (seq !== watchSeq) return;
      var r = hostJson(res);
      if (!r.ok || !r.file || !r.file.path || r.file.path === watchPath) return;
      watchPath = r.file.path;
      stopWatch();
      autoPicked = true;
      useResult({ path: r.file.path, name: r.file.name, kind: extKind(r.file.name), bytes: r.file.bytes });
      placeResult();
    });
  }

  /* ---- wiring ---------------------------------------------------------- */

  function on(id, fn) {
    var el = $(id);
    if (el) el.addEventListener("click", function (ev) {
      try { if (ev && ev.preventDefault) ev.preventDefault(); } catch (e) { }
      fn();
    }, false);
  }

  aiImage.init = function () {
    if (inited) return;
    inited = true;
    on("aiImgUseSelection", useSelection);
    on("aiImgOpen", openGemini);
    on("aiImgCopy", copyPrompt);
    on("aiImgShowSource", showSource);
    on("aiImgResultsFolder", openResultsFolder);
    on("aiImgPick", pickResult);
    on("aiImgPlace", placeResult);
    var tpl = $("aiImgTemplate");
    if (tpl) tpl.addEventListener("change", applyTemplate, false);
    /* Disabled while the host is still connecting, so nothing looks clickable
       before Illustrator can answer. */
    syncButtons();
    waitForHost(HOST_TRIES);
  };
})();
