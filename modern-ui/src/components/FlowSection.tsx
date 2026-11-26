import { useState, useEffect, useRef, useCallback } from 'react';
import { useCore } from '../context/core-context';
import { useHost } from '../hooks/use-host';

const STATUS_SUBFOLDER = 'flow-status';
const JOB_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_SIMULATOR_URL = 'http://127.0.0.1:47821';
const DEFAULT_FLOW_PROJECT_URL = 'https://flow.google.com/project/a4627e24-447a-4dc0-b4fc-3eedceef27e6';
const DEFAULT_FLOW_HOME_URL = 'https://labs.google/fx/tools/flow';

interface FlowJob {
  type: 'generation' | 'restoration' | 'upscaling';
  state: 'waiting';
  jobId: string;
  prompt?: string;
  model?: string;
  aspectRatio?: string;
  quantity?: number;
  jobStartTime: number;
  downloadFolder: string;
  referenceImages?: string[];
}

interface FlowStatus {
  state: 'waiting' | 'processing' | 'complete' | 'error' | 'timeout' | 'placed';
  jobId: string;
  results?: string[];
  filePath?: string;
  mime?: string;
  message?: string;
  error?: string;
  time?: number;
}

interface FlowResult {
  filePath: string;
  name: string;
}

function generateJobId() {
  return 'flow-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

const ASPECT_RATIOS = [
  { id: '1:1', label: '1:1 (Square)' },
  { id: '16:9', label: '16:9 (Widescreen)' },
  { id: '9:16', label: '9:16 (Vertical)' },
  { id: '4:3', label: '4:3' },
  { id: '3:4', label: '3:4' },
];

const MODELS = [
  { id: 'nano-banana-2.1', label: 'Nano Banana 2.1 (Default)' },
  { id: 'nano-banana-pro', label: 'Nano Banana Pro' },
  { id: 'nano-banana-2-lite', label: 'Nano Banana 2 Lite (Fast)' },
];

export function FlowSection() {
  const { actions } = useCore();
  const { evalJsx } = useHost(actions.t);
  const [tool, setTool] = useState<'generation' | 'restoration' | 'upscaling'>('generation');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('nano-banana-2.1');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [quantity, setQuantity] = useState(1);
  const [status, setStatus] = useState<FlowStatus | null>(null);
  const [results, setResults] = useState<FlowResult[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStartTime, setJobStartTime] = useState<number | null>(null);
  const pollRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const manualFileRef = useRef<string | null>(null);

  // Simulation mode state
  const [simulationMode, setSimulationMode] = useState(false);
  const [simulatorUrl, setSimulatorUrl] = useState(DEFAULT_SIMULATOR_URL);
  const [simulatorConnected, setSimulatorConnected] = useState(false);
  const [flowProjectUrl, setFlowProjectUrl] = useState(() => {
    try { return localStorage.getItem('vb.flowProjectUrl') || DEFAULT_FLOW_PROJECT_URL; } catch { return DEFAULT_FLOW_PROJECT_URL; }
  });

  useEffect(() => {
    try { localStorage.setItem('vb.flowProjectUrl', flowProjectUrl); } catch {}
  }, [flowProjectUrl]);

  const models = MODELS;

  const pollStatus = useCallback(() => {
    if (!jobId) return;
    const bridgeFolder = actions.live.bridgeFolder || '';
    const statusPath = `${bridgeFolder.replace(/\\/g, '/')}/${STATUS_SUBFOLDER}/flow-${jobId}.json`;
    evalJsx(`VB.readTextFile("${statusPath}")`, (result) => {
      try {
        const data = JSON.parse(result || '{}') as FlowStatus;
        if (!data || !data.state) return;
        setStatus(data);
        if (data.state === 'complete' && data.results) {
          setResults(data.results.map((fp, i) => ({
            filePath: fp,
            name: fp.split('\\').pop() || `result-${i + 1}`,
          })));
          // Auto-import each result onto a new layer — no Place button required
          data.results.forEach(fp => placeResult(fp));
          stopPoll();
          stopTimeout();
        } else if (data.state === 'error') {
          stopPoll();
          stopTimeout();
        } else if (data.state === 'timeout') {
          stopPoll();
          stopTimeout();
        }
      } catch {}
    });
  }, [jobId, evalJsx, actions]);

  const startPoll = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = window.setInterval(pollStatus, 2000);
    pollStatus();
  }, [pollStatus]);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startTimeout = useCallback(() => {
    if (timeoutRef.current) return;
    timeoutRef.current = window.setTimeout(() => {
      const bridgeFolder = actions.live.bridgeFolder || '';
      const statusPath = `${bridgeFolder.replace(/\\/g, '/')}/${STATUS_SUBFOLDER}/flow-${jobId}.json`;
      evalJsx(`VB.writeTextFile("${statusPath}", ${JSON.stringify({ state: 'timeout', jobId, message: 'Job timed out after 15 minutes. Use "Choose result" to select a downloaded file manually.' })});`, () => {});
      stopPoll();
      setStatus({ state: 'timeout', jobId: jobId!, message: 'Job timed out after 15 minutes. Use "Choose result" to select a downloaded file manually.' });
    }, JOB_TIMEOUT_MS);
  }, [jobId, evalJsx, actions]);

  const stopTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const stopAll = useCallback(() => {
    stopPoll();
    stopTimeout();
  }, [stopPoll, stopTimeout]);

  useEffect(() => {
    return () => stopAll();
  }, [stopAll]);

  // Simulator health check
  const checkSimulatorHealth = useCallback(async () => {
    try {
      const res = await fetch(`${simulatorUrl}/api/health`);
      if (res.ok) {
        const data = await res.json();
        setSimulatorConnected(data.ok === true);
        return data.ok === true;
      }
    } catch {}
    setSimulatorConnected(false);
    return false;
  }, [simulatorUrl]);

  // Submit job to simulator
  const submitToSimulator = async (job: FlowJob, referenceImages: string[] = []) => {
    try {
      const res = await fetch(`${simulatorUrl}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: job.prompt || '',
          model: job.model || 'nano-banana-2.1',
          aspectRatio: job.aspectRatio || '1:1',
          quantity: job.quantity || 1,
          tool: job.type,
          referenceImages,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.errors?.join(', ') || `Simulator error: ${res.status}`);
      }
      const data = await res.json();
      return data.job;
    } catch (e) {
      throw new Error(`Simulator submission failed: ${e}`);
    }
  };

  const copyPromptToClipboard = async (text: string) => {
    if (simulationMode) return; // no need to copy in simulation mode
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
  };

  const buildPrompt = () => {
    if (tool === 'generation') {
      return prompt.trim() || '';
    }
    return prompt.trim() || 'Upscale this image, preserving all details, logos, text, colours and proportions.';
  };

  const openFlow = async () => {
    if (simulationMode) return; // simulation mode doesn't open Chrome

    const promptText = buildPrompt();
    await copyPromptToClipboard(promptText);

    const url = flowProjectUrl && flowProjectUrl.trim() ? flowProjectUrl.trim() : DEFAULT_FLOW_HOME_URL;
    const escUrl = url.replace(/"/g, '\\"').replace(/\\/g, '\\\\');

    const bridgeFolder = actions.live.bridgeFolder || '';
    const vbsPath = `${bridgeFolder.replace(/\\/g, '/')}/open_flow.vbs`;

    // Hidden VBScript launcher: no CMD window, reuses existing Chrome window when possible.
    const script = `
      try {
        var vbs = new File("${vbsPath.replace(/\\/g, '/')}");
        vbs.encoding = "UTF-8";
        if (vbs.open("w")) {
          vbs.writeln('Set wshShell = CreateObject("WScript.Shell")');
          vbs.writeln('wshShell.Run "chrome.exe --url ${escUrl}", 0, False');
          vbs.close();
          vbs.execute();
        }
      } catch(e) {
        VB.openUrl("${escUrl}");
      }
    `;
    evalJsx(script, result => { console.log('openFlow:', result); });
  };

  const writeJobFile = async (job: FlowJob) => {
    const bridgeFolder = actions.live.bridgeFolder || '';
    const statusDir = `${bridgeFolder.replace(/\\/g, '/')}/${STATUS_SUBFOLDER}`;
    const statusPath = `${statusDir}/flow-${job.jobId}.json`;
    const json = JSON.stringify(job);
    await new Promise<void>((resolve) => {
      evalJsx(`new Folder("${statusDir}").create();`, () => resolve());
    });
    return new Promise<void>((resolve, reject) => {
      evalJsx(`VB.writeTextFile("${statusPath}", ${JSON.stringify(json)});`, result => {
        try {
          if (result === 'ok') resolve();
          else reject(new Error('Write failed: ' + result));
        } catch {
          reject(new Error('Write failed: ' + result));
        }
      });
    });
  };

  const exportReferences = async () => {
    if (tool === 'generation') return { ok: true };
    const pngLongSide = tool === 'upscaling' || tool === 'restoration' ? 0 : 1700;
    const script = `VB.prepareBatch(${pngLongSide})`;
    return new Promise<any>((resolve, reject) => {
      evalJsx(script, result => {
        try {
          const parsed = JSON.parse(result);
          if (parsed.ok) resolve(parsed);
          else reject(new Error(parsed.error || 'Export failed'));
        } catch {
          reject(new Error('Host returned: ' + result));
        }
      });
    });
  };

  const startJob = async () => {
    if (!actions.live.bridgeFolder) {
      setStatus({ state: 'error', jobId: 'local', error: 'Host not loaded. Wait for "Ready to vectorize" first.' });
      return;
    }
    if (tool === 'generation' && !prompt.trim() && !simulationMode) {
      setStatus({ state: 'error', jobId: 'local', error: 'Please enter a prompt first.' });
      return;
    }

    const newJobId = generateJobId();
    const startTime = Date.now();
    setJobId(newJobId);
    setJobStartTime(startTime);
    setStatus({ state: 'waiting', jobId: newJobId, message: simulationMode ? 'Submitting to simulator…' : 'Preparing export…' });
    setResults([]);
    manualFileRef.current = null;
    stopAll();

    try {
      const exportResult = await exportReferences();
      const referenceImages = exportResult?.pngPaths || [];

      const job: FlowJob = {
        type: tool,
        state: 'waiting',
        jobId: newJobId,
        prompt: tool === 'generation' ? prompt : undefined,
        model,
        aspectRatio,
        quantity,
        jobStartTime: startTime,
        downloadFolder: 'C:\\Users\\user\\Downloads\\MockupStudioFlow',
      };

      await writeJobFile(job);

      if (simulationMode) {
        await new Promise(r => setTimeout(r, 500));
        const simJob = await submitToSimulator({ ...job, referenceImages });
        setStatus({ state: 'processing', jobId: newJobId, message: `Simulator job ${simJob.id} submitted. Processing…` });
      } else {
        setStatus({ state: 'waiting', jobId: newJobId, message: 'Flow opened. Use the Agent, paste your prompt, generate, and download.' });
        openFlow();
      }

      startPoll();
      startTimeout();
    } catch (e) {
      setStatus({ state: 'error', jobId: newJobId, error: String(e) });
      setJobId(null);
      setJobStartTime(null);
    }
  };

  const placeResult = (filePath: string) => {
    const layerName = tool === 'upscaling' ? 'Flow Upscaled' : 'Flow Result';
    const script = `VB.importImage ? VB.importImage(${JSON.stringify(filePath)}, ${JSON.stringify(layerName)}) : "importNotAvailable";`;
    evalJsx(script, result => {
      console.log('Import result:', result);
      setStatus({ state: 'placed', jobId: jobId || 'manual', message: `Image placed on "${layerName}" layer` });
    });
  };

  const chooseManualResult = () => {
    const downloadFolder = 'C:\\Users\\user\\Downloads\\MockupStudioFlow';
    const script = `VB.openFolder("${downloadFolder.replace(/\\/g, '/')}")`;
    evalJsx(script, () => {});
    manualFileRef.current = downloadFolder;
    setStatus(prev => prev ? { ...prev, message: 'Download folder opened. Select a file, then click "Use Selected File".' } : prev);
  };

  const useManualFile = (filePath: string) => {
    if (!filePath) return;
    manualFileRef.current = filePath;
    const layerName = tool === 'upscaling' ? 'Flow Upscaled' : 'Flow Result';
    const script = `VB.importImage ? VB.importImage(${JSON.stringify(filePath)}, ${JSON.stringify(layerName)}) : "importNotAvailable";`;
    evalJsx(script, result => {
      console.log('Manual import result:', result);
      setStatus({ state: 'placed', jobId: jobId || 'manual', message: `Image placed on "${layerName}" layer` });
      setResults([{ filePath, name: filePath.split('\\').pop() || 'result' }]);
    });
  };

  const reset = () => {
    stopAll();
    setJobId(null);
    setJobStartTime(null);
    setStatus(null);
    setResults([]);
    manualFileRef.current = null;
  };

  const isRunning = !!jobId;
  const quantityDisabled = tool === 'upscaling';
  const startLabel = tool === 'upscaling'
    ? (actions.t('flowStartUpscaling') || 'Start Upscaling')
    : tool === 'restoration'
      ? (actions.t('flowStartRestoration') || 'Start Restoration')
      : (actions.t('flowStartGeneration') || 'Start Generation');

  return (
    <details className="panel" id="flowBox">
      <summary className="panelTitleRow">
        <span className="panelTitle">{actions.t('flowTitle') || 'Google Flow AI'}</span>
        <span className="badge badge-flow" style={{ marginLeft: 8, fontSize: '10px', background: simulationMode ? '#fff3e0' : '#e8f0fe', color: simulationMode ? '#e65100' : '#1a73e8' }}>
          {simulationMode ? 'SIM' : 'BETA'}
        </span>
      </summary>
      <div className="hint">{actions.t('flowHint') || 'Generate or upscale images using Google Flow with your Workspace account. All generation is manual in Flow; results auto-detected on download.'}</div>

      <div className="settingsGrid" style={{ paddingTop: 8 }}>
        {/* Simulation mode controls */}
        <div className="field full">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={simulationMode}
              onChange={e => setSimulationMode(e.target.checked)}
              disabled={isRunning}
            />
            <strong>Simulation Mode</strong> (testing only — no live Google automation)
          </label>
          <div className="hint" style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
            When enabled, jobs go to the local Flow simulator instead of opening Chrome.
            Live Google automation remains disabled until authorization is established.
          </div>
        </div>

        {simulationMode && (
          <>
            <div className="field">
              <label>{actions.t('flowSimulatorUrl') || 'Simulator URL'}</label>
              <input
                type="text"
                value={simulatorUrl}
                onChange={e => setSimulatorUrl(e.target.value)}
                disabled={isRunning || simulatorConnected}
                style={{ width: '100%', fontSize: 11, padding: '4px' }}
              />
            </div>
            <div className="field full">
              <button
                className={`btn ${simulatorConnected ? 'secondary' : 'primary'}`}
                onClick={checkSimulatorHealth}
                disabled={isRunning || simulatorConnected}
                style={{ width: '100%', fontSize: 11, padding: '6px' }}
              >
                {simulatorConnected ? 'Simulator Connected' : 'Connect to Simulator'}
              </button>
              {simulatorConnected && (
                <div className="hint" style={{ fontSize: 11, color: '#4caf50', marginTop: 4 }}>
                  Simulator ready at {simulatorUrl}
                </div>
              )}
            </div>
          </>
        )}

        <div className="field">
          <label>{actions.t('flowProjectUrl') || 'Flow Project URL'}</label>
          <input
            type="text"
            value={flowProjectUrl}
            onChange={e => setFlowProjectUrl(e.target.value)}
            disabled={isRunning}
            style={{ width: '100%', fontSize: 11, padding: '4px' }}
          />
          <div className="hint" style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
            {actions.t('flowProjectUrlHint') || 'Persistent per employee. Defaults to your Flow project. Falls back to the Flow homepage if empty or unreachable.'}
          </div>
        </div>

        <div className="field">
          <label>{actions.t('flowTool') || 'Tool'}</label>
          <select value={tool} onChange={e => setTool(e.target.value === 'upscaling' ? 'upscaling' : e.target.value === 'restoration' ? 'restoration' : 'generation')} disabled={isRunning}>
            <option value="generation">{actions.t('flowGeneration') || 'Image Generation'}</option>
            <option value="restoration">{actions.t('flowRestoration') || 'Image Restoration'}</option>
            <option value="upscaling">{actions.t('flowUpscaling') || 'Image Upscaling'}</option>
          </select>
        </div>

        <div className="field">
          <label>{actions.t('flowModel') || 'Model'}</label>
          <select value={model} onChange={e => setModel(e.target.value)} disabled={isRunning}>
            {models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <div className="hint" style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
            {actions.t('flowModelPref') || 'Model preference. Flow Agent may route to a different model.'}
          </div>
        </div>

        {tool === 'generation' && (
          <>
            <div className="field">
              <label>{actions.t('flowAspectRatio') || 'Aspect Ratio'}</label>
              <select value={aspectRatio} onChange={e => setAspectRatio(e.target.value)} disabled={isRunning}>
                {ASPECT_RATIOS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>

            <div className="field">
              <label>{actions.t('flowQuantity') || 'Outputs'}</label>
              <input
                type="number"
                min={1}
                max={4}
                value={quantity}
                onChange={e => setQuantity(Math.max(1, Math.min(4, parseInt(e.target.value) || 1)))}
                disabled={isRunning || quantityDisabled}
                style={{ width: '60px' }}
              />
              <div className="hint" style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                {actions.t('flowQuantityHint') || 'Number of image variations. Flow Agent may adjust.'}
              </div>
            </div>

            <div className="field full">
              <label>{actions.t('flowPrompt') || 'Prompt'}</label>
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder={simulationMode ? actions.t('flowPromptPlaceholderSim') || 'Describe the image (simulator will generate a placeholder)...' : actions.t('flowPromptPlaceholder') || 'Describe the image you want to generate...'}
                disabled={isRunning}
                style={{ minHeight: 80 }}
              />
              <div className="hint">{actions.t('flowPromptHint') || 'Enter prompt, click Start. Flow opens in browser — paste prompt there, generate, download.'}</div>
            </div>
          </>
        )}

        {(tool === 'upscaling' || tool === 'restoration') && (
          <div className="field full">
            <div className="hint" style={{ padding: '8px', background: '#e8f5e9', borderRadius: '4px', border: '1px solid #c8e6c9' }}>
              <strong>{actions.t('flowUpscaleHint') || 'Upscaling/Restoration workflow:'}</strong> Select an image in Illustrator, click Start.
              The selection is exported at original resolution, processed, and the result is automatically placed on a new layer.
            </div>
          </div>
        )}

        <div className="field full">
          <button className="btn primary" onClick={startJob} disabled={isRunning || (tool === 'generation' && !prompt.trim() && !simulationMode)} style={{ width: '100%' }}>
            {isRunning ? (actions.t('flowJobRunning') || 'Job Running...') : startLabel}
          </button>
        </div>

        {isRunning && (
          <>
            <div className="field full">
              <button className="btn secondary" onClick={reset} style={{ width: '100%' }}>
                {actions.t('flowCancel') || 'Cancel Job'}
              </button>
            </div>
            {jobStartTime && (
              <div className="field full" style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                {actions.t('flowJobStarted') || 'Job started:'} {new Date(jobStartTime).toLocaleTimeString()}
                {' · '}{actions.t('flowTimeout') || 'Timeout:'} 15 min
              </div>
            )}
          </>
        )}

        {status && (
          <div className="field full">
            <div className={`status ${status.state}`} style={{ padding: '10px', borderRadius: 4, fontSize: 13, textAlign: 'center' }}>
              <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#666', marginBottom: 4 }}>Job: {status.jobId}</div>
              <div>{status.message || status.error || `State: ${status.state}`}</div>
            </div>
          </div>
        )}

        {results.length > 0 && (
          <>
            <div className="field full">
              <label>{actions.t('flowResults') || 'Results'}</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                {results.map((r, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, background: '#f5f5f5', borderRadius: 4, border: '1px solid #eee' }}>
                    <img src={`file:///${r.filePath.replace(/\\/g, '/')}`} alt={`Result ${i + 1}`} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 4 }} />
                    <div style={{ flex: 1, fontSize: 11, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                    <span style={{ fontSize: 10, color: '#4caf50', fontWeight: 600 }}>{actions.t('flowPlaced') || 'Placed'}</span>
                  </div>
                ))}
              </div>
              <div className="hint" style={{ fontSize: 11, color: '#4caf50', marginTop: 4 }}>
                {actions.t('flowAutoPlaced') || 'Results automatically placed on new Illustrator layers.'}
              </div>
            </div>

            {status?.state === 'timeout' && (
              <div className="field full" style={{ marginTop: 8 }}>
                <button className="btn secondary" onClick={chooseManualResult} style={{ width: '100%', fontSize: 11, padding: '6px' }}>
                  {actions.t('flowChooseResult') || 'Choose Result File…'}
                </button>
              </div>
            )}

            {manualFileRef.current && (
              <div className="field full" style={{ marginTop: 8 }}>
                <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>
                  {actions.t('flowManualPath') || 'Or enter file path:'}
                </div>
                <input
                  type="text"
                  value={manualFileRef.current || ''}
                  onChange={e => { manualFileRef.current = e.target.value || null; }}
                  disabled={isRunning}
                  style={{ width: '100%', fontSize: 11, padding: '4px' }}
                />
                <button className="btn primary" onClick={() => useManualFile(manualFileRef.current || '')} style={{ width: '100%', marginTop: 6, fontSize: 11, padding: '6px' }}>
                  {actions.t('flowUseFile') || 'Use Selected File'}
                </button>
              </div>
            )}
          </>
        )}

        <div className="field full" style={{ fontSize: 11, color: '#666', marginTop: 8 }}>
          <div>Native host: {actions.live.bridgeFolder ? 'Ready' : 'Not ready'}</div>
          <div>Download folder: C:\\Users\\user\\Downloads\\MockupStudioFlow</div>
          <div className="hint" style={{ marginTop: 4 }}>{actions.t('flowAgentHint') || 'Tip: In Flow, enable the Agent, paste the copied prompt, and generate. Download results to the folder above.'}</div>
        </div>
      </div>
    </details>
  );
}
