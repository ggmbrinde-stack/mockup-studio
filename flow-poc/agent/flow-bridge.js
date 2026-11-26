const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');

const BRIDGE_FOLDER = path.join(process.env.USERPROFILE || process.env.HOME, 'Documents', 'VectorizerBridge');
const JOBS_FOLDER = path.join(BRIDGE_FOLDER, 'flow-jobs');
const STATUS_FOLDER = path.join(BRIDGE_FOLDER, 'flow-status');
const DOWNLOAD_FOLDER = path.join(process.env.USERPROFILE || process.env.HOME, 'Downloads', 'MockupStudioFlow');
const SETTLE_DELAY_MS = 3000; // wait for downloads to settle before marking complete
const INITIAL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes: if no downloads arrive, fail the job
const JOB_CLEANUP_MS = 5 * 60 * 1000; // clean up completed job state after 5 minutes

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

// jobs: Map<jobId, { jobId, jobStartTime, downloadFolder, results: [], watcher, settleTimer, initialTimer, processedDownloads: Set, cleanupTimer }>
const jobs = new Map();

function startDownloadWatcher(jobId, jobStartTime, downloadFolder) {
  // Close any existing watcher for this job
  stopDownloadWatcher(jobId);

  // Stop all other active job watchers — only one job can watch the download
  // folder at a time to prevent cross-job file contamination
  jobs.forEach((j, id) => {
    if (id !== jobId) {
      stopDownloadWatcher(id);
      jobs.delete(id);
    }
  });

  const job = {
    jobId,
    jobStartTime,
    downloadFolder: downloadFolder || DOWNLOAD_FOLDER,
    results: [],
    watcher: null,
    settleTimer: null,
    initialTimer: null,
    processedDownloads: new Set(),
    cleanupTimer: null,
  };
  jobs.set(jobId, job);

  writeStatus(jobId, { state: 'waiting', jobId, message: 'Watching for downloads...', jobStartTime });

  if (!fs.existsSync(downloadFolder)) {
    writeStatus(jobId, { state: 'error', error: 'Download folder not found', jobId });
    jobs.delete(jobId);
    return;
  }

  // Initial timeout: if no downloads arrive within INITIAL_TIMEOUT_MS, fail the job
  job.initialTimer = setTimeout(() => {
    const j = jobs.get(jobId);
    if (!j || j.results.length === 0) {
      writeStatus(jobId, { state: 'error', error: 'No downloads detected within timeout period', jobId });
    }
    stopDownloadWatcher(jobId);
  }, INITIAL_TIMEOUT_MS);

  job.watcher = chokidar.watch(downloadFolder, { ignoreInitial: true, persistent: true });
  job.watcher.on('add', filePath => {
    handleDownloadFile(jobId, filePath);
  });
  job.watcher.on('change', filePath => {
    handleDownloadFile(jobId, filePath);
  });
  job.watcher.on('error', err => {
    const j = jobs.get(jobId);
    if (!j) return;
    // EBUSY on Windows during file write is transient — log and continue watching
    if (!err.message.includes('EBUSY') && !err.message.includes('resource busy')) {
      writeStatus(jobId, { state: 'error', error: String(err), jobId });
      stopDownloadWatcher(jobId);
    }
  });
}

function stopDownloadWatcher(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;

  if (job.initialTimer) {
    clearTimeout(job.initialTimer);
    job.initialTimer = null;
  }
  if (job.settleTimer) {
    clearTimeout(job.settleTimer);
    job.settleTimer = null;
  }
  if (job.cleanupTimer) {
    clearTimeout(job.cleanupTimer);
    job.cleanupTimer = null;
  }
  if (job.watcher) {
    job.watcher.close();
    job.watcher = null;
  }
}

function isDownloadComplete(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function resetSettleTimer(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  if (job.settleTimer) {
    clearTimeout(job.settleTimer);
  }
  job.settleTimer = setTimeout(() => {
    const j = jobs.get(jobId);
    if (!j) return;
    if (j.results.length === 0) {
      writeStatus(jobId, {
        state: 'error',
        error: 'No downloads detected within settle period',
        jobId,
      });
    } else {
      writeStatus(jobId, {
        state: 'complete',
        jobId,
        results: [...j.results],
        filePath: j.results[j.results.length - 1],
        mime: getMime(j.results[j.results.length - 1]),
        message: `Downloaded ${j.results.length} file(s)`,
      });
    }
    // Schedule cleanup after completion
    j.cleanupTimer = setTimeout(() => {
      stopDownloadWatcher(jobId);
      jobs.delete(jobId);
    }, JOB_CLEANUP_MS);
  }, SETTLE_DELAY_MS);
}

function handleDownloadFile(jobId, filePath) {
  const job = jobs.get(jobId);
  if (!job) return;
  if (job.processedDownloads.has(filePath)) return;

  // Only process files created after the job started
  try {
    const stat = fs.statSync(filePath);
    // Use birthtime (file creation time) because copyFileSync preserves source mtime/ctime
    const creationTime = stat.birthtime ? stat.birthtime.getTime() : stat.ctime.getTime();
    if (creationTime < job.jobStartTime - 5000) {
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

  job.processedDownloads.add(filePath);

  if (!job.results) job.results = [];
  job.results.push(filePath);

  writeStatus(jobId, {
    state: 'waiting',
    jobId,
    results: [...job.results],
    filePath: filePath,
    mime: getMime(filePath),
    message: `Downloading ${job.results.length} file(s)…`,
  });

  resetSettleTimer(jobId);
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

// Native messaging protocol: 4-byte little-endian length prefix + JSON body.
// Uses an accumulator buffer to handle partial reads correctly.
let stdinBuffer = Buffer.alloc(0);

function sendNativeMessage(msg) {
  const data = JSON.stringify(msg);
  const buf = Buffer.from(data, 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(buf.length, 0);
  try {
    process.stdout.write(lenBuf);
    process.stdout.write(buf);
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
      stopDownloadWatcher(msg.jobId || 'all');
      if (msg.jobId) {
        const job = jobs.get(msg.jobId);
        if (job) {
          jobs.delete(msg.jobId);
        }
      } else {
        jobs.forEach((_, id) => stopDownloadWatcher(id));
        jobs.clear();
      }
      sendNativeMessage({ type: 'jobStopped', jobId: msg.jobId || 'all' });
      break;
    case 'downloadDetected':
      if (msg.filePath && msg.jobId) {
        const job = jobs.get(msg.jobId);
        if (job) {
          handleDownloadFile(msg.jobId, msg.filePath);
        } else {
          console.error(`[Flow Bridge] downloadDetected: no active job for jobId=${msg.jobId}`);
        }
      }
      break;
    case 'ping':
      sendNativeMessage({ type: 'pong' });
      break;
    case 'listJobs':
      const jobList = Array.from(jobs.values()).map(j => ({
        jobId: j.jobId,
        state: j.results.length > 0 ? 'complete' : 'waiting',
        resultCount: j.results.length,
      }));
      sendNativeMessage({ type: 'jobList', jobs: jobList });
      break;
  }
}

function onStdinData(chunk) {
  stdinBuffer = Buffer.concat([stdinBuffer, chunk]);
  // Parse as many complete messages as possible from the buffer
  while (stdinBuffer.length >= 4) {
    const len = stdinBuffer.readUInt32LE(0);
    if (len <= 0 || len > 10 * 1024 * 1024) {
      console.error('[Flow Bridge] Invalid native message length:', len);
      process.exit(1);
    }
    if (stdinBuffer.length < 4 + len) break; // incomplete message, wait for more
    const body = stdinBuffer.subarray(4, 4 + len);
    stdinBuffer = stdinBuffer.subarray(4 + len);
    try {
      const msg = JSON.parse(body.toString('utf8'));
      handleNativeMessage(msg);
    } catch (e) {
      console.error('[Flow Bridge] Failed to parse native message:', e);
    }
  }
}

function startNativeMessaging() {
  if (process.stdin.setRawMode) {
    try { process.stdin.setRawMode(true); } catch { }
  }
  process.stdin.resume();
  process.stdin.on('data', onStdinData);
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
