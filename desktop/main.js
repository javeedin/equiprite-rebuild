'use strict';

/**
 * EquipRite desktop client (Electron).
 *
 * Shows the EquipRite Visual Builder (Redwood) app in its own window. It starts Oracle's own local
 * server, `grunt vb-serve`, as a child process (lib/serve.js) and loads http://localhost:<port>/ .
 * vb-serve serves the built app and — because every backend in services/catalog.json is
 * "forceProxy": always — proxies the app's REST calls server-side, exactly as Visual Builder does when
 * the app is deployed. So the page keeps full web security, makes only same-origin calls, and needs no
 * CORS setting and no dev proxy.
 *
 * Backends that answer anonymously (eqpt :8087, the system of record, and commonService :8082) work
 * without VBCS. Backends that need a Visual Builder credential (Fusion REST, OIC, BI Publisher) are not
 * available locally, so those pieces (project LOVs, PDFs) degrade; the rest of the app runs on live data.
 *
 * Nothing native is compiled and no shell is started (eScan-safe): the only dependency is Electron, a
 * prebuilt binary. grunt is run through Electron itself (ELECTRON_RUN_AS_NODE), so no separate Node is needed.
 */
const path = require('path');
const { app, BrowserWindow, Menu, shell } = require('electron');
const { startServe, waitForUrl } = require('./lib/serve');
const { navAllowed } = require('./lib/hosts');

const APP_NAME = 'EquipRite';
const PORT = Number(process.env.EQP_PORT) || 18888;
const REPO_ROOT = path.resolve(__dirname, '..');
const APP_URL = `http://localhost:${PORT}/`;
const APP_ORIGIN = `http://localhost:${PORT}`;

process.env.EQP_DESKTOP_VERSION = app.getVersion();

let win = null;
let serveChild = null;
let quitting = false;
const serveLog = [];

function pushLog(text) {
  for (const line of String(text).split(/\r?\n/)) {
    if (line.trim()) {
      serveLog.push(line.trim());
    }
  }
  while (serveLog.length > 80) {
    serveLog.shift();
  }
}

/* ---------------------------------------------------------------------------
 * In-window pages shown before / instead of the app (never a blank window)
 * ------------------------------------------------------------------------- */

const SHELL_CSS = `
  :root { color-scheme: light dark; }
  body { margin: 0; height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: "Oracle Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #f5f4f2; color: #161513; }
  @media (prefers-color-scheme: dark) { body { background: #1b1a18; color: #ebe9e5; } }
  .box { max-width: 560px; padding: 32px 36px; }
  h1 { font-size: 20px; font-weight: 600; margin: 0 0 8px; }
  p { font-size: 14px; line-height: 1.5; margin: 6px 0; opacity: .85; }
  .spin { width: 28px; height: 28px; border: 3px solid rgba(127,127,127,.3); border-top-color: #c74634;
    border-radius: 50%; animation: s 0.9s linear infinite; margin-bottom: 20px; }
  @keyframes s { to { transform: rotate(360deg); } }
  pre { white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.45;
    background: rgba(127,127,127,.12); padding: 12px 14px; border-radius: 8px; max-height: 240px; overflow: auto; }
`;

function dataUrl(html) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function loadingUrl() {
  return dataUrl(`<!doctype html><html><head><meta charset="utf-8"><style>${SHELL_CSS}</style></head>
    <body><div class="box"><div class="spin"></div>
    <h1>Starting ${APP_NAME}…</h1>
    <p>Bringing up the local Visual Builder server and loading the app.</p>
    <p style="opacity:.6">First start can take a moment while Oracle's CDN is contacted.</p>
    </div></body></html>`);
}

function problemUrl(title, detail) {
  const log = serveLog.slice(-20).join('\n');
  return dataUrl(`<!doctype html><html><head><meta charset="utf-8"><style>${SHELL_CSS}</style></head>
    <body><div class="box">
    <h1>${title}</h1>
    <p>${detail}</p>
    ${log ? `<p style="opacity:.6;margin-top:16px">Recent server log</p><pre>${log.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</pre>` : ''}
    <p style="opacity:.6;margin-top:16px">View → Reload to try again, or run <code>npm run build</code> in the project folder first.</p>
    </div></body></html>`);
}

/* ---------------------------------------------------------------------------
 * Local server (grunt vb-serve) as a child process
 * ------------------------------------------------------------------------- */

function startBackend() {
  const { child } = startServe({ repoRoot: REPO_ROOT, webApp: 'vbredwoodapp', port: PORT, onLog: pushLog });
  serveChild = child;
  child.on('exit', (code) => {
    serveChild = null;
    pushLog(`vb-serve exited (code ${code})`);
    if (!quitting && win && !win.isDestroyed()) {
      win.loadURL(problemUrl('The local server stopped', 'grunt vb-serve exited before the app was ready.'));
    }
  });
  return waitForUrl(APP_URL, { timeoutMs: 120000 });
}

function stopBackend() {
  if (serveChild && !serveChild.killed) {
    try {
      serveChild.kill();
    } catch {
      // already gone
    }
  }
  serveChild = null;
}

/* ---------------------------------------------------------------------------
 * Window
 * ------------------------------------------------------------------------- */

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: `${APP_NAME} ${app.getVersion()}`,
    backgroundColor: '#f5f4f2',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  win.once('ready-to-show', () => win.show());
  // A page that never paints must not leave the app invisible.
  setTimeout(() => {
    if (win && !win.isDestroyed() && !win.isVisible()) {
      win.show();
    }
  }, 6000);

  // Links to other sites open in the default browser; the app itself and Oracle hosts stay in the window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (navAllowed(url, APP_ORIGIN)) {
      return { action: 'allow' };
    }
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (navAllowed(url, APP_ORIGIN)) {
      return;
    }
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
  });
  win.webContents.on('did-fail-load', (_event, code, description, failedUrl, isMainFrame) => {
    // code -3 is an aborted load (e.g. the splash being replaced); ignore it.
    if (isMainFrame && code !== -3 && failedUrl.startsWith(APP_ORIGIN)) {
      win.loadURL(problemUrl('The app did not load', `${description} (${code})`));
    }
  });
  win.on('closed', () => {
    win = null;
  });

  win.loadURL(loadingUrl());
}

function appMenu() {
  const isMac = process.platform === 'darwin';
  return Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' } : { label: 'Quit', accelerator: 'Ctrl+Q', click: () => { quitting = true; app.quit(); } }],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Reload app', accelerator: 'CmdOrCtrl+R', click: () => { if (win) win.loadURL(APP_URL); } },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
  ]);
}

/* ---------------------------------------------------------------------------
 * Start
 * ------------------------------------------------------------------------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) {
        win.restore();
      }
      win.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(appMenu());
    createWindow();
    startBackend()
      .then(() => {
        if (win && !win.isDestroyed()) {
          win.loadURL(APP_URL).catch(() => {});
        }
      })
      .catch((e) => {
        if (win && !win.isDestroyed()) {
          win.loadURL(problemUrl('Could not start the local server', String((e && e.message) || e)));
        }
      });
  });

  app.on('activate', () => {
    if (!win) {
      createWindow();
      win.loadURL(APP_URL).catch(() => {});
    }
  });
  app.on('before-quit', () => {
    quitting = true;
    stopBackend();
  });
  app.on('window-all-closed', () => {
    stopBackend();
    if (process.platform !== 'darwin' || quitting) {
      app.quit();
    }
  });
}
