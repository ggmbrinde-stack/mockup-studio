const NATIVE_HOST = 'com.bestofgifts.mockupstudio.flow';

let port = null;
let currentJobId = null;
let jobStartTime = null;
let pendingDownloads = new Map();
let tabIdMap = new Map(); // jobId -> tabId for debugger targeting

function connectNativeHost() {
  try {
    port = chrome.runtime.connectNative(NATIVE_HOST);
    port.onMessage.addListener(handleNativeMessage);
    port.onDisconnect.addListener(() => {
      console.log('[Flow Bridge] Native host disconnected');
      port = null;
    });
    console.log('[Flow Bridge] Connected to native host');
    sendToNative({ type: 'extensionReady', extensionId: chrome.runtime.id });
  } catch (e) {
    console.error('[Flow Bridge] Failed to connect native host:', e);
  }
}

function handleNativeMessage(msg) {
  switch (msg.type) {
    case 'jobStarted':
      console.log('[Flow Bridge] Job started (native):', msg.jobId);
      break;
    case 'jobStopped':
      console.log('[Flow Bridge] Job stopped (native):', msg.jobId);
      break;
    case 'pong':
      console.log('[Flow Bridge] Pong from native host');
      break;
    case 'jobList':
      console.log('[Flow Bridge] Job list (native):', msg.jobs);
      break;
    default:
      console.log('[Flow Bridge] Unknown native message:', msg.type);
  }
}

function sendToNative(msg) {
  if (port) {
    try {
      port.postMessage(msg);
    } catch (e) {
      console.error('[Flow Bridge] Failed to send to native:', e);
    }
  } else {
    console.error('[Flow Bridge] No native port available');
  }
}

// ---------- Content script message handling ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  async function handle() {
    switch (msg.type) {
      case 'contentReady':
        console.log('[Flow Bridge] Content script ready:', msg.url);
        sendResponse({ ok: true });
        break;

      case 'startJob':
        // Relay to native host to start download watching
        currentJobId = msg.jobId;
        jobStartTime = msg.jobStartTime || Date.now();
        tabIdMap.set(msg.jobId, sender.tab.id);
        pendingDownloads.clear();
        sendToNative({
          type: 'startJob',
          jobId: msg.jobId,
          jobStartTime: jobStartTime,
          downloadFolder: msg.downloadFolder,
        });
        sendResponse({ ok: true, jobId: msg.jobId });
        break;

      case 'stopJob':
        sendToNative({ type: 'stopJob', jobId: currentJobId || 'all' });
        currentJobId = null;
        jobStartTime = null;
        pendingDownloads.clear();
        tabIdMap.clear();
        sendResponse({ ok: true });
        break;

      case 'setPrompt':
        // Forward to content script in the active tab
        const targetTab = sender.tab.id;
        try {
          const result = await chrome.tabs.sendMessage(targetTab, {
            type: 'setPrompt',
            text: msg.text,
            tabId: targetTab,
          });
          sendResponse(result || { ok: false });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
        return true; // async

      case 'clickGenerate':
        try {
          const result = await chrome.tabs.sendMessage(sender.tab.id, {
            type: 'clickGenerate',
            tabId: sender.tab.id,
          });
          sendResponse(result || { ok: false });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
        return true;

      case 'clickUpload':
        try {
          const result = await chrome.tabs.sendMessage(sender.tab.id, {
            type: 'clickUpload',
            tabId: sender.tab.id,
          });
          sendResponse(result || { ok: false });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
        return true;

      case 'snapshotOutputs':
        try {
          const result = await chrome.tabs.sendMessage(sender.tab.id, {
            type: 'snapshotOutputs',
          });
          sendResponse(result || { ok: false });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
        return true;

      case 'startOutputObserver':
        try {
          const result = await chrome.tabs.sendMessage(sender.tab.id, {
            type: 'startOutputObserver',
            tabId: sender.tab.id,
            jobId: msg.jobId,
          });
          sendResponse(result || { ok: false });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
        return true;

      case 'stopOutputObserver':
        try {
          const result = await chrome.tabs.sendMessage(sender.tab.id, {
            type: 'stopOutputObserver',
          });
          sendResponse(result || { ok: false });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
        return true;

      case 'isFlowPage':
        try {
          const result = await chrome.tabs.sendMessage(sender.tab.id, {
            type: 'isFlowPage',
          });
          sendResponse(result || { ok: false });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
        return true;

      case 'flowResultDetected':
        // Content script detected a new generated image — relay to native host
        if (msg.jobId && msg.imageUrl) {
          sendToNative({
            type: 'downloadDetected',
            jobId: msg.jobId,
            filePath: msg.imageUrl,
            url: msg.imageUrl,
            mime: 'image/png',
            timestamp: msg.timestamp,
          });
        }
        sendResponse({ ok: true });
        break;

      case 'getExtensionId':
        sendResponse({ extensionId: chrome.runtime.id });
        break;

      default:
        sendResponse({ ok: false, error: 'unknown message: ' + msg.type });
    }
  }
  const isAsync = ['setPrompt', 'clickGenerate', 'clickUpload', 'snapshotOutputs', 'startOutputObserver', 'stopOutputObserver', 'isFlowPage'].includes(msg.type);
  if (isAsync) handle();
  else { handle(); sendResponse({ ok: true }); }
  return isAsync;
});

// ---------- Download detection (live Flow results) ----------
chrome.downloads.onCreated.addListener((downloadItem) => {
  if (!currentJobId || !jobStartTime) return;
  if (downloadItem.startTime && downloadItem.startTime < jobStartTime) return;
  if (downloadItem.url && downloadItem.url.includes('flow.google.com')) {
    console.log('[Flow Bridge] Flow download detected:', downloadItem.id, downloadItem.filename);
    pendingDownloads.set(downloadItem.id, {
      jobId: currentJobId,
      url: downloadItem.url,
      filename: downloadItem.filename,
      mime: downloadItem.mime,
    });
  }
});

chrome.downloads.onChanged.addListener((downloadDelta) => {
  if (!pendingDownloads.has(downloadDelta.id)) return;
  if (downloadDelta.state && downloadDelta.state.current === 'complete') {
    const info = pendingDownloads.get(downloadDelta.id);
    console.log('[Flow Bridge] Download complete for job:', info.jobId);
    sendToNative({
      type: 'downloadDetected',
      jobId: info.jobId,
      filePath: downloadDelta.filename?.current || info.filename,
      url: info.url,
      mime: downloadDelta.mime?.current || info.mime,
    });
    pendingDownloads.delete(downloadDelta.id);
    currentJobId = null;
    jobStartTime = null;
  }
});

// ---------- External message handling (from panel / other extensions) ----------
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'flowGenerationComplete') {
    sendToNative({
      type: 'downloadDetected',
      jobId: msg.jobId,
      filePath: msg.filePath,
      url: msg.url,
    });
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === 'getExtensionId') {
    sendResponse({ extensionId: chrome.runtime.id });
    return true;
  }
  return false;
});

chrome.runtime.onStartup.addListener(connectNativeHost);
chrome.runtime.onInstalled.addListener(connectNativeHost);
connectNativeHost();

console.log('[Flow Bridge] Background service worker loaded');
