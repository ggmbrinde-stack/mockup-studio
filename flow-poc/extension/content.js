// Flow content script — injects into flow.google.com pages.
// Handles prompt entry (via chrome.debugger.Input.insertText, FlowPilot pattern),
// reference image upload, and generation result detection.
// Communicates with extension background via chrome.runtime.sendMessage.

const FLOW_ORIGIN = 'https://flow.google.com';

// Locators — minimal, semantic, stable where possible.
// Flow's UI changes frequently; these are starting points.
const LOCATORS = {
  // Prompt input area
  promptInput: [
    '[role="textbox"][aria-label*="prompt"]',
    '[data-testid="prompt-input"]',
    'textarea[placeholder*="Describe"]',
    'textarea[placeholder*="prompt"]',
  ],
  // Generate / send button
  generateButton: [
    'button[aria-label*="Generate"]',
    'button[aria-label*="Send"]',
    'button[data-testid="generate-button"]',
    '[role="button"][aria-label*="generate"]',
  ],
  // Upload / ingredient button
  uploadButton: [
    'button[aria-label*="ingredient"]',
    'button[aria-label*="upload"]',
    'input[type="file"]',
  ],
  // Output region where results appear
  outputRegion: [
    '[data-testid="output-region"]',
    '[aria-label*="generated"]',
    '.output-region',
  ],
};

function findElement(selectors) {
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) return el;
    } catch {}
  }
  return null;
}

function findAllElements(selectors) {
  for (const sel of selectors) {
    try {
      const els = document.querySelectorAll(sel);
      if (els && els.length > 0) return Array.from(els);
    } catch {}
  }
  return [];
}

function isFlowPage() {
  return location.origin === FLOW_ORIGIN && location.pathname.includes('/project/');
}

// ---------- Prompt entry via chrome.debugger (FlowPilot pattern) ----------
// Flow rejects synthetic content-script input (dispatchEvent on textarea doesn't
// update Flow's internal prompt state). Use debugger Input.insertText instead.

let debuggerTabId = null;

async function attachDebugger(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, '1.0');
    debuggerTabId = tabId;
    console.log('[Flow Content] Debugger attached to tab', tabId);
  } catch (e) {
    console.error('[Flow Content] Debugger attach failed:', e.message);
  }
}

async function insertTextViaDebugger(text) {
  if (!debuggerTabId) {
    console.error('[Flow Content] No debugger tab attached');
    return false;
  }
  try {
    await chrome.debugger.sendCommand(debuggerTabId, 'Input.insertText', { text });
    console.log('[Flow Content] Text inserted via debugger:', text.slice(0, 60) + '...');
    return true;
  } catch (e) {
    console.error('[Flow Content] Debugger insertText failed:', e.message);
    return false;
  }
}

// Fallback: direct content-script input (works if Flow accepts it)
function insertTextDirect(text) {
  const input = findElement(LOCATORS.promptInput);
  if (!input) {
    console.error('[Flow Content] No prompt input found for direct insert');
    return false;
  }
  try {
    input.focus();
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    console.log('[Flow Content] Text inserted directly:', text.slice(0, 60) + '...');
    return true;
  } catch (e) {
    console.error('[Flow Content] Direct insert failed:', e.message);
    return false;
  }
}

async function setPrompt(text, tabId) {
  if (tabId && tabId !== debuggerTabId) {
    await attachDebugger(tabId);
  }
  // Try debugger first (trusted input), fall back to direct
  if (debuggerTabId) {
    const ok = await insertTextViaDebugger(text);
    if (ok) return true;
  }
  return insertTextDirect(text);
}

function clickGenerate(tabId) {
  const btn = findElement(LOCATORS.generateButton);
  if (!btn) {
    console.error('[Flow Content] No generate button found');
    return false;
  }
  try {
    btn.click();
    console.log('[Flow Content] Generate button clicked');
    return true;
  } catch (e) {
    console.error('[Flow Content] Generate click failed:', e.message);
    return false;
  }
}

function clickUpload(tabId) {
  const btn = findElement(LOCATORS.uploadButton);
  if (!btn) {
    console.error('[Flow Content] No upload button found');
    return false;
  }
  try {
    btn.click();
    console.log('[Flow Content] Upload button clicked');
    return true;
  } catch (e) {
    console.error('[Flow Content] Upload click failed:', e.message);
    return false;
  }
}

// ---------- Result detection ----------
// Snapshot output region before generation, then observe for new images.
let outputSnapshot = new Set();
let observer = null;

function snapshotOutputs() {
  outputSnapshot = new Set();
  const imgs = findAllElements(LOCATORS.outputRegion);
  imgs.forEach(img => {
    const src = img.src || img.currentSrc || '';
    if (src) outputSnapshot.add(src);
  });
  console.log('[Flow Content] Output snapshot:', outputSnapshot.size, 'images');
}

function startOutputObserver(tabId, jobId) {
  if (observer) observer.disconnect();
  const region = findElement(LOCATORS.outputRegion) || document.body;
  observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;
        const imgs = node.querySelectorAll ? node.querySelectorAll('img') : [];
        if (node.tagName === 'IMG') imgs.push(node);
        for (const img of imgs) {
          const src = img.src || img.currentSrc || '';
          if (src && !outputSnapshot.has(src)) {
            outputSnapshot.add(src);
            console.log('[Flow Content] New output detected:', src.slice(0, 80) + '...');
            chrome.runtime.sendMessage({
              type: 'flowResultDetected',
              jobId,
              imageUrl: src,
              timestamp: Date.now(),
            });
          }
        }
      }
    }
  });
  observer.observe(region, { childList: true, subtree: true });
  console.log('[Flow Content] Output observer started for job', jobId);
}

function stopOutputObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

// ---------- Message handling ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  async function handle() {
    switch (msg.type) {
      case 'setPrompt':
        await setPrompt(msg.text, msg.tabId);
        sendResponse({ ok: true });
        break;
      case 'clickGenerate':
        clickGenerate(msg.tabId);
        sendResponse({ ok: true });
        break;
      case 'clickUpload':
        clickUpload(msg.tabId);
        sendResponse({ ok: true });
        break;
      case 'snapshotOutputs':
        snapshotOutputs();
        sendResponse({ ok: true });
        break;
      case 'startOutputObserver':
        startOutputObserver(msg.tabId, msg.jobId);
        sendResponse({ ok: true });
        break;
      case 'stopOutputObserver':
        stopOutputObserver();
        sendResponse({ ok: true });
        break;
      case 'isFlowPage':
        sendResponse({ ok: isFlowPage() });
        break;
      default:
        sendResponse({ ok: false, error: 'unknown message type: ' + msg.type });
    }
  }
  handle();
  return true; // keep channel open for async
});

// ---------- Initialization ----------
if (isFlowPage()) {
  chrome.runtime.sendMessage({ type: 'contentReady', url: location.href });
  snapshotOutputs();
}
