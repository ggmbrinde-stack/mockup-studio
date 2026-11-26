const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const agentPath = path.join(__dirname, 'flow-bridge.js');
const downloadFolder = path.join(process.env.USERPROFILE, 'Downloads', 'MockupStudioFlow');
const statusFolder = path.join(process.env.USERPROFILE, 'Documents', 'VectorizerBridge', 'flow-status');

const jobId = 'flow-test-' + Date.now();
const testFile = path.join(downloadFolder, `result_${jobId}.png`);

console.log('Job ID:', jobId);
console.log('Download folder:', downloadFolder);
console.log('Test file:', testFile);
console.log('Status folder:', statusFolder);

const child = spawn('node', [agentPath], { stdio: ['pipe', 'pipe', 'pipe'] });

let output = '';
child.stdout.on('data', data => {
  output += data.toString();
  console.log('[STDOUT]', data.toString().trim());
});
child.stderr.on('data', data => {
  console.log('[STDERR]', data.toString().trim());
});

child.stdout.on('end', () => {
  console.log('Process ended');
  checkStatus();
});

function send(msg) {
  child.stdin.write(JSON.stringify(msg) + '\n');
}

function checkStatus() {
  const statusFile = path.join(statusFolder, `flow-${jobId}.json`);
  if (fs.existsSync(statusFile)) {
    const content = fs.readFileSync(statusFile, 'utf8');
    console.log('Status file:', content);
  } else {
    console.log('Status file not found');
  }
}

// Wait for ready, then send startJob
setTimeout(() => {
  console.log('Sending startJob...');
  send({ type: 'startJob', jobId, downloadFolder });
  
  // Wait a bit, then create test file
  setTimeout(() => {
    console.log('Creating test file...');
    fs.writeFileSync(testFile, 'fake png content');
    console.log('Test file created');
    
    // Wait for watcher to detect
    setTimeout(() => {
      checkStatus();
      send({ type: 'stopJob' });
      child.stdin.end();
    }, 3000);
  }, 1000);
}, 500);