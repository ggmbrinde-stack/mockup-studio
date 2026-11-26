const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { spawn } = require('child_process');

const BRIDGE_FOLDER = path.join(process.env.USERPROFILE || process.env.HOME, 'Documents', 'VectorizerBridge');
const JOBS_FOLDER = path.join(BRIDGE_FOLDER, 'flow-jobs');
const STATUS_FOLDER = path.join(BRIDGE_FOLDER, 'flow-status');
const DOWNLOAD_FOLDER = path.join(process.env.USERPROFILE || process.env.HOME, 'Downloads', 'MockupStudioFlow');
const SETTLE_DELAY_MS = 3000; // wait for downloads to settle before marking complete
const INITIAL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes: if no downloads arrive, fail the job

function ensureFolders() {
  [BRIDGE_FOLDER, JOBS_FOLDER, STATUS_FOLDER, DOWNLOAD_FOLDER].forEach(f => {
    if (!fs.existsSync(f)) fs.mkdirSync(f, { recursive: true });
  });
}

function writeStatus(jobId, status) {
  const file = path.join(STATUS_FOLDER, `flow-${jobId}.json`);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ ...status, time: Date.now() }), 'utf8');
  fs.renameSync(tmp, file);
}

function getMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
  return mimeMap[ext] || 'application/octet-stream';
}

let activeJob = null; // { jobId, jobStartTime, downloadFolder, results: [], settleTimer: null, initialTimer: null }
let downloadWatcher = null;
let processedDownloads = new Set(); // track already-processed download paths
let nativePort = null; // native messaging stdio port

function startDownloadWatcher(jobId, jobStartTime, downloadFolder) {
  // Close any previous watcher to prevent the infinite loop
  stopDownloadWatcher();

  activeJob = {
    jobId,
    jobStartTime,
    downloadFolder: downloadFolder || DOWNLOAD_FOLDER,
    results: [],
    settleTimer: null,
    initialTimer: null,
  };
  writeStatus(jobId, { state: 'waiting', jobId, message: 'Watching for downloads...', jobStartTime });

  if (!fs.existsSync(downloadFolder)) {
    writeStatus(jobId, { state: 'error', error: 'Download folder not found', jobId });
    activeJob = null;
    return;
  }

  // Initial timeout: if no downloads arrive within INITIAL_TIMEOUT_MS, fail the job
  activeJob.initialTimer = setTimeout(() => {
    if (!activeJob || activeJob.jobId !== jobId) return;
    if (activeJob.results.length === 0) {
      writeStatus(jobId, { state: 'error', error: 'No downloads detected within timeout period', jobId });
    }
    stopDownloadWatcher();
  }, INITIAL_TIMEOUT_MS);

  downloadWatcher = chokidar.watch(downloadFolder, { ignoreInitial: true, persistent: true });
  downloadWatcher.on('add', filePath => {
    handleDownloadFile(filePath);
  });
  downloadWatcher.on('change', filePath => {
    handleDownloadFile(filePath);
  });
  downloadWatcher.on('error', err => {
    if (activeJob && activeJob.jobId === jobId) {
      // EBUSY on Windows during file write is transient — log and continue watching
      console.error('[Flow Bridge] Watcher error:', err.message);
      if (!err.message.includes('EBUSY') && !err.message.includes('resource busy')) {
        writeStatus(activeJob.jobId, { state: 'error', error: String(err), jobId });
        stopDownloadWatcher();
      }
    }
  });
}

function stopDownloadWatcher() {
  if (activeJob && activeJob.initialTimer) {
    clearTimeout(activeJob.initialTimer);
    activeJob.initialTimer = null;
  }
  if (activeJob && activeJob.settleTimer) {
    clearTimeout(activeJob.settleTimer);
    activeJob.settleTimer = null;
  }
  if (downloadWatcher) {
    downloadWatcher.close();
    downloadWatcher = null;
  }
  activeJob = null;
}

function isDownloadComplete(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function resetSettleTimer() {
  if (!activeJob) return;
  if (activeJob.settleTimer) {
    clearTimeout(activeJob.settleTimer);
  }
  activeJob.settleTimer = setTimeout(() => {
    if (!activeJob) return;
    if (activeJob.results.length === 0) {
      writeStatus(activeJob.jobId, {
        state: 'error',
        error: 'No downloads detected within settle period',
        jobId: activeJob.jobId,
      });
    } else {
      writeStatus(activeJob.jobId, {
        state: 'complete',
        jobId: activeJob.jobId,
        results: [...activeJob.results],
        filePath: activeJob.results[activeJob.results.length - 1],
        mime: getMime(activeJob.results[activeJob.results.length - 1]),
        message: `Downloaded ${activeJob.results.length} file(s)`,
      });
    }
    stopDownloadWatcher();
  }, SETTLE_DELAY_MS);
}

function handleDownloadFile(filePath) {
  if (!activeJob) return;
  if (processedDownloads.has(filePath)) return;

  // Only process files that started downloading after the job started
  try {
    const stat = fs.statSync(filePath);
    // Use birthtime (file creation time) because copyFileSync preserves source mtime/ctime
    const creationTime = stat.birthtime ? stat.birthtime.getTime() : stat.ctime.getTime();
    if (creationTime < activeJob.jobStartTime - 5000) {
      return;
    }
  } catch {
    return;
  }

  // Only process completed downloads (not temporary/crdownload files)
  const name = path.basename(filePath).toLowerCase();
  if (name.endsWith('.crdownload') || name.endsWith('.tmp') || name.endsWith('.partial')) {
    return;
  }

  // Only process image files
  const ext = path.extname(name).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    return;
  }

  // Verify the file is complete (not being written)
  if (!isDownloadComplete(filePath)) return;

  processedDownloads.add(filePath);

  if (!activeJob.results) activeJob.results = [];
  activeJob.results.push(filePath);

  writeStatus(activeJob.jobId, {
    state: 'waiting',
    jobId: activeJob.jobId,
    results: [...activeJob.results],
    filePath: filePath,
    mime: getMime(filePath),
    message: `Downloading ${activeJob.results.length} file(s)…`,
  });

  resetSettleTimer();
}

function processJobFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const job = JSON.parse(content);

    // Only process jobs from the panel (state: "waiting"), not our own status writes
    if (job.state === 'waiting' && job.jobId) {
      // Delete the job file after reading to avoid reprocessing
      try { fs.unlinkSync(filePath); } catch {}

      startDownloadWatcher(job.jobId, job.jobStartTime || Date.now(), job.downloadFolder);
    }
  } catch (e) {
    console.error('[Flow Bridge] Error processing job file:', e);
  }
}

function watchJobsFolder() {
  const jobWatcher = chokidar.watch(JOBS_FOLDER, { ignoreInitial: true, persistent: true });
  jobWatcher.on('add', filePath => {
    if (filePath.endsWith('.json') && path.basename(filePath).startsWith('flow-')) {
      processJobFile(filePath);
    }
  });
}

function checkExistingJobs() {
  if (!fs.existsSync(JOBS_FOLDER)) return;
  const files = fs.readdirSync(JOBS_FOLDER).filter(f => f.endsWith('.json') && f.startsWith('flow-'));
  files.forEach(f => processJobFile(path.join(JOBS_FOLDER, f)));
}

// ---------- Native Messaging (stdio) support for Chrome extension ----------

function sendNativeMessage(msg) {
  if (!nativePort) return;
  const data = JSON.stringify(msg);
  const buf = Buffer.from(data, 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(buf.length, 0);
  try {
    nativePort.write(lenBuf);
    nativePort.write(buf);
  } catch (e) {
    console.error('[Flow Bridge] Failed to send native message:', e);
  }
}

function handleNativeMessage(msg) {
  switch (msg.type) {
    case 'startJob':
      if (msg.jobId) {
        startDownloadWatcher(msg.jobId, msg.jobStartTime || Date.now(), msg.downloadFolder || DOWNLOAD_FOLDER);
        sendNativeMessage({ type: 'jobStarted', jobId: msg.jobId });
      }
      break;
    case 'stopJob':
      stopDownloadWatcher();
      sendNativeMessage({ type: 'jobStopped' });
      break;
    case 'downloadDetected':
      if (msg.filePath && activeJob && activeJob.jobId === msg.jobId) {
        handleDownloadFile(msg.filePath);
      }
      break;
    case 'ping':
      sendNativeMessage({ type: 'pong' });
      break;
  }
}

function readNativeMessageLength(callback) {
  const lenBuf = Buffer.alloc(4);
  let bytesRead = 0;
  function onData(chunk) {
    chunk.copy(lenBuf, bytesRead);
    bytesRead += chunk.length;
    if (bytesRead >= 4) {
      process.stdin.removeListener('data', onData);
      const len = lenBuf.readUInt32LE(0);
      if (len > 0 && len < 10 * 1024 * 1024) {
        readNativeMessageBody(len, callback);
      } else {
        console.error('[Flow Bridge] Invalid native message length:', len);
        process.exit(1);
      }
    }
  }
  process.stdin.on('data', onData);
}

function readNativeMessageBody(len, callback) {
  const bodyBuf = Buffer.alloc(len);
  let bytesRead = 0;
  function onData(chunk) {
    chunk.copy(bodyBuf, bytesRead);
    bytesRead += chunk.length;
    if (bytesRead >= len) {
      process.stdin.removeListener('data', onData);
      try {
        const msg = JSON.parse(bodyBuf.toString('utf8'));
        callback(msg);
      } catch (e) {
        console.error('[Flow Bridge] Failed to parse native message:', e);
      }
      readNativeMessageLength(callback); // read next message
    }
  }
  process.stdin.on('data', onData);
}

function startNativeMessaging() {
  // Set stdin to binary mode on Windows
  if (process.stdin.setRawMode) {
    try { process.stdin.setRawMode(true); } catch { }
  }
  process.stdin.resume();
  readNativeMessageLength(handleNativeMessage);
  console.log('[Flow Bridge] Native messaging stdio ready');
}

// Start native messaging only when explicitly requested via CLI flag
function isNativeHost() {
  return process.argv.includes('--native-messaging');
}

ensureFolders();
checkExistingJobs();
watchJobsFolder();

if (isNativeHost()) {
  startNativeMessaging();
} else {
  console.log('[Flow Bridge] Ready. Watching for job files (file-based mode)...');
}

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
