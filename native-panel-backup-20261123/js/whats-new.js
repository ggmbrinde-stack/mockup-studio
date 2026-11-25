/* What's new / feature tour data -------------------------------------------
   One entry per released version, keyed by the version in CSXS/manifest.xml.

   This ships inside the panel on purpose: the text cannot be swapped over the
   network (the updater that trusted remote content had to be deleted), and it
   always describes the build the user is actually running instead of whatever
   a server thinks they should see.

     bullets   locale keys (js/locales/en.js + pt.js), one line each
     tour      { target: element id in index.html, titleKey, bodyKey }

   Shipping a feature = one entry here plus its keys in both locales. A version
   with no entry never shows a card, so patch releases stay quiet.
*/
window.VBWHATSNEW = {
  "2.5.0": {
    bullets: ["wn250_1", "wn250_2", "wn250_3"],
    tour: [
      {
        target: "aiImageBox",
        titleKey: "wnTourImageTitle",
        bodyKey: "wnTourImageBody"
      },
      {
        target: "aiImgPrompt",
        titleKey: "wnTourImagePromptTitle",
        bodyKey: "wnTourImagePromptBody"
      }
    ]
  }
};
