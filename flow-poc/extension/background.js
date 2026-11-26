const fs = require('fs');
const path = require('path');

const BRIDGE_FOLDER = path.join(require('os').homedir(), 'Documents', 'VectorizerBridge');
const JOBS_FOLDER = path.join(BRIDGE_FOLDER, 'flow-jobs');
const STATUS_FOLDER = path.join(BRIDGE_FOLDER, 'flow-status');

let currentJobId = null;
let jobStartTime = null;

function ensureFolders() {
  [BRIDGE_FOLDER, JOBS_FOLDER, STATUS_FOLDER].forEach(f => {
    if (!fs.existsSync(f)) fs.mkdirSync(f, { recursive: true });
  });
}

function writeJobFile(jobId, jobStartTime, downloadFolder) {
  ensureFolders();
  const file = path.join(JOBS_FOLDER, `flow-${jobId}.json`);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({
    type: 'waiting',
    state: 'waiting',
    jobId,
    jobStartTime: jobStartTime || Date.now(),
    downloadFolder: downloadFolder || path.join(require('os').homedir(), 'Downloads', 'MockupStudioFlow'),
  }), 'utf8');
  fs.renameSync(tmp, file);
  console.log('[Flow Bridge] Job file written:', file);
}

function readStatusFile(jobId) {
  const file = path.join(STATUS_FOLDER, `flow-${jobId}.json`);
  try {
    const content = fs.readFileSync(file, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function deleteJobFile(jobId) {
  try { fs.unlinkSync(path.join(JOBS_FOLDER, `flow-${jobId}.json`)); } catch {}
}

function sendToPanel(msg) {
  // Relay to panel via runtime message (if panel is listening)
  try {
    chrome.runtime.sendMessage(msg);
  } catch {}
}

function pollStatus(jobId) {
  const status = readStatusFile(jobId);
  if (status) {
    console.log('[Flow Bridge] Status poll:', status.state, status.message || '');
    if (status.state === 'complete' || status.state === 'error') {
      deleteJobFile(jobId);
      chrome.runtime.sendMessage({ type: 'flowStatus', jobId, ...status });
    }
    return status;
  }
  return null;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'startJob':
      currentJobId = msg.jobId;
      jobStartTime = msg.jobStartTime || Date.now();
      writeJobFile(msg.jobId, msg.jobStartTime, msg.downloadFolder);
      sendResponse({ ok: true, jobId: msg.jobId });
      break;
    case 'stopJob':
      if (currentJobId) {
        deleteJobFile(currentJobId);
        currentJobId = null;
        jobStartTime = null;
      }
      sendResponse({ ok: true });
      break;
    case 'ping':
      sendResponse({ ok: true });
      break;
    case 'getExtensionId':
      sendResponse({ extensionId: chrome.runtime.id });
      break;
    case 'pollStatus':
      const status = pollStatus(msg.jobId);
      sendResponse({ ok: true, status });
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

chrome.runtime.onStartup.addListener(() => {
  ensureFolders();
});
chrome.runtime.onInstalled.addListener(() => {
  ensureFolders();
});
ensureFolders();

console.log('[Flow Bridge] Background service worker loaded (file-based mode)');
