const NATIVE_HOST = 'com.bestofgifts.mockupstudio.flow';

let port = null;

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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'startJob':
      sendToNative({
        type: 'startJob',
        jobId: msg.jobId,
        jobStartTime: msg.jobStartTime || Date.now(),
        downloadFolder: msg.downloadFolder,
      });
      sendResponse({ ok: true, jobId: msg.jobId });
      break;
    case 'stopJob':
      sendToNative({ type: 'stopJob', jobId: msg.jobId || 'all' });
      sendResponse({ ok: true });
      break;
    case 'ping':
      sendToNative({ type: 'ping' });
      sendResponse({ ok: true });
      break;
    case 'getExtensionId':
      sendResponse({ extensionId: chrome.runtime.id });
      break;
    default:
      sendResponse({ ok: false, error: 'unknown message: ' + msg.type });
  }
  return true;
});

chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
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
