import { useState, useEffect, useRef, useCallback } from 'react';

const BRIDGE_FOLDER = 'Documents/VectorizerBridge';
const STATUS_FOLDER = `${BRIDGE_FOLDER}/flow-status`;

function generateJobId() {
  return 'flow-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

function getDownloadFolder() {
  // In browser, we can't access os.homedir(). Use a default that matches the native host.
  // The native host uses: path.join(process.env.USERPROFILE || process.env.HOME, 'Downloads', 'MockupStudioFlow')
  // For testing in browser, we'll use a placeholder. The actual path comes from native host.
  if (typeof window !== 'undefined' && window.navigator?.userAgent?.includes('Windows')) {
    return 'C:\\Users\\' + (window.navigator.userData?.username || 'user') + '\\Downloads\\MockupStudioFlow';
  }
  return '/home/user/Downloads/MockupStudioFlow';
}

function getNativeHostName() {
  return 'com.bestofgifts.mockupstudio.flow';
}

export default function App() {
  const [tool, setTool] = useState('generation');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('nano-banana-2.1');
  const [status, setStatus] = useState(null);
  const [resultImage, setResultImage] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [hostConnected, setHostConnected] = useState(false);
  const [extensionId, setExtensionId] = useState(null);
  const pollRef = useRef(null);

  const models = [
    { id: 'nano-banana-2.1', label: 'Nano Banana 2.1 (Default)' },
    { id: 'nano-banana-pro', label: 'Nano Banana Pro (Advanced)' },
    { id: 'nano-banana-2-lite', label: 'Nano Banana 2 Lite (Fast)' }
  ];

  const pollStatus = useCallback(() => {
    if (!jobId) return;
    fetch(`file:///${STATUS_FOLDER.replace(/\\/g, '/')}/flow-${jobId}.json`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setStatus(data);
          if (data.state === 'complete' && data.filePath) {
            setResultImage(`file:///${data.filePath.replace(/\\/g, '/')}`);
            stopPoll();
          } else if (data.state === 'error') {
            stopPoll();
          }
        }
      })
      .catch(() => {});
  }, [jobId]);

  const startPoll = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(pollStatus, 2000);
    pollStatus();
  }, [pollStatus]);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    checkHostConnection();
    return () => stopPoll();
  }, [stopPoll]);

  const checkHostConnection = async () => {
    if (!window.chrome || !window.chrome.runtime) return;
    try {
      const response = await new Promise(resolve => {
        window.chrome.runtime.sendNativeMessage(getNativeHostName(), { type: 'ping' }, resolve);
      });
      if (response?.extensionId) {
        setExtensionId(response.extensionId);
        setHostConnected(true);
      }
    } catch (e) {
      console.log('Host not connected:', e);
    }
  };

  const exportReferences = async () => {
    try {
      const cs = window.CSInterface ? new window.CSInterface() : null;
      if (!cs) throw new Error('CSInterface not available');
      
      const extPath = cs.getSystemPath('extension');
      const script = `
        $.global.VB = $.global.VB || {};
        $.evalFile(new File("${extPath.replace(/\\/g, '/')}/host/json.jsx"));
        $.evalFile(new File("${extPath.replace(/\\/g, '/')}/host/core.jsx"));
        $.evalFile(new File("${extPath.replace(/\\/g, '/')}/host/batch.jsx"));
        VB.prepareBatch(1700);
      `;
      
      return new Promise((resolve, reject) => {
        cs.evalScript(script, result => {
          try {
            const parsed = JSON.parse(result);
            if (parsed.ok) resolve(parsed);
            else reject(new Error(parsed.error || 'Export failed'));
          } catch {
            reject(new Error('Invalid host response'));
          }
        });
      });
    } catch (e) {
      throw new Error('Export failed: ' + e.message);
    }
  };

  const openFlow = () => {
    const url = `https://flow.google.com/?model=${encodeURIComponent(model)}`;
    if (window.chrome && window.chrome.tabs) {
      window.chrome.tabs.create({ url });
    } else {
      window.open(url, '_blank');
    }
  };

  const sendToNative = (msg) => {
    if (!window.chrome || !window.chrome.runtime) return Promise.reject(new Error('Chrome runtime not available'));
    return new Promise((resolve, reject) => {
      window.chrome.runtime.sendNativeMessage(getNativeHostName(), msg, response => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(response);
      });
    });
  };

  const startGeneration = async () => {
    if (!prompt.trim()) return;
    
    const newJobId = generateJobId();
    setJobId(newJobId);
    setStatus({ state: 'exporting', jobId: newJobId });
    setResultImage(null);

    try {
      const exportResult = await exportReferences();
      const downloadFolder = getDownloadFolder();
      
      await sendToNative({ type: 'startJob', jobId: newJobId, downloadFolder });

      setStatus({ state: 'waiting', jobId: newJobId, message: 'Flow opened. Upload references, enter prompt, generate, and download.' });
      openFlow();
      startPoll();

    } catch (e) {
      setStatus({ state: 'error', jobId: newJobId, error: e.message });
      setJobId(null);
    }
  };

  const startUpscaling = async () => {
    // Upscaling: export selection, user uploads to Flow, downloads result
    const newJobId = generateJobId();
    setJobId(newJobId);
    setStatus({ state: 'exporting', jobId: newJobId });
    setResultImage(null);

    try {
      const exportResult = await exportReferences();
      const downloadFolder = getDownloadFolder();
      
      await sendToNative({ type: 'startJob', jobId: newJobId, downloadFolder });

      setStatus({ state: 'waiting', jobId: newJobId, message: 'Flow opened. Upload your image, choose upscale model, generate, and download.' });
      openFlow();
      startPoll();

    } catch (e) {
      setStatus({ state: 'error', jobId: newJobId, error: e.message });
      setJobId(null);
    }
  };

  const placeResult = () => {
    if (!resultImage || !jobId) return;
    
    try {
      const cs = window.CSInterface ? new window.CSInterface() : null;
      if (!cs) throw new Error('CSInterface not available');
      
      const extPath = cs.getSystemPath('extension');
      const filePath = resultImage.replace('file:///', '').replace(/\//g, '\\');
      const layerName = tool === 'upscaling' ? 'Flow Upscaled' : 'Flow Result';
      const script = `
        $.evalFile(new File("${extPath.replace(/\\/g, '/')}/host/json.jsx"));
        $.evalFile(new File("${extPath.replace(/\\/g, '/')}/host/core.jsx"));
        $.evalFile(new File("${extPath.replace(/\\/g, '/')}/host/import.jsx"));
        VB.importImage ? VB.importImage(${JSON.stringify(filePath)}, ${JSON.stringify(layerName)}) : "importNotAvailable";
      `;
      
      cs.evalScript(script, result => {
        console.log('Import result:', result);
        setStatus({ state: 'placed', jobId, message: `Image placed on "${layerName}" layer` });
      });
    } catch (e) {
      setStatus({ state: 'error', jobId, error: 'Import failed: ' + e.message });
    }
  };

  const reset = () => {
    stopPoll();
    setJobId(null);
    setStatus(null);
    setResultImage(null);
    sendToNative({ type: 'stopJob' }).catch(() => {});
  };

  const isRunning = !!jobId;
  const startAction = tool === 'upscaling' ? startUpscaling : startGeneration;
  const startLabel = tool === 'upscaling' ? 'Start Upscaling' : 'Start Generation';

  return (
    <div className="container">
      <h1>Mockup Studio — Flow PoC</h1>
      
      <div className="section">
        <label>Tool</label>
        <select value={tool} onChange={e => setTool(e.target.value)} disabled={isRunning}>
          <option value="generation">Image Generation</option>
          <option value="upscaling">Image Upscaling</option>
        </select>
      </div>

      <div className="section">
        <label>Model</label>
        <select value={model} onChange={e => setModel(e.target.value)} disabled={isRunning}>
          {models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </div>

      {tool === 'generation' && (
        <div className="section">
          <label>Prompt</label>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="Describe the image you want to generate..."
            disabled={isRunning}
          />
          <div className="hint">Enter your prompt, then click Start. Flow will open in your browser.</div>
        </div>
      )}

      {tool === 'upscaling' && (
        <div className="section">
          <div className="hint" style={{ padding: '8px', background: '#e8f5e9', borderRadius: '4px' }}>
            <strong>Upscaling workflow:</strong> Select an image in Illustrator, click Start. 
            Flow opens — upload the exported image, choose upscale settings, generate, and download.
          </div>
        </div>
      )}

      <button className="btn-primary" onClick={startAction} disabled={isRunning || (tool === 'generation' && !prompt.trim())}>
        {isRunning ? 'Job Running...' : startLabel}
      </button>

      {isRunning && (
        <button className="btn-secondary" style={{ marginTop: 8 }} onClick={reset}>
          Cancel Job
        </button>
      )}

      {status && (
        <div className={`status ${status.state}`}>
          <div className="job-id">Job: {status.jobId}</div>
          <div>{status.message || status.error || `State: ${status.state}`}</div>
        </div>
      )}

      {resultImage && (
        <div className="section">
          <label>Result Preview</label>
          <img className="preview" src={resultImage} alt="Flow result" />
          <button className="btn-primary" style={{ marginTop: 8 }} onClick={placeResult}>
            Place in Illustrator
          </button>
        </div>
      )}

      <div className="section" style={{ fontSize: '11px', color: '#666' }}>
        <div>Extension: {extensionId || 'Not connected'}</div>
        <div>Native Host: {hostConnected ? 'Connected' : 'Disconnected'}</div>
        <div>Download Folder: {getDownloadFolder()}</div>
      </div>
    </div>
  );
}