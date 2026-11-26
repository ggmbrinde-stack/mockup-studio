const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');

const BRIDGE_FOLDER = path.join(process.env.USERPROFILE || process.env.HOME, 'Documents', 'VectorizerBridge');
const STATUS_FOLDER = path.join(BRIDGE_FOLDER, 'flow-status');
const DOWNLOAD_FOLDER = path.join(process.env.USERPROFILE || process.env.HOME, 'Downloads', 'MockupStudioFlow');
const SETTLE_DELAY_MS = 3000; // wait for downloads to settle before marking complete

function ensureFolders() {
  [BRIDGE_FOLDER, STATUS_FOLDER, DOWNLOAD_FOLDER].forEach(f => {
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

let activeJob = null; // { jobId, jobStartTime, downloadFolder, results: [], settleTimer: null }
let downloadWatcher = null;
let processedDownloads = new Set(); // track already-processed download paths

function startDownloadWatcher(jobId, jobStartTime, downloadFolder) {
  activeJob = {
    jobId,
    jobStartTime,
    downloadFolder: downloadFolder || DOWNLOAD_FOLDER,
    results: [],
    settleTimer: null,
  };
  writeStatus(jobId, { state: 'waiting', jobId, message: 'Watching for downloads...', jobStartTime });

  if (!fs.existsSync(downloadFolder)) {
    writeStatus(jobId, { state: 'error', error: 'Download folder not found', jobId });
    return;
  }

  downloadWatcher = chokidar.watch(downloadFolder, { ignoreInitial: true, persistent: true });
  downloadWatcher.on('add', filePath => {
    handleDownloadFile(filePath);
  });
  downloadWatcher.on('change', filePath => {
    handleDownloadFile(filePath);
  });
  downloadWatcher.on('error', err => {
    if (activeJob && activeJob.jobId === jobId) {
      writeStatus(activeJob.jobId, { state: 'error', error: String(err), jobId });
    }
  });
}

function stopDownloadWatcher() {
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
    const mtime = stat.mtime.getTime();
    if (mtime < activeJob.jobStartTime - 5000) {
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

function watchStatusFolder() {
  const jobWatcher = chokidar.watch(STATUS_FOLDER, { ignoreInitial: true, persistent: true });
  jobWatcher.on('add', filePath => {
    if (filePath.endsWith('.json') && path.basename(filePath).startsWith('flow-')) {
      processJobFile(filePath);
    }
  });
}

function checkExistingJobs() {
  if (!fs.existsSync(STATUS_FOLDER)) return;
  const files = fs.readdirSync(STATUS_FOLDER).filter(f => f.endsWith('.json') && f.startsWith('flow-'));
  files.forEach(f => processJobFile(path.join(STATUS_FOLDER, f)));
}

ensureFolders();
checkExistingJobs();
watchStatusFolder();

console.log('[Flow Bridge] Ready. Watching for job files...');

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
