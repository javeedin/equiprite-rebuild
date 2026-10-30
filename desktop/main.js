'use strict';

/**
 * EquipRite desktop client (Electron).
 *
 * Shows the EquipRite Visual Builder (Redwood) app in its own window, running against the live backends. The
 * local server (lib/devserver.js, in this process) serves the built app from build/processed and does what the
 * VBCS server does for it: it supplies the signed-in user, serves the services catalog and forwards the backend
 * calls, adding the Fusion login where VBCS would add its stored credential.
 *
 * Who you are comes from the sign-in window (signin.html) on first start, File > Sign in as… afterwards; it is
 * saved in userData (lib/identity.js), never in the project. Roles are read from the ROLES_RP report in Fusion,
 * or picked by hand for this PC.
 *
 * Three apps: Old EquipRite (webApps/vbredwoodapp, today's app, unchanged), New EquipRite (webApps/equiprite, the
 * Redwood redesign) and EquipRite Next (webApps/equiprite-next, designed from the FDD, with tabs). The sign-in window
 * asks which to open; File > Open New EquipRite / Open EquipRite Next / Switch this window to Old EquipRite switch
 * without signing out, and New and Next have an Old / New / Next switch in their toolbar. A link to Old EquipRite clicked in New EquipRite opens Old in a window of its own, so
 * the New window stays put and the two can be shown side by side.
 * Each gets its own local server, at the site root as VB expects; both forward to the same backends with the same
 * sign-in, so they show the same data.
 *
 * Nothing native is compiled and no shell is started (eScan-safe): the only dependency is Electron, a prebuilt
 * binary.
 */
const path = require('path');
const { app, BrowserWindow, Menu, shell, ipcMain, safeStorage, dialog } = require('electron');
const { createDevServer, isBuilt, backendOverridesFromEnv, KNOWN_ROLES } = require('./lib/devserver');
const identityStore = require('./lib/identity');
const { navAllowed, opensInOldWindow } = require('./lib/hosts');

const APP_NAME = 'EquipRite';
const PORT = Number(process.env.EQP_PORT) || 18888;
const REPO_ROOT = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(REPO_ROOT, 'build');
const VERSIONS = {
  old: { webApp: 'vbredwoodapp', label: 'Old EquipRite', port: PORT },
  new: { webApp: 'equiprite', label: 'New EquipRite', port: PORT + 1 },
  next: { webApp: 'equiprite-next', label: 'EquipRite Next', port: PORT + 2 },
};
const originOf = (v) => `http://localhost:${VERSIONS[v].port}`;
const urlOf = (v) => `${originOf(v)}/`;

process.env.EQP_DESKTOP_VERSION = app.getVersion();

let win = null;
let signinWin = null;
let logWin = null;
let servicesWin = null;
let oldWin = null; // Old EquipRite beside New, opened from New's "Old" links
const servers = {}; // version -> running local server, for each app that is built
let version = 'old'; // which app the window shows
let quitting = false;
let identity = null; // what the local server signs in as
let passwordThisRun = null; // when safeStorage cannot encrypt, the password lives here only
const serverLog = [];

/** The app the window should show: the chosen one, or the old app when the new one is not built. */
const appUrl = () => urlOf(servers[version] ? version : 'old');
const inApp = (url) => Object.keys(VERSIONS).some((v) => url.startsWith(urlOf(v)));
// Either app may link to the other (New EquipRite opens screens it does not have yet in the old app).
const allowedNav = (url) => Object.keys(VERSIONS).some((v) => navAllowed(url, originOf(v)));

/** The origin the main window shows. */
const shownOrigin = () => originOf(servers[version] ? version : 'old');

function showTitle() {
  if (win && !win.isDestroyed()) {
    const v = servers[version] ? version : 'old';
    win.setTitle(`${VERSIONS[v].label}${v !== 'old' ? ' (preview)' : ''} · ${app.getVersion()}`);
  }
}

function pushLog(line) {
  serverLog.push(String(line));
  while (serverLog.length > 400) {
    serverLog.shift();
  }
}

const identityFile = () => path.join(app.getPath('userData'), 'local-identity.json');
const canEncrypt = () => {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
};

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

function escapeHtml(s) {
  return String(s).replace(/[<&>]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;' }[c]));
}

function dataUrl(html) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function loadingUrl() {
  return dataUrl(`<!doctype html><html><head><meta charset="utf-8"><style>${SHELL_CSS}</style></head>
    <body><div class="box"><div class="spin"></div>
    <h1>Starting ${APP_NAME}…</h1>
    <p>Bringing up the local server and loading the app.</p>
    <p style="opacity:.6">First start can take a moment while Oracle's CDN is contacted.</p>
    </div></body></html>`);
}

function problemUrl(title, detail) {
  const log = serverLog.slice(-20).join('\n');
  return dataUrl(`<!doctype html><html><head><meta charset="utf-8"><style>${SHELL_CSS}</style></head>
    <body><div class="box">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(detail)}</p>
    ${log ? `<p style="opacity:.6;margin-top:16px">Recent backend calls</p><pre>${escapeHtml(log)}</pre>` : ''}
    <p style="opacity:.6;margin-top:16px">View → Reload app to try again.</p>
    </div></body></html>`);
}

function signedOutUrl() {
  return dataUrl(`<!doctype html><html><head><meta charset="utf-8"><style>${SHELL_CSS}</style></head>
    <body><div class="box">
    <h1>Not signed in</h1>
    <p>EquipRite needs to know who you are and which roles you have. Use File → Sign in as… to continue.</p>
    </div></body></html>`);
}

/* ---------------------------------------------------------------------------
 * Sign-in
 * ------------------------------------------------------------------------- */

function loadSavedIdentity() {
  const saved = identityStore.load(identityFile());
  const id = identityStore.toServerIdentity(saved, passwordThisRun, canEncrypt() ? (b) => safeStorage.decryptString(b) : null);
  return saved && identityStore.usable(id, saved) ? id : null;
}

/*
 * Backend problems the app itself keeps quiet about: a refused Fusion call just leaves a list empty (the chains
 * read "no reportBytes" as "no rows"). Say so once per cause and run, with the way out.
 */
const warned = new Set();

function backendProblem(p) {
  const key = p.kind === 'unreachable' ? `unreachable:${p.backend}` : `fusion:${p.kind}`;
  if (warned.has(key) || !win || win.isDestroyed() || (signinWin && !signinWin.isDestroyed())) {
    return;
  }
  warned.add(key);
  const what = p.report ? `The ${p.report} report` : `A ${p.backend} call`;
  const text = {
    'no-login': ['Fusion lists are empty: no Fusion login',
      `${what} came back ${p.status} because you are signed in without a Fusion login. Customers, projects, tasks, `
      + 'contracts and PDFs come from Fusion (BI Publisher reports and Fusion REST), which VBCS calls with its stored '
      + 'credential. Sign in again and enter a Fusion username and password that can run the /Custom/EquipRite reports.'],
    refused: ['Fusion refused the login',
      `${what} came back ${p.status} with the Fusion login you entered. Check the username and password, and that the `
      + 'account may run the /Custom/EquipRite BI Publisher reports.'],
    unreachable: [`Cannot reach ${p.backend}`,
      `This PC could not connect to ${p.host} (${p.error}). Lists and data from ${p.backend} stay empty until it can; `
      + 'check the network or VPN. View → Backend calls… lists each failed call.'],
  }[p.kind];
  if (!text) {
    return;
  }
  const signIn = p.kind !== 'unreachable';
  dialog.showMessageBox(win, {
    type: 'warning',
    title: APP_NAME,
    message: text[0],
    detail: text[1],
    buttons: signIn ? ['Sign in…', 'Later'] : ['OK'],
    defaultId: 0,
    cancelId: signIn ? 1 : 0,
    noLink: true,
  }).then(({ response }) => {
    if (signIn && response === 0) {
      openSignIn();
    }
  }).catch(() => {});
}

/** File → Sign out: forgets the saved sign-in and the Fusion password, then asks again. */
function signOut() {
  if (oldWin && !oldWin.isDestroyed()) {
    oldWin.close();
  }
  identityStore.remove(identityFile());
  identity = null;
  passwordThisRun = null;
  warned.clear();
  pushLog(`${new Date().toTimeString().slice(0, 8)} signed out`);
  if (win && !win.isDestroyed()) {
    win.loadURL(signedOutUrl());
  }
  openSignIn();
}

function openSignIn() {
  if (signinWin && !signinWin.isDestroyed()) {
    signinWin.focus();
    return;
  }
  signinWin = new BrowserWindow({
    parent: win || undefined,
    modal: !!win,
    width: 660,
    height: 960,
    resizable: false,
    minimizable: false,
    title: `Sign in to ${APP_NAME}`,
    backgroundColor: '#f5f4f2',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'signin-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  signinWin.setMenu(null);
  signinWin.once('ready-to-show', () => signinWin.show());
  signinWin.on('closed', () => {
    signinWin = null;
    // Not while quitting: loading a page into the closing main window kept the process alive after quit.
    if (!quitting && !identity && win && !win.isDestroyed()) {
      win.loadURL(signedOutUrl());
    }
  });
  signinWin.loadFile(path.join(__dirname, 'signin.html'));
}

const fromSignin = (event) => !!signinWin && !signinWin.isDestroyed() && event.sender === signinWin.webContents;

ipcMain.handle('signin:initial', (event) => {
  if (!fromSignin(event)) {
    return null;
  }
  const saved = identityStore.load(identityFile()) || {};
  return {
    version: servers[identityStore.versionOf(saved.version)] ? identityStore.versionOf(saved.version) : 'old',
    newAvailable: !!servers.new,
    nextAvailable: !!servers.next,
    username: saved.username || '',
    fusionUser: saved.fusionUser || '',
    hasPassword: !!saved.fusionPassword || !!passwordThisRun,
    rolesFrom: saved.rolesFrom || 'fusion',
    roles: saved.roles || [],
    knownRoles: KNOWN_ROLES,
  };
});

ipcMain.handle('signin:submit', (event, form) => {
  if (!fromSignin(event)) {
    return { error: 'not allowed' };
  }
  const previous = identityStore.load(identityFile());
  const checked = identityStore.validate(form, previous);
  if (checked.error) {
    return { error: checked.error };
  }
  if (checked.saved.version !== 'old' && !servers[checked.saved.version]) {
    return { error: `${VERSIONS[checked.saved.version].label} is not built yet. Run "npm run desktop:fresh" to build the apps.` };
  }
  const encrypt = canEncrypt() ? (s) => safeStorage.encryptString(s) : null;
  if (checked.password && !encrypt) {
    passwordThisRun = checked.password;
  } else if (checked.password || !checked.keepsPassword) {
    passwordThisRun = null;
  }
  const saved = identityStore.save(identityFile(), checked.saved, checked.password, encrypt, previous);
  identity = identityStore.toServerIdentity(saved, passwordThisRun, encrypt ? (b) => safeStorage.decryptString(b) : null);
  version = saved.version;
  warned.clear();
  pushLog(`${new Date().toTimeString().slice(0, 8)} signed in as ${saved.username}; roles ${identity.roles ? identity.roles.join(', ') : 'from Fusion (ROLES_RP)'}; opening ${VERSIONS[version].label}`);
  if (signinWin) {
    signinWin.close();
  }
  if (win && !win.isDestroyed()) {
    showTitle();
    win.loadURL(appUrl()).catch(() => {});
  }
  return { ok: true };
});

/** File → Open Old / New EquipRite / EquipRite Next: switch apps and stay signed in. The choice is remembered. */
function openVersion(v) {
  if (!servers[v]) {
    dialog.showMessageBox(win, {
      type: 'info', title: APP_NAME, message: `${VERSIONS[v].label} is not built yet`,
      detail: 'Run "npm run desktop:fresh" to build the apps, then start EquipRite again.', noLink: true,
    }).catch(() => {});
    return;
  }
  version = v;
  identityStore.saveVersion(identityFile(), v);
  pushLog(`${new Date().toTimeString().slice(0, 8)} opening ${VERSIONS[v].label}`);
  showTitle();
  if (win && !win.isDestroyed()) {
    win.loadURL(identity ? appUrl() : signedOutUrl()).catch(() => {});
  }
}

/**
 * Old EquipRite in a window of its own, at `url` (its home by default), so the window showing New EquipRite stays
 * where it was. One such window: a second link reuses it and brings it to the front. When the main window already
 * shows Old EquipRite, the link simply opens there.
 */
function openOldWindow(url) {
  const target = url || urlOf('old');
  if (!servers.old) {
    openVersion('old'); // explains that it is not built
    return;
  }
  if (!identity) {
    openSignIn();
    return;
  }
  if (shownOrigin() === originOf('old')) {
    if (win && !win.isDestroyed()) {
      win.loadURL(target).catch(() => {});
      win.focus();
    }
    return;
  }
  if (oldWin && !oldWin.isDestroyed()) {
    oldWin.loadURL(target).catch(() => {});
    if (oldWin.isMinimized()) {
      oldWin.restore();
    }
    oldWin.focus();
    return;
  }
  const [x, y] = win && !win.isDestroyed() ? win.getPosition() : [undefined, undefined];
  oldWin = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    x: x != null ? x + 48 : undefined,
    y: y != null ? y + 48 : undefined,
    title: `${VERSIONS.old.label} · ${app.getVersion()}`,
    backgroundColor: '#f5f4f2',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  oldWin.on('page-title-updated', (event) => event.preventDefault());
  oldWin.webContents.setWindowOpenHandler(({ url: next }) => {
    if (allowedNav(next)) {
      return { action: 'allow' };
    }
    if (/^https?:\/\//i.test(next)) {
      shell.openExternal(next);
    }
    return { action: 'deny' };
  });
  oldWin.webContents.on('will-navigate', (event, next) => {
    if (allowedNav(next)) {
      return;
    }
    event.preventDefault();
    if (/^https?:\/\//i.test(next)) {
      shell.openExternal(next);
    }
  });
  oldWin.on('closed', () => {
    oldWin = null;
  });
  pushLog(`${new Date().toTimeString().slice(0, 8)} opening ${VERSIONS.old.label} in its own window`);
  oldWin.loadURL(target).catch(() => {});
}

ipcMain.handle('signin:cancel', (event) => {
  if (fromSignin(event) && signinWin) {
    signinWin.close();
  }
});

/* ---------------------------------------------------------------------------
 * Backend calls log (View → Backend calls…)
 * ------------------------------------------------------------------------- */

function showLog() {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Backend calls</title><style>
    :root { color-scheme: light dark; } body { margin: 0; font: 12px/1.5 ui-monospace, Consolas, monospace; background: #f5f4f2; color: #161513; }
    @media (prefers-color-scheme: dark) { body { background: #1b1a18; color: #ebe9e5; } }
    header { padding: 12px 16px; font: 600 14px system-ui, "Segoe UI", sans-serif; }
    pre { margin: 0; padding: 0 16px 16px; white-space: pre-wrap; word-break: break-word; }
    </style></head><body><header>Backend calls through the local server (newest last; View → Backend calls… again to refresh)</header>
    <pre>${escapeHtml(serverLog.join('\n') || 'No calls yet.')}</pre></body></html>`;
  if (!logWin || logWin.isDestroyed()) {
    logWin = new BrowserWindow({ width: 980, height: 620, title: 'Backend calls', autoHideMenuBar: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    logWin.setMenu(null);
    logWin.on('closed', () => {
      logWin = null;
    });
  }
  logWin.loadURL(dataUrl(html)).then(() => logWin && logWin.webContents.executeJavaScript('window.scrollTo(0, document.body.scrollHeight)')).catch(() => {});
  logWin.focus();
}

/* ---------------------------------------------------------------------------
 * Web services (View → Web services…): every endpoint, with a GET tester (lib/catalog.js, web-services.html)
 * ------------------------------------------------------------------------- */

function showWebServices() {
  // Both apps share services/, so either server's page lists the same catalog.
  const v = servers.old ? 'old' : (servers.new ? 'new' : null);
  if (!v) {
    return;
  }
  if (!servicesWin || servicesWin.isDestroyed()) {
    servicesWin = new BrowserWindow({ width: 1240, height: 860, title: 'EquipRite Web Services', autoHideMenuBar: true,
      backgroundColor: '#f3f5f6', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    servicesWin.setMenu(null);
    servicesWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    servicesWin.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith(`${urlOf(v)}__services/`)) {
        event.preventDefault();
      }
    });
    servicesWin.on('closed', () => {
      servicesWin = null;
    });
  }
  servicesWin.loadURL(`${urlOf(v)}__services/`).catch(() => {});
  servicesWin.focus();
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
  // Keep "Old EquipRite" / "New EquipRite" in the title instead of the page's own title, so demos and
  // screenshots always show which app is open.
  win.on('page-title-updated', (event) => event.preventDefault());
  // A page that never paints must not leave the app invisible.
  setTimeout(() => {
    if (win && !win.isDestroyed() && !win.isVisible()) {
      win.show();
    }
  }, 6000);

  // Links to other sites open in the default browser; the app itself and Oracle hosts stay in the window. A link
  // from New EquipRite to Old EquipRite opens the Old window instead, so this one stays on New.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (opensInOldWindow(url, shownOrigin(), originOf('old'))) {
      openOldWindow(url);
      return { action: 'deny' };
    }
    if (allowedNav(url)) {
      return { action: 'allow' };
    }
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (opensInOldWindow(url, shownOrigin(), originOf('old'))) {
      event.preventDefault();
      openOldWindow(url);
      return;
    }
    if (allowedNav(url)) {
      return;
    }
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
  });
  // Switching with the Old / New / Next switch in the app: the window title and the app opened next time follow.
  win.webContents.on('did-navigate', (_event, url) => {
    const v = Object.keys(VERSIONS).find((k) => servers[k] && String(url).startsWith(urlOf(k)));
    if (v && v !== version) {
      version = v;
      identityStore.saveVersion(identityFile(), v);
      showTitle();
    }
  });
  win.webContents.on('did-fail-load', (_event, code, description, failedUrl, isMainFrame) => {
    // code -3 is an aborted load (e.g. the splash being replaced); ignore it.
    if (isMainFrame && code !== -3 && inApp(failedUrl)) {
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
      submenu: [
        { label: 'Open Old EquipRite in its own window', accelerator: 'CmdOrCtrl+Shift+1', click: () => openOldWindow() },
        { label: 'Open New EquipRite', accelerator: 'CmdOrCtrl+Shift+2', click: () => openVersion('new') },
        { label: 'Open EquipRite Next', accelerator: 'CmdOrCtrl+Shift+3', click: () => openVersion('next') },
        { label: 'Switch this window to Old EquipRite', click: () => openVersion('old') },
        { type: 'separator' },
        { label: 'Sign in as…', accelerator: 'CmdOrCtrl+Shift+S', click: () => openSignIn() },
        { label: 'Sign out', click: () => signOut() },
        { type: 'separator' },
        isMac ? { role: 'close' } : { label: 'Quit', accelerator: 'Ctrl+Q', click: () => { quitting = true; app.quit(); } },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Reload app', accelerator: 'CmdOrCtrl+R', click: () => { if (win) win.loadURL(identity ? appUrl() : signedOutUrl()); } },
        { role: 'forceReload' },
        { label: 'Web services…', accelerator: 'CmdOrCtrl+Shift+W', click: () => showWebServices() },
        { label: 'Backend calls…', accelerator: 'CmdOrCtrl+Shift+L', click: () => showLog() },
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

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(appMenu());
    createWindow();
    try {
      // The old app must be there (it is today's app); New and Next are served when they have been built.
      for (const v of Object.keys(VERSIONS)) {
        if (v === 'old' || isBuilt(BUILD_DIR, VERSIONS[v].webApp)) {
          servers[v] = await createDevServer({
            buildDir: BUILD_DIR,
            webApp: VERSIONS[v].webApp,
            port: VERSIONS[v].port,
            getIdentity: () => identity,
            getVersions: () => ({ old: urlOf('old'), new: servers.new ? urlOf('new') : '', next: servers.next ? urlOf('next') : '' }),
            backendOverrides: backendOverridesFromEnv(process.env),
            onLog: pushLog,
            onProblem: backendProblem,
          });
        }
      }
    } catch (e) {
      if (win && !win.isDestroyed()) {
        win.loadURL(problemUrl('Could not start the local server', String((e && e.message) || e)));
      }
      return;
    }
    identity = loadSavedIdentity();
    version = identityStore.versionOf((identityStore.load(identityFile()) || {}).version);
    showTitle();
    if (identity) {
      pushLog(`${new Date().toTimeString().slice(0, 8)} signed in as ${identity.username}; roles ${identity.roles ? identity.roles.join(', ') : 'from Fusion (ROLES_RP)'}; opening ${VERSIONS[servers[version] ? version : 'old'].label}`);
      win.loadURL(appUrl()).catch(() => {});
    } else {
      openSignIn();
    }
  });

  app.on('activate', () => {
    if (!win) {
      createWindow();
      showTitle();
      win.loadURL(identity ? appUrl() : signedOutUrl()).catch(() => {});
    }
  });
  app.on('before-quit', () => {
    quitting = true;
    Object.values(servers).forEach((s) => s.close());
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' || quitting) {
      app.quit();
    }
  });
}
