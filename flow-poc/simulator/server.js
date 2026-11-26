const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const PORT = 47821;
const DOWNLOAD_FOLDER = path.join(process.env.USERPROFILE || process.env.HOME, 'Downloads', 'MockupStudioFlow');
const JOBS_FOLDER = path.join(process.env.USERPROFILE || process.env.HOME, 'Documents', 'VectorizerBridge', 'flow-simulator-jobs');
const RESULTS_FOLDER = path.join(process.env.USERPROFILE || process.env.HOME, 'Documents', 'VectorizerBridge', 'flow-simulator-results');

// Simulated credit limits (FlowPilot pattern)
const CREDIT_LIMITS = {
  perJob: 20,
  monthly: 1000,
};
let monthlyCreditsUsed = 0;

// Available models (verified against Google Flow docs)
const AVAILABLE_MODELS = [
  'nano-banana-2.1',
  'nano-banana-pro',
  'nano-banana-2-lite',
];

const DEFAULT_MODEL = 'nano-banana-2.1';
const DEFAULT_ASPECT_RATIO = '1:1';
const DEFAULT_QUANTITY = 1;

const jobs = new Map();
const jobQueue = [];
let processing = false;

function ensureFolders() {
  [DOWNLOAD_FOLDER, JOBS_FOLDER, RESULTS_FOLDER].forEach(f => {
    if (!fs.existsSync(f)) fs.mkdirSync(f, { recursive: true });
  });
}

function createPng(width, height, color) {
  // Minimal PNG generator: solid color rectangle
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 2;  // color type: RGB
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const ihdrCrc = Buffer.from(crypto.createHash('crc32').update(Buffer.concat([Buffer.from('IHDR'), ihdrData])).digest('latin1'), 'latin1');
  const ihdrLen = Buffer.alloc(4);
  ihdrLen.writeUInt32BE(13, 0);
  const ihdrType = Buffer.from('IHDR');

  // Build raw image data with filter bytes
  const rowBytes = width * 3 + 1;
  const raw = Buffer.alloc(height * rowBytes);
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowBytes;
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      raw[rowStart + 1 + x * 3] = color[0];
      raw[rowStart + 2 + x * 3] = color[1];
      raw[rowStart + 3 + x * 3] = color[2];
    }
  }

  const compressed = zlib.deflateSync(raw);
  const idatCrc = Buffer.from(crypto.createHash('crc32').update(Buffer.concat([Buffer.from('IDAT'), compressed])).digest('latin1'), 'latin1');
  const idatLen = Buffer.alloc(4);
  idatLen.writeUInt32BE(compressed.length, 0);
  const idatType = Buffer.from('IDAT');

  const iendCrc = Buffer.from(crypto.createHash('crc32').update(Buffer.from('IEND')).digest('latin1'), 'latin1');
  const iendLen = Buffer.alloc(4);
  iendLen.writeUInt32BE(0, 0);
  const iendType = Buffer.from('IEND');

  return Buffer.concat([sig, ihdrLen, ihdrType, ihdrData, ihdrCrc, idatLen, idatType, compressed, idatCrc, iendLen, iendType, iendCrc]);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function validateJob(body) {
  const errors = [];

  if (!body.prompt || !body.prompt.trim()) {
    errors.push('Prompt is required');
  }

  const model = body.model || DEFAULT_MODEL;
  if (!AVAILABLE_MODELS.includes(model)) {
    errors.push(`Model "${model}" not available. Options: ${AVAILABLE_MODELS.join(', ')}`);
  }

  const aspectRatio = body.aspectRatio || DEFAULT_ASPECT_RATIO;
  const validRatios = ['1:1', '16:9', '9:16', '4:3', '3:4'];
  if (!validRatios.includes(aspectRatio)) {
    errors.push(`Aspect ratio "${aspectRatio}" not supported. Options: ${validRatios.join(', ')}`);
  }

  const quantity = body.quantity || DEFAULT_QUANTITY;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 4) {
    errors.push('Quantity must be an integer between 1 and 4');
  }

  // Pre-spend credit check (Flow Pilot pattern)
  const estimatedCredits = quantity * 1; // 1 credit per image (Nano Banana is 0 on Pro, but we simulate)
  if (monthlyCreditsUsed + estimatedCredits > CREDIT_LIMITS.monthly) {
    errors.push(`Monthly credit limit would be exceeded (used ${monthlyCreditsUsed}/${CREDIT_LIMITS.monthly})`);
  }
  if (estimatedCredits > CREDIT_LIMITS.perJob) {
    errors.push(`Per-job credit limit exceeded (${estimatedCredits} > ${CREDIT_LIMITS.perJob})`);
  }

  return { errors, model, aspectRatio, quantity, estimatedCredits };
}

function createJob(body) {
  const validation = validateJob(body);
  if (validation.errors.length > 0) {
    return { ok: false, errors: validation.errors };
  }

  const jobId = 'sim-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
  const now = Date.now();

  const job = {
    id: jobId,
    state: 'queued',
    prompt: body.prompt.trim(),
    model: validation.model,
    aspectRatio: validation.aspectRatio,
    quantity: validation.quantity,
    tool: body.tool || 'generation',
    referenceImages: body.referenceImages || [],
    createdAt: now,
    updatedAt: now,
    results: [],
    error: null,
    estimatedCredits: validation.estimatedCredits,
  };

  jobs.set(jobId, job);
  jobQueue.push(jobId);

  // Persist job
  fs.writeFileSync(
    path.join(JOBS_FOLDER, `${jobId}.json`),
    JSON.stringify(job, null, 2),
    'utf8'
  );

  processQueue();

  return { ok: true, job };
}

function processQueue() {
  if (processing) return;
  const nextId = jobQueue.shift();
  if (!nextId) return;

  const job = jobs.get(nextId);
  if (!job) {
    processQueue();
    return;
  }

  processing = true;
  runJob(job);
}

async function runJob(job) {
  try {
    job.state = 'generating';
    job.updatedAt = Date.now();
    persistJob(job);

    // Simulate generation delay (1-3 seconds)
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));

    // Generate output images
    const results = [];
    for (let i = 0; i < job.quantity; i++) {
      const resultName = `sim_${job.id}_${i + 1}.png`;
      const resultPath = path.join(DOWNLOAD_FOLDER, resultName);

      // If reference images provided, copy the first one as a base
      if (job.referenceImages && job.referenceImages.length > 0) {
        try {
          fs.copyFileSync(job.referenceImages[0], resultPath);
        } catch {
          createAndSavePng(resultPath, 512, 512, [100, 150, 200]);
        }
      } else {
        // Generate a solid color based on prompt hash
        const hash = crypto.createHash('md5').update(job.prompt).digest();
        const color = [hash[0] % 256, hash[1] % 256, hash[2] % 256];
        createAndSavePng(resultPath, 512, 512, color);
      }

      results.push(resultPath);
    }

    job.state = 'complete';
    job.results = results;
    job.updatedAt = Date.now();
    monthlyCreditsUsed += job.estimatedCredits;
    persistJob(job);

    // Write status file for the bridge to detect (same format as FlowSection expects)
    const statusFile = path.join(
      process.env.USERPROFILE || process.env.HOME,
      'Documents',
      'VectorizerBridge',
      'flow-status',
      `flow-${job.id.replace('sim-', '')}.json`
    );
    // Ensure the job ID format matches what FlowSection expects (flow-<timestamp>-<random>)
    // The simulator uses sim- prefix, so we need to map it
    const flowJobId = 'flow-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
    const flowStatusFile = path.join(
      process.env.USERPROFILE || process.env.HOME,
      'Documents',
      'VectorizerBridge',
      'flow-status',
      `flow-${flowJobId}.json`
    );

    // Write a job file that the bridge will pick up (state: waiting)
    const flowJob = {
      type: job.tool,
      state: 'waiting',
      jobId: flowJobId,
      prompt: job.prompt,
      model: job.model,
      aspectRatio: job.aspectRatio,
      quantity: job.quantity,
      jobStartTime: job.createdAt,
      downloadFolder: DOWNLOAD_FOLDER,
    };
    fs.writeFileSync(flowStatusFile + '.tmp', JSON.stringify(flowJob), 'utf8');
    fs.renameSync(flowStatusFile + '.tmp', flowStatusFile);

    // Now write the result files with names that include the flow job ID
    // so the bridge can match them by timestamp
    for (let i = 0; i < results.length; i++) {
      const resultName = `flow-${flowJobId}-${i + 1}.png`;
      const resultPath = path.join(DOWNLOAD_FOLDER, resultName);
      fs.copyFileSync(results[i], resultPath);
    }

  } catch (e) {
    job.state = 'error';
    job.error = String(e);
    job.updatedAt = Date.now();
    persistJob(job);
  } finally {
    processing = false;
    processQueue();
  }
}

function createAndSavePng(filePath, width, height, color) {
  const png = createPng(width, height, color);
  fs.writeFileSync(filePath, png);
}

function persistJob(job) {
  fs.writeFileSync(
    path.join(JOBS_FOLDER, `${job.id}.json`),
    JSON.stringify(job, null, 2),
    'utf8'
  );
}

function getJob(id) {
  const job = jobs.get(id);
  if (!job) return null;
  return { ...job };
}

function listJobs() {
  return Array.from(jobs.values()).sort((a, b) => b.createdAt - a.createdAt);
}

function cancelJob(id) {
  const job = jobs.get(id);
  if (!job) return false;
  if (job.state === 'queued') {
    job.state = 'cancelled';
    job.updatedAt = Date.now();
    persistJob(job);
    return true;
  }
  return false; // running jobs cannot be cancelled (Flow Pilot pattern)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // CORS for local testing
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (pathname === '/api/jobs' && req.method === 'POST') {
      const body = await parseBody(req);
      const result = createJob(body);
      if (!result.ok) {
        sendJson(res, 400, { ok: false, errors: result.errors });
      } else {
        sendJson(res, 201, { ok: true, job: result.job });
      }
    } else if (pathname === '/api/jobs' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, jobs: listJobs() });
    } else if (pathname.match(/^\/api\/jobs\/([^/]+)$/) && req.method === 'GET') {
      const id = pathname.match(/^\/api\/jobs\/([^/]+)$/)[1];
      const job = getJob(id);
      if (!job) {
        sendJson(res, 404, { ok: false, error: 'Job not found' });
      } else {
        sendJson(res, 200, { ok: true, job });
      }
    } else if (pathname.match(/^\/api\/jobs\/([^/]+)\/cancel$/) && req.method === 'POST') {
      const id = pathname.match(/^\/api\/jobs\/([^/]+)\/cancel$/)[1];
      const cancelled = cancelJob(id);
      if (!cancelled) {
        sendJson(res, 400, { ok: false, error: 'Job not found or cannot be cancelled' });
      } else {
        sendJson(res, 200, { ok: true, message: 'Job cancelled' });
      }
    } else if (pathname === '/api/config' && req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        models: AVAILABLE_MODELS,
        defaultModel: DEFAULT_MODEL,
        aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
        defaultAspectRatio: DEFAULT_ASPECT_RATIO,
        maxQuantity: 4,
        creditLimits: CREDIT_LIMITS,
        monthlyCreditsUsed,
      });
    } else if (pathname === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, service: 'flow-simulator', version: '0.1.0' });
    } else {
      sendJson(res, 404, { ok: false, error: 'Not found' });
    }
  } catch (e) {
    sendJson(res, 500, { ok: false, error: String(e) });
  }
});

ensureFolders();
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[Flow Simulator] Listening on http://127.0.0.1:${PORT}`);
  console.log(`[Flow Simulator] Download folder: ${DOWNLOAD_FOLDER}`);
  console.log(`[Flow Simulator] Credit limit: ${CREDIT_LIMITS.perJob}/job, ${CREDIT_LIMITS.monthly}/month`);
});

process.on('SIGINT', () => {
  server.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  server.close();
  process.exit(0);
});
