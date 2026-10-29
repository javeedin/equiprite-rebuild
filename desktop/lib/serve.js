'use strict';

/**
 * Starts Oracle's own local server, `grunt vb-serve`, as a child process and tells you when it answers.
 *
 * vb-serve serves the built Visual Builder app AND proxies its REST calls server-side (every backend in
 * services/catalog.json is "forceProxy": always), exactly as Visual Builder does when the app is deployed.
 * The desktop window then just loads http://localhost:<port>/ — same-origin, full web security, no CORS.
 *
 * grunt is run through the current executable with ELECTRON_RUN_AS_NODE=1, so no separate Node install is
 * needed and nothing is compiled or shelled out (eScan-safe). Run standalone to smoke-test:
 *     node desktop/lib/serve.js <repoRoot> <port>
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

/** Resolves once `url` answers with any HTTP status < 500, or rejects after timeoutMs. */
function waitForUrl(url, { timeoutMs = 90000, intervalMs = 400 } = {}) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
          resolve();
        } else {
          again();
        }
      });
      req.on('error', again);
      req.setTimeout(3000, () => req.destroy());
    };
    const again = () => {
      if (Date.now() > deadline) {
        reject(new Error(`vb-serve did not answer at ${url} within ${Math.round(timeoutMs / 1000)}s`));
      } else {
        setTimeout(attempt, intervalMs);
      }
    };
    attempt();
  });
}

/**
 * Spawns `grunt vb-serve:webApps/<webApp> --port=<port>` from repoRoot.
 * @returns {{ child: import('child_process').ChildProcess, url: string }}
 */
function startServe({ repoRoot, webApp = 'vbredwoodapp', port = 18888, node = process.execPath, onLog } = {}) {
  const gruntBin = path.join(repoRoot, 'node_modules', 'grunt', 'bin', 'grunt');
  const args = [gruntBin, `vb-serve:webApps/${webApp}`, `--port=${port}`];
  const child = spawn(node, args, {
    cwd: repoRoot,
    env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const relay = (buf) => {
    if (typeof onLog === 'function') {
      onLog(buf.toString());
    }
  };
  child.stdout.on('data', relay);
  child.stderr.on('data', relay);
  return { child, url: `http://localhost:${port}/` };
}

module.exports = { startServe, waitForUrl };

if (require.main === module) {
  const repoRoot = process.argv[2] || path.resolve(__dirname, '..', '..');
  const port = Number(process.argv[3]) || 18899;
  const { child, url } = startServe({ repoRoot, port, node: process.execPath, onLog: (t) => process.stdout.write(t) });
  waitForUrl(url, { timeoutMs: 90000 })
    .then(() => {
      console.log(`\n[serve.js] OK — vb-serve answered at ${url}`);
      child.kill();
      setTimeout(() => process.exit(0), 300);
    })
    .catch((e) => {
      console.error(`\n[serve.js] FAIL — ${e.message}`);
      child.kill();
      setTimeout(() => process.exit(1), 300);
    });
}
