const NATIVE_HOST = 'com.bestofgifts.mockupstudio.flow';

let port = null;
let currentJobId = null;
let jobStartTime = null;
let pendingDownloads = new Map();

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
    case 'startJob':
      currentJobId = msg.jobId;
      jobStartTime = Date.now();
      pendingDownloads.clear();
      console.log('[Flow Bridge] Job started:', currentJobId);
      break;
    case 'stopJob':
      currentJobId = null;
      jobStartTime = null;
      pendingDownloads.clear();
      break;
    case 'ping':
      sendToNative({ type: 'pong', extensionId: chrome.runtime.id });
      break;
  }
}

chrome.downloads.onCreated.addListener((downloadItem) => {
  if (!currentJobId || !jobStartTime) return;
  if (downloadItem.startTime && downloadItem.startTime < jobStartTime) return;
  if (downloadItem.url && downloadItem.url.includes('flow.google.com')) {
    console.log('[Flow Bridge] Flow download detected:', downloadItem.id, downloadItem.filename);
    pendingDownloads.set(downloadItem.id, {
      jobId: currentJobId,
      url: downloadItem.url,
      filename: downloadItem.filename,
      mime: downloadItem.mime
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
      mime: downloadDelta.mime?.current || info.mime
    });
    pendingDownloads.delete(downloadDelta.id);
    currentJobId = null;
    jobStartTime = null;
  }
});

function sendToNative(msg) {
  if (port) {
    try {
      port.postMessage(msg);
    } catch (e) {
      console.error('[Flow Bridge] Failed to send to native:', e);
    }
  }
}

chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'flowGenerationComplete') {
    sendToNative({
      type: 'downloadDetected',
      jobId: msg.jobId,
      filePath: msg.filePath,
      url: msg.url
    });
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === 'getExtensionId') {
    sendResponse({ extensionId: chrome.runtime.id });
    return true;
  }
});

chrome.runtime.onStartup.addListener(connectNativeHost);
chrome.runtime.onInstalled.addListener(connectNativeHost);
connectNativeHost();

console.log('[Flow Bridge] Background service worker loaded');