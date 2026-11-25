/* "What's new" card and the feature tour.

   Two jobs, one small engine:
   - after a version change, say what that version added (data in js/whats-new.js),
   - walk the user through it by highlighting the real controls, so the "tour"
     points at the actual UI instead of a slide.

   The card is anchored to the bottom of the panel rather than centred like the
   first-run wizard, so the highlighted control is never covered while it is
   being explained. Nothing here starts on its own beyond that first-open card.

   Acknowledgement is per version: ms.whatsNewSeen holds the version the user
   has already seen, so an update shows the card once and never again. */
(function () {
  "use strict";
  var VB = window.VBPanel = window.VBPanel || {};
  var core = VB.core || (VB.core = {});
  var tour = VB.tour = VB.tour || {};

  var SEEN_KEY = "ms.whatsNewSeen";

  var entry = null;   // the announcement being shown
  var step = 0;       // index into entry.tour
  var mode = "";      // "bullets" | "steps"
  var target = null;  // currently highlighted element

  function $(id) { return document.getElementById(id); }

  function txt(key, fallback) {
    try { var v = core.t(key); if (v && v !== key) return v; } catch (e) { }
    return fallback;
  }
  function label(key) { return txt(key, ""); }

  function version() {
    try { return String((core.extensionVersion && core.extensionVersion()) || ""); } catch (e) { return ""; }
  }
  function announcement() {
    var all = window.VBWHATSNEW || {};
    var v = version();
    return (v && all[v]) ? all[v] : null;
  }
  function seen() { try { return localStorage.getItem(SEEN_KEY) || ""; } catch (e) { return ""; } }
  function markSeen() { try { localStorage.setItem(SEEN_KEY, version()); } catch (e) { } }

  /* The first-run wizard owns the screen on a fresh install; two dialogs at once
     read as a bug. The tour is offered when that card closes instead. */
  function setupOpen() {
    var overlay = $("setupOverlay");
    return !!(overlay && !overlay.hidden);
  }

  function clearHighlight() {
    if (target) { try { target.classList.remove("tourTarget"); } catch (e) { } }
    target = null;
  }

  function highlight(el) {
    clearHighlight();
    if (!el) return;
    target = el;
    try { el.classList.add("tourTarget"); } catch (e) { }
    try { el.scrollIntoView({ block: "center", behavior: "smooth" }); }
    catch (e) { try { el.scrollIntoView(); } catch (e2) { } }
  }

  /* A tour target can sit inside a collapsed section (the AI image editor lives in one), so
     open its parents before pointing at it. */
  function reveal(el) {
    var node = el;
    while (node && node !== document.body) {
      if (node.tagName === "DETAILS" && !node.open) node.open = true;
      node = node.parentElement;
    }
  }

  function hide() {
    clearHighlight();
    var card = $("tourCard");
    if (card) card.hidden = true;
    mode = "";
    entry = null;
    step = 0;
  }

  function setButtons(skipText, nextText, showBack) {
    var back = $("tourBack");
    var skip = $("tourSkip");
    var next = $("tourNext");
    if (back) { back.textContent = txt("setupBack", "Back"); back.style.display = showBack ? "" : "none"; }
    if (skip) skip.textContent = skipText;
    if (next) next.textContent = nextText;
  }

  function showCard(titleText, stepText) {
    var card = $("tourCard");
    if (!card) return;
    var title = $("tourTitle");
    if (title) title.textContent = titleText || "";
    var count = $("tourStep");
    if (count) count.textContent = stepText || "";
    card.hidden = false;
  }

  function renderBullets() {
    mode = "bullets";
    step = 0;
    var body = $("tourBody");
    if (body) {
      body.innerHTML = "";
      var list = document.createElement("ul");
      var bullets = (entry && entry.bullets) || [];
      for (var i = 0; i < bullets.length; i++) {
        var item = document.createElement("li");
        item.textContent = label(bullets[i]);
        list.appendChild(item);
      }
      body.appendChild(list);
    }
    highlight(null);
    showCard(txt("whatsNewTitle", "What's new in") + " " + version(), "");
    setButtons(txt("whatsNewLater", "Later"), txt("whatsNewShow", "Show me"), false);
  }

  function renderStep() {
    mode = "steps";
    var list = (entry && entry.tour) || [];
    var current = list[step];
    if (!current) return finish();
    var body = $("tourBody");
    if (body) { body.innerHTML = ""; body.textContent = label(current.bodyKey); }
    showCard(label(current.titleKey) || txt("whatsNewTitle", "What's new in"), (step + 1) + " / " + list.length);
    var last = step >= list.length - 1;
    setButtons(txt("whatsNewSkip", "Skip"), last ? txt("whatsNewDone", "Done") : txt("setupNext", "Next"), step > 0);
    var el = document.getElementById(current.target);
    if (el) reveal(el);
    highlight(el);
  }

  function finish() {
    markSeen();
    hide();
  }

  function next() {
    if (mode === "bullets") {
      if (entry && entry.tour && entry.tour.length) { step = 0; renderStep(); return; }
      return finish();
    }
    var list = (entry && entry.tour) || [];
    if (step >= list.length - 1) return finish();
    step++;
    renderStep();
  }

  function back() {
    if (mode !== "steps") return;
    if (step === 0) return renderBullets();
    step--;
    renderStep();
  }

  /* First open after a version change. A build with no announcement is marked as
     seen so it never asks later, and nothing is shown while the wizard is up. */
  function maybeShow() {
    if (setupOpen()) return false;
    var data = announcement();
    if (!data) { markSeen(); return false; }
    if (seen() === version()) return false;
    entry = data;
    renderBullets();
    return true;
  }

  /* "What's new" button in the Updates section: the tour alone, no summary. */
  function start() {
    var data = announcement();
    if (!data || !data.tour || !data.tour.length) return false;
    entry = data;
    step = 0;
    renderStep();
    return true;
  }

  function init() {
    var nextBtn = $("tourNext");
    var backBtn = $("tourBack");
    var skipBtn = $("tourSkip");
    if (nextBtn) core.on(nextBtn, "click", next);
    if (backBtn) core.on(backBtn, "click", back);
    if (skipBtn) core.on(skipBtn, "click", finish);

    var openBtn = $("whatsNewBtn");
    var data = announcement();
    if (openBtn) {
      if (data && data.tour && data.tour.length) core.on(openBtn, "click", start);
      else openBtn.style.display = "none";
    }

    /* The tour highlights panel sections, which the floating window hides. */
    try { if (core.isWindowMode && core.isWindowMode()) return; } catch (e) { }

    try { if (core.events && core.events.on) core.events.on("setup:finished", maybeShow); } catch (e2) { }
    maybeShow();
  }

  tour.init = init;
  tour.start = start;
  tour.maybeShow = maybeShow;
})();
