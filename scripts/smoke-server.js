'use strict';

const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(error => {
        if (error) reject(error);
        else if (!port) reject(new Error('Could not reserve smoke-test port'));
        else resolve(port);
      });
    });
  });
}

function requestText(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: 1_000 }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) reject(new Error(`HTTP ${response.statusCode}: ${url}`));
        else resolve(body);
      });
    });
    request.once('timeout', () => request.destroy(new Error('Request timeout')));
    request.once('error', reject);
  });
}

async function waitForServer(url, child, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited with code ${child.exitCode}`);
    try { return await requestText(url); } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Server smoke test timed out');
}

async function main() {
  const port = await reservePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'listenfold-smoke-'));
  let logs = '';
  const child = spawn(process.execPath, [path.join(projectRoot, 'server.js')], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      LISTENFOLD_DATA_DIR: dataDir,
      LISTENFOLD_SKIP_COOKIE_IMPORT: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', chunk => { logs += chunk.toString(); });
  child.stderr.on('data', chunk => { logs += chunk.toString(); });

  try {
    const origin = `http://127.0.0.1:${port}`;
    const html = await waitForServer(`${origin}/`, child);
    if (!html.includes('<title>Listenfold</title>')) throw new Error('Unexpected application shell');

    const manifest = JSON.parse(await requestText(`${origin}/manifest.webmanifest`));
    if (manifest.name !== 'Listenfold') throw new Error('Unexpected PWA manifest name');
    console.log('Smoke test passed: shell and manifest are available');
  } catch (error) {
    if (logs.trim()) console.error(logs.trim().slice(-2_000));
    throw error;
  } finally {
    if (child.exitCode === null) child.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

