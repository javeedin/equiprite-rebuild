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
 * Four apps: Old EquipRite (webApps/vbredwoodapp, today's app, unchanged), New EquipRite (webApps/equiprite, the
 * Redwood redesign), EquipRite Next (webApps/equiprite-next, designed from the FDD, with tabs) and EquipRite Future
 * (webApps/equiprite-future, many companies and intercompany hire from FDD v2.0: a prototype on a simulated group,
 * calling no backend). The sign-in window asks which to open; File > Open New EquipRite / Open EquipRite Next / Open
 * EquipRite Future / Switch this window to Old EquipRite switch without signing out, and New, Next and Future have a
 * version switch of their own. A link to Old EquipRite clicked in New EquipRite opens Old in a window of its own, so
 * the New window stays put and the two can be shown side by side.
 * EquipRite Mobile (webApps/equiprite-mobile, the phone app) opens with File > Open EquipRite Mobile in a phone-sized
 * window of its own, beside whichever app the main window shows.
 * Each gets its own local server, at the site root as VB expects; all forward to the same backends with the same
 * sign-in, so they show the same data.
 *
 * Nothing native is compiled and no shell is started (eScan-safe): the only dependency is Electron, a prebuilt
 * binary.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, Menu, shell, ipcMain, safeStorage, dialog, clipboard, desktopCapturer, globalShortcut, session } = require('electron');
const { createDevServer, isBuilt, backendOverridesFromEnv, KNOWN_ROLES } = require('./lib/devserver');
const identityStore = require('./lib/identity');
const { navAllowed, opensInOldWindow } = require('./lib/hosts');
const phone = require('./lib/phone');

const APP_NAME = 'EquipRite';
const PORT = Number(process.env.EQP_PORT) || 18888;
const REPO_ROOT = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(REPO_ROOT, 'build');
// EquipRite Future's story store (DuckDB, future.duckdb in the data folder), opened once when Future is served.
let futureDbStore = null;
async function futureStore() {
  if (!futureDbStore) futureDbStore = await require('./lib/futureDb').open(path.join(app.getPath('userData'), 'future.duckdb'));
  return futureDbStore;
}
// EquipRite Next's SQL worksheet: Oracle connections kept in this app's data folder, passwords in the OS keychain.
let sqlConnStore = null;
async function sqlStore() {
  if (!sqlConnStore) {
    sqlConnStore = await require('./lib/oracleSql').open({
      file: path.join(app.getPath('userData'), 'sql-connections.json'),
      encrypt: canEncrypt() ? (t) => safeStorage.encryptString(t) : null,
      decrypt: canEncrypt() ? (b) => safeStorage.decryptString(b) : null,
    });
  }
  return sqlConnStore;
}
// Ask AI in the SQL worksheet: the LLM chosen and its key, kept in this app's data folder (the key in the OS keychain).
// Calls go through Chromium's network stack (net.fetch), so the PC's proxy settings apply.
let aiConnStore = null;
async function aiStore() {
  if (!aiConnStore) {
    const { net } = require('electron');
    aiConnStore = await require('./lib/aiSql').open({
      file: path.join(app.getPath('userData'), 'ai-settings.json'),
      encrypt: canEncrypt() ? (t) => safeStorage.encryptString(t) : null,
      decrypt: canEncrypt() ? (b) => safeStorage.decryptString(b) : null,
      fetch: net && typeof net.fetch === 'function' ? (url, init) => net.fetch(url, init) : undefined,
    });
  }
  return aiConnStore;
}
// Connect Jira, for the Jira stories page in Old and Next: the site, email and API token (the token in the OS keychain).
let jiraAuthStore = null;
function jiraStore() {
  if (!jiraAuthStore) {
    jiraAuthStore = require('./lib/jiraAuth').open({
      file: path.join(app.getPath('userData'), 'jira-connection.json'),
      encrypt: canEncrypt() ? (t) => safeStorage.encryptString(t) : null,
      decrypt: canEncrypt() ? (b) => safeStorage.decryptString(b) : null,
    });
  }
  return jiraAuthStore;
}
// Record, on a Jira story's panel (Old and Next): recordings and screenshots kept in Documents/EquipRite Test Evidence, a
// folder per story (lib/testEvidence.js); the page records the screen or window chosen (getDisplayMedia, answered below).
let evidenceStoreInst = null;
function evidenceStore() {
  if (!evidenceStoreInst) {
    evidenceStoreInst = require('./lib/testEvidence').open({
      dir: path.join(app.getPath('documents'), 'EquipRite Test Evidence'),
      reveal: (folder) => shell.openPath(folder),
    });
  }
  return evidenceStoreInst;
}
// Transcribe a recording's voice (lib/transcribe.js): local Whisper (whisper.cpp) on this PC, or OpenAI's Whisper with
// the key the person set for Ask AI. Models for local Whisper live in Documents/EquipRite Test Evidence/.whisper.
let transcriberInst = null;
async function transcriber() {
  if (!transcriberInst) {
    const ai = await aiStore();
    transcriberInst = require('./lib/transcribe').open({
      modelsDir: path.join(app.getPath('documents'), 'EquipRite Test Evidence', '.whisper'),
      tmpDir: app.getPath('temp'),
      which: (cmd) => commandPath(cmd),
      run: runCommand,
      fetch: (url, init) => { const { net } = require('electron'); return net.fetch(url, init); },
      openaiKey: () => ai.secretFor('openai', 'key'),
      reveal: (folder) => shell.openPath(folder),
    });
  }
  return transcriberInst;
}
// Standup minutes, for EquipRite Next's Minutes page: the daily standup on the Jira backlog, kept in this app's data
// folder (the Teams webhook in the OS keychain). Voice→text reuses the Whisper engine; "Format by AI" the Ask AI key.
// Interactive Microsoft 365 sign-in in a popup window (auth-code + PKCE): open the Microsoft page in a child
// BrowserWindow and capture the ?code= from the redirect to the native-client URL — far more reliable than device code.
function interactiveAuth(authUrl, redirectUri) {
  return new Promise((resolve) => {
    let done = false;
    const auth = new BrowserWindow({ width: 520, height: 700, parent: win || undefined, modal: !!win, show: true, autoHideMenuBar: true,
      title: 'Sign in to Microsoft 365', webPreferences: { nodeIntegration: false, contextIsolation: true, partition: 'persist:eqr-msauth' } });
    const finish = (r) => { if (done) return; done = true; try { auth.destroy(); } catch (e) { /* already gone */ } resolve(r); };
    const check = (url) => {
      if (!url || url.indexOf(redirectUri) !== 0) return false;
      try { const u = new URL(url); const code = u.searchParams.get('code'); const err = u.searchParams.get('error_description') || u.searchParams.get('error');
        if (code) { finish({ code: code }); return true; } if (err) { finish({ error: err }); return true; } } catch (e) { /* keep waiting */ }
      return false;
    };
    auth.webContents.on('will-redirect', (e, url) => { if (check(url)) e.preventDefault(); });
    auth.webContents.on('will-navigate', (e, url) => { if (check(url)) e.preventDefault(); });
    auth.webContents.on('did-navigate', (e, url) => check(url));
    auth.on('closed', () => { if (!done) { done = true; resolve({ error: 'Sign-in window was closed before it finished.' }); } });
    auth.loadURL(authUrl).catch((e) => finish({ error: String((e && e.message) || e) }));
  });
}

// Microsoft 365 (lib/graph.js): one sign-in for the app — Standup minutes sends the minutes, Issues the approval emails.
let graphStoreInst = null;
function graphStore() {
  if (!graphStoreInst) graphStoreInst = require('./lib/graph').open({
        file: path.join(app.getPath('userData'), 'graph.json'),
        encrypt: canEncrypt() ? (t) => safeStorage.encryptString(t) : null,
        decrypt: canEncrypt() ? (b) => safeStorage.decryptString(b) : null,
        fetch: (url, init) => { const { net } = require('electron'); return net.fetch(url, init); },
        // The device-code verification page opens inside EquipRite (a child window), so sign-in stays in the app.
        openExternal: (u) => {
          try {
            const dcWin = new BrowserWindow({ width: 520, height: 720, parent: win || undefined, show: true, autoHideMenuBar: true,
              title: 'Sign in to Microsoft 365', webPreferences: { nodeIntegration: false, contextIsolation: true, partition: 'persist:eqr-msauth' } });
            dcWin.loadURL(u);
            return dcWin;
          } catch (e) { const { shell } = require('electron'); return shell.openExternal(u); }
        },
        interactiveAuth: interactiveAuth,
      });
  return graphStoreInst;
}

let minutesStoreInst = null;
async function minutesStore() {
  if (!minutesStoreInst) {
    minutesStoreInst = await require('./lib/minutes').open({
      file: path.join(app.getPath('userData'), 'minutes.duckdb'),
      encrypt: canEncrypt() ? (t) => safeStorage.encryptString(t) : null,
      decrypt: canEncrypt() ? (b) => safeStorage.decryptString(b) : null,
      transcribe: await transcriber(),
      fetch: (url, init) => { const { net } = require('electron'); return net.fetch(url, init); },
      contacts: require('./lib/outlookContacts').read,
      outlookSend: require('./lib/outlookContacts').compose,
      graph: graphStore(),
    });
  }
  return minutesStoreInst;
}
// Saved follow-ups, for EquipRite Next's Follow-ups page: follow-ups drafted on the Jira pages, kept in this app's data
// folder (followups.duckdb) with a header and detail lines.
let followupsStoreInst = null;
async function followupsStore() {
  if (!followupsStoreInst) {
    followupsStoreInst = await require('./lib/followups').open({
      file: path.join(app.getPath('userData'), 'followups.duckdb'),
    });
  }
  return followupsStoreInst;
}
// The app's data — the FDD library and the Application pages catalog — on its own git branch, apart from the code
// (lib/dataBranch.js: a worktree in <project>/.equiprite-data): the app commits and pushes there, never to the code
// branch, so code pushes and the app's pushes do not collide. If git cannot set it up, the data stays in the project.
let dataBranchInst = null;
function dataBranch() {
  if (!dataBranchInst) dataBranchInst = require('./lib/dataBranch').open({ root: path.join(__dirname, '..'), gitPath: commandPath('git') || 'git', log: (l) => { try { pushLog(l); } catch (e) { console.log(l); } } }).ensure();
  return dataBranchInst;
}
// The FDD library, for EquipRite Next's FDD library page and "Analyze with AI": documents shared through git (docs/fdd
// and webApps/equiprite-next/resources/fdd on the data branch), so every user has the same ones.
let fddStoreInst = null;
async function fddStore() {
  if (!fddStoreInst) fddStoreInst = require('./lib/fdd').open({ root: path.join(__dirname, '..'), data: await dataBranch(), gitPath: commandPath('git') || 'git' });
  return fddStoreInst;
}
// The Application pages catalog (lib/pages.js), shared through git (the data branch). Its screenshots: the page opened
// in a hidden window of this app — the same sign-in and the same live data as you see — and captured once it has settled.
let pagesStoreInst = null;
async function pagesStore() {
  if (!pagesStoreInst) pagesStoreInst = require('./lib/pages').open({ root: path.join(__dirname, '..'), data: await dataBranch(), gitPath: commandPath('git') || 'git', capture: capturePage });
  return pagesStoreInst;
}
/** What each app's local server is given (its login, the other versions' addresses, the stores it uses), for the
 *  app itself and for a sandbox's copy of it (Issues → Try it in a sandbox). */
async function appServerOptions(v) {
  return {
    getIdentity: () => identity,
    getVersions: () => ({ old: urlOf('old'), new: servers.new ? urlOf('new') : '', next: servers.next ? urlOf('next') : '',
      mobile: servers.mobile ? urlOf('mobile') : '', future: servers.future ? urlOf('future') : '', build: servers.build ? urlOf('build') : '' }),
    product: VERSIONS[v].product,
    getPhone: phoneLinks,
    // EquipRite Future keeps its demo story in DuckDB in this app's data folder (survives restarts and rebuilds).
    futureStore: v === 'future' ? await futureStore() : undefined,
    // EquipRite Next's SQL worksheet: the desktop app connects to Oracle for it (node-oracledb, Thin mode).
    sqlStore: nextLike(v) ? await sqlStore() : undefined,
    aiStore: nextLike(v) ? await aiStore() : undefined,
    // The Jira stories page (Old and Next): Connect Jira keeps the token on this PC; the proxy adds it.
    jiraStore: nextLike(v) || v === 'old' ? jiraStore() : undefined,
    // Record on a Jira story: its recordings and screenshots, kept on this PC.
    recStore: nextLike(v) || v === 'old' ? evidenceStore() : undefined,
    // Transcribe a recording's voice with Whisper (local on this PC, or OpenAI with the Ask AI key).
    transcribe: nextLike(v) || v === 'old' ? await transcriber() : undefined,
    // Standup minutes (EquipRite Next): the daily standup on the Jira backlog, kept on this PC.
    minutesStore: nextLike(v) ? await minutesStore() : undefined,
    // Saved follow-ups (EquipRite Next): follow-ups drafted on the Jira pages, kept on this PC.
    followupsStore: nextLike(v) ? await followupsStore() : undefined,
    // The FDD library: FDDs uploaded into the project and committed to git, so every user has them
    fddStore: nextLike(v) ? await fddStore() : undefined,
    // Saved AI analyses: each run kept on this PC, so an analysis opens without asking the AI again
    analysisStore: nextLike(v) ? analysisStore() : undefined,
    // The Application pages catalog: technical sheets of the VB pages and the Jira stories mapped to them, in git
    pagesStore: nextLike(v) ? await pagesStore() : undefined,
    // Code Fix: AI-proposed changes to a page, applied to the code only when approved
    fixStore: nextLike(v) ? await fixStore() : undefined,
    // Issues (Build.Rite): issue → AI write-up and analysis → approval → the agent's branch and pull request
    issuesStore: nextLike(v) ? await issuesStore() : undefined,
    // The API tester: a page's REST calls and reports, tried against the real backend
    apiStore: nextLike(v) ? apiStore() : undefined,
    // Setup → Organizations & projects (Build.Rite): VB Studio organizations and projects
    vbsStore: v === 'build' ? vbsStore() : undefined,
    vbsFind: v === 'build' ? openVbsFinder : undefined,
    backendOverrides: backendOverridesFromEnv(process.env),
    onLog: pushLog,
    onProblem: backendProblem,
  };
}
// A sandbox's app: its own build of the code (the issue's fix in it), served like the app itself — same login, backends
// and stores — on a free port of this PC, so the fix can be run and the page checked before anyone approves it.
async function serveSandbox(s) {
  const v = Object.keys(VERSIONS).filter((k) => VERSIONS[k].webApp === s.webApp && !VERSIONS[k].product)[0] || 'old';
  const srv = await createDevServer(Object.assign(await appServerOptions(v), { buildDir: s.buildDir, repoRoot: s.dir, webApp: s.webApp, port: 0, product: undefined }));
  pushLog(`${new Date().toTimeString().slice(0, 8)} sandbox ${path.basename(s.dir)}: ${VERSIONS[v].label} served at ${srv.url}`);
  return srv;
}
// The app as it is now (this PC's own build), for comparing with a sandbox.
const appUrlOf = (webApp) => { const v = Object.keys(VERSIONS).filter((k) => VERSIONS[k].webApp === webApp && !VERSIONS[k].product)[0]; return v && servers[v] ? servers[v].url : ''; };
// A window of its own for a sandbox (or the app as it is now, beside it): links inside its own address stay in it.
function openAppWindow(url, title) {
  const origin = new URL(url).origin;
  const [x, y] = win && !win.isDestroyed() ? win.getPosition() : [undefined, undefined];
  const w = new BrowserWindow({ width: 1440, height: 900, minWidth: 1024, minHeight: 640, x: x != null ? x + 64 : undefined, y: y != null ? y + 64 : undefined, title: String(title || 'EquipRite'),
    backgroundColor: '#f5f4f2', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true } });
  w.on('page-title-updated', (event) => event.preventDefault());
  w.webContents.setWindowOpenHandler(({ url: next }) => {
    if (String(next).indexOf(origin) === 0 || allowedNav(next)) return { action: 'allow' };
    if (/^(https?|mailto|ms-outlook|ms-settings):/i.test(next)) shell.openExternal(next);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (event, next) => {
    if (String(next).indexOf(origin) === 0 || allowedNav(next)) return;
    event.preventDefault();
    if (/^https?:/i.test(next)) shell.openExternal(next);
  });
  w.loadURL(url).catch(() => {});
  return true;
}
async function capturePage(webApp, url, base) {
  const v = Object.keys(VERSIONS).filter((k) => VERSIONS[k].webApp === webApp)[0];
  const srv = v ? servers[v] : null;
  if (!base && (!srv || !srv.url)) return { ok: false, error: ((v && VERSIONS[v].label) || webApp) + ' is not running in this app: build it (npm run build), then try again.' };
  const shotWin = new BrowserWindow({ width: 1440, height: 900, show: false, paintWhenInitiallyHidden: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
  try {
    await shotWin.loadURL(String(base || srv.url).replace(/\/$/, '') + url);
    // settled: nothing busy, and the text on the page the same for two seconds in a row (at most 30 s)
    const deadline = Date.now() + 30000;
    let last = '', same = 0;
    while (Date.now() < deadline && same < 2) {
      await new Promise((r) => setTimeout(r, 1000));
      const sig = await shotWin.webContents.executeJavaScript(
        "(function(){var b=document.body;if(!b)return '';var busy=document.querySelector('oj-progress-circle,.oj-progress-circle,[aria-busy=\"true\"],.nx-loading');return (busy?'busy:':'')+b.innerText.length;})()", true).catch(() => '');
      same = sig && sig === last && sig.indexOf('busy:') !== 0 && Number(sig) > 40 ? same + 1 : 0;
      last = sig;
    }
    const img = await shotWin.webContents.capturePage();
    return { ok: true, base64: img.toJPEG(75).toString('base64'), mime: 'image/jpeg' };
  } catch (e) {
    return { ok: false, error: 'Could not capture the page: ' + String((e && e.message) || e) };
  } finally {
    try { shotWin.destroy(); } catch (e) { /* closed */ }
  }
}
// Saved AI analyses, for EquipRite Next's Analyze with AI: each run kept in this app's data folder (ai-analyses.json).
// The API tester (Application pages → a page → Integrations → Test): a page's REST calls and BI Publisher reports sent
// to the real backend through the local server's proxy; the values last used and the runs kept on this PC (lib/apiTest.js).
let apiStoreInst = null;
function apiStore() {
  if (!apiStoreInst) apiStoreInst = require('./lib/apiTest').open({ root: REPO_ROOT, file: path.join(app.getPath('userData'), 'api-tests.json'), log: (l) => { try { pushLog(l); } catch (e) { console.log(l); } } });
  return apiStoreInst;
}
let analysisStoreInst = null;
function analysisStore() {
  if (!analysisStoreInst) analysisStoreInst = require('./lib/analyses').open({ file: path.join(app.getPath('userData'), 'ai-analyses.json') });
  return analysisStoreInst;
}
// Issues (Build.Rite): logged against a page, written up and analyzed by the AI (with the FDD), approved (in the app, and
// an approval email from Microsoft 365), then applied by the agent on a branch of its own with a pull request; Jira kept
// up to date (lib/issues.js). Shared with everyone on the data branch.
let issuesStoreInst = null;
async function issuesStore() {
  if (!issuesStoreInst) {
    issuesStoreInst = require('./lib/issues').open({
      file: path.join(app.getPath('userData'), 'issues.json'), ai: await aiStore(), fix: await fixStore(), mail: graphStore(), data: await dataBranch(), pages: await pagesStore(),
      jira: { auth: () => jiraStore().auth(), fetch: (url, init) => { const { net } = require('electron'); return net.fetch(url, init); } },
      fdd: require('./lib/issues').fddPicker(() => fddStoreInst, REPO_ROOT), gitPath: commandPath('git') || 'git', openWindow: openAppWindow,
      log: (l) => { try { pushLog(l); } catch (e) { console.log(l); } },
    });
  }
  return issuesStoreInst;
}
// Setup → Organizations & projects (Build.Rite): VB Studio organizations and their projects, the password encrypted by the
// OS keychain in this app's data folder; git and VB Studio's API reached from this PC (electron's net: the system's proxy).
let vbsStoreInst = null;
function vbsStore() {
  if (!vbsStoreInst) {
    vbsStoreInst = require('./lib/vbs').open({
      file: path.join(app.getPath('userData'), 'vbs-connections.json'),
      encrypt: canEncrypt() ? (t) => safeStorage.encryptString(t) : null,
      decrypt: canEncrypt() ? (b) => safeStorage.decryptString(b) : null,
      fetch: (url, init) => { const { net } = require('electron'); return net.fetch(url, init); },
      gitPath: commandPath('git') || 'git',
    });
  }
  return vbsStoreInst;
}
// Find in VB Studio (Setup → Organizations & projects): VB Studio in a window of its own — signed in there as usual (its
// own session, kept between runs) — and what its pages load read as they load (the window's DevTools network events):
// its organizations, projects (their Git addresses) and workspaces (lib/vbsLearn.js). Only VB Studio's own host, never a
// sign-in call; read, never changed. VB Studio has no documented API that lists them.
let vbsFinderWin = null;
async function openVbsFinder(url) {
  const store = vbsStore();
  let target = String(url || '').trim();
  if (!target) { const o = store.state().orgs[0]; target = o ? o.url : ''; }
  if (!/^https:\/\/[^/]+\.oraclecloud\.com\/[^/]+/i.test(target)) return { ok: false, error: 'Give the VB Studio address first (https://<host>/<organization>/): add the organization, or paste it here.' };
  // its log: live on the Setup screen and in this app's log — each address without its query (never a sign-in code)
  const bare = (u) => { try { const x = new URL(u); return x.origin + x.pathname + (x.hash ? x.hash.split('?')[0].slice(0, 80) : ''); } catch (e) { return String(u || '').split('?')[0].slice(0, 160); } };
  const say = (text) => { const line = String(text).slice(0, 400); try { store.finderLog(line); } catch (e) { /* no store */ } pushLog(`${new Date().toTimeString().slice(0, 8)} VB Studio window: ${line}`); };
  if (vbsFinderWin && !vbsFinderWin.isDestroyed()) {
    say('already open: going to ' + bare(target));
    vbsFinderWin.loadURL(target).catch((e) => say('could not load: ' + e.message));
    vbsFinderWin.show(); vbsFinderWin.focus();
    store.setFinder(true, target);
    return { ok: true, url: target, again: true };
  }
  store.setFinder(true, target, true);
  say('opening ' + bare(target));
  const L = require('./lib/vbsLearn');
  const learner = L.learner();
  const w = new BrowserWindow({ width: 1320, height: 900, show: true, backgroundColor: '#ffffff', title: 'VB Studio · opening…',
    webPreferences: { partition: 'persist:vbstudio', contextIsolation: true, sandbox: true, nodeIntegration: false } });
  vbsFinderWin = w;
  const wc = w.webContents;
  // a browser's own name: VB Studio and Oracle's sign-in may turn away one they do not know (Electron's, this app's)
  try { wc.setUserAgent(wc.getUserAgent().replace(/\s(Electron|build-?rite|equiprite[\w-]*)\/\S+/gi, '')); } catch (e) { /* kept */ }
  const title = (t) => { try { if (!w.isDestroyed()) w.setTitle('VB Studio · ' + t + ' — Build.Rite reads its organizations, projects and workspaces as you browse'); } catch (e) { /* closed */ } };
  w.on('page-title-updated', (e, t) => { e.preventDefault(); title(t || 'VB Studio'); });
  // Oracle's sign-in may open a window of its own: allowed for Oracle's hosts only (same session); anything else in the browser
  wc.setWindowOpenHandler(({ url: next }) => {
    if (/^https:\/\/[^/]+\.(oraclecloud|oracle)\.com\//i.test(next)) { say('the page opened a window: ' + bare(next)); return { action: 'allow', overrideBrowserWindowOptions: { webPreferences: { partition: 'persist:vbstudio', contextIsolation: true, sandbox: true, nodeIntegration: false } } }; }
    if (/^https?:/i.test(next)) { say('opened in your browser: ' + bare(next)); shell.openExternal(next); }
    return { action: 'deny' };
  });
  // each step of the window, said: going to, redirected (Oracle's sign-in), the page and its HTTP status, loaded, failed
  const SIGNIN_HOST = /identity\.oraclecloud\.com|\/sso\/|signin|login\.|\/oauth2\//i;
  wc.on('did-start-loading', () => title('loading…'));
  // (newer Electron gives the details on the event, older as arguments: both read)
  const nav = (e, u, inPage, isMain) => ({ url: (e && e.url) || u || '', same: e && e.isSameDocument !== undefined ? e.isSameDocument : !!inPage, main: e && e.isMainFrame !== undefined ? e.isMainFrame : isMain !== false });
  wc.on('did-start-navigation', (e, u, inPage, isMain) => { const n = nav(e, u, inPage, isMain); if (n.main && !n.same && !/^data:/.test(n.url)) say('going to ' + bare(n.url)); });
  wc.on('did-redirect-navigation', (e, u, inPage, isMain) => { const n = nav(e, u, inPage, isMain); if (n.main) say('redirected to ' + bare(n.url) + (SIGNIN_HOST.test(n.url) ? '   (Oracle\'s sign-in: sign in here)' : '')); });
  wc.on('did-navigate', (e, u, code, status) => { if (!/^data:/.test(u)) say('page ' + bare(u) + ' — HTTP ' + code + (status ? ' ' + status : '')); });
  wc.on('did-finish-load', () => { const u = wc.getURL(); if (!/^data:/.test(u)) say('loaded: "' + (wc.getTitle() || 'no title') + '" — ' + bare(u)); });
  wc.on('did-fail-load', (e, code, desc, u, isMain) => {
    if (!isMain || code === -3) return; // -3: replaced by another navigation (a redirect), not a failure
    say('could not load ' + bare(u) + ': ' + desc + ' (' + code + ')');
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const html = '<!doctype html><meta charset="utf-8"><title>VB Studio did not open</title><body style="font:15px system-ui,Segoe UI,sans-serif;margin:48px;color:#16212c">'
      + '<h2 style="margin:0 0 12px">VB Studio did not open</h2><p><b>' + esc(desc) + '</b> (' + code + ')<br><code>' + esc(bare(u)) + '</code></p>'
      + '<p>Check that this PC can open that address in a browser (the network, a VPN or a proxy). Build.Rite\'s log (Setup → Organizations &amp; projects) shows each step.</p>'
      + '<p><a href="' + esc(target) + '" style="display:inline-block;padding:8px 14px;border-radius:8px;background:#0a66c9;color:#fff;text-decoration:none">Try again</a></p></body>';
    wc.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).catch(() => {});
  });
  wc.on('certificate-error', (e, u, err) => say('its certificate was refused: ' + bare(u) + ' — ' + err));
  wc.on('render-process-gone', (e, d) => say('the page stopped: ' + ((d && d.reason) || 'crashed')));
  wc.on('unresponsive', () => say('the page stopped responding'));
  let pageErrors = 0;
  wc.on('console-message', (e, level, message) => {
    const lvl = e && e.level !== undefined ? e.level : level;
    const msg = e && e.message !== undefined ? e.message : message;
    if ((lvl === 3 || lvl === 'error') && pageErrors < 12) { pageErrors++; say('page error: ' + String(msg || '').slice(0, 200)); }
  });
  // what its pages load: VB Studio's own JSON answers read (never a sign-in call, never another site); each one said
  const keepNow = () => { try { store.learn(Object.assign(learner.found(), { calls: learner.calls() })); } catch (e) { /* closed */ } };
  let flush = null;
  const keep = () => { if (flush) return; flush = setTimeout(() => { flush = null; keepNow(); }, 800); };
  const counts = () => { const f = learner.found(); return f.orgs.length + ' org · ' + f.projects.length + ' projects · ' + f.projects.reduce((n, p) => n + p.repos.length, 0) + ' repos · ' + f.workspaces.length + ' workspaces'; };
  const pending = {};
  let skipped = 0, read = 0;
  const dbg = wc.debugger;
  try { dbg.attach('1.3'); say('watching its network: on'); } catch (e) { say('could not watch its network (' + e.message + '): it opens, but nothing can be read from it'); }
  dbg.on('detach', (e, reason) => say('stopped watching its network: ' + reason));
  dbg.on('message', async (event, method, params) => {
    if (method === 'Network.responseReceived') {
      const r = params.response || {};
      if (params.type === 'Document') { if (learner.see({ url: r.url, status: r.status })) keep(); return; }
      if (/json/i.test(r.mimeType || '') || /\/rest\//.test(r.url || '')) pending[params.requestId] = { url: r.url, status: r.status };
    } else if (method === 'Network.loadingFinished' && pending[params.requestId]) {
      const p = pending[params.requestId];
      delete pending[params.requestId];
      let u;
      try { u = new URL(p.url); } catch (e) { return; }
      if (!L.isVbsHost(u.hostname) || L.SIGNIN.test(u.pathname + u.search)) { skipped++; return; } // never a sign-in call, never another site
      try {
        const b = await dbg.sendCommand('Network.getResponseBody', { requestId: params.requestId });
        const text = b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body;
        let json = null;
        try { json = JSON.parse(text); } catch (e) { json = null; }
        if (json !== null && learner.see({ url: p.url, status: p.status, json: json })) { read++; say('read ' + u.pathname.replace(/^\/[^/]+/, '/<org>') + ' (HTTP ' + p.status + ') — found so far: ' + counts()); keep(); }
      } catch (e) { say('could not read ' + u.pathname + ': ' + e.message); }
    } else if (method === 'Network.loadingFailed' && pending[params.requestId]) {
      const p = pending[params.requestId];
      delete pending[params.requestId];
      say('a call failed: ' + bare(p.url) + ' — ' + (params.errorText || 'failed'));
    }
  });
  // the page loads at once; its network watched as soon as it is ready (never waited for longer than a moment)
  w.loadURL(target).catch((e) => say('could not load: ' + e.message));
  const on = await Promise.race([dbg.sendCommand('Network.enable').then(() => 'on', (e) => 'not on: ' + e.message), new Promise((r) => setTimeout(() => r('slow'), 2000))]).catch((e) => 'not on: ' + e.message);
  if (on !== 'on') say('reading its pages: ' + (on === 'slow' ? 'switching on (slowly)' : on));
  w.on('closed', () => { keepNow(); say('closed — read ' + read + ' answer(s) from VB Studio, skipped ' + skipped + ' (sign-in, other sites); found ' + counts()); store.setFinder(false, target); if (vbsFinderWin === w) vbsFinderWin = null; });
  return { ok: true, url: target };
}
// Code Fix (Application pages → a page → Code fix): the AI chosen in AI settings proposes a change to a page; it is
// written into the project's code only once approved (after git pull), then tested, committed or undone. The fixes are
// kept in this app's data folder; its screenshots before/after are taken in a hidden window, like the pages' own.
let fixStoreInst = null;
async function fixStore() {
  if (!fixStoreInst) {
    fixStoreInst = require('./lib/codeFix').open({
      root: REPO_ROOT, file: path.join(app.getPath('userData'), 'code-fixes.json'), ai: await aiStore(), capture: capturePage, buildDir: BUILD_DIR,
      // sandboxes (Issues → Try it in a sandbox): built with this project's own build tool, served like the app itself
      buildTool: REPO_ROOT, serveSandbox: serveSandbox, appUrl: appUrlOf,
      data: await dataBranch(), log: (l) => { try { pushLog(l); } catch (e) { console.log(l); } }, // the change history, shared on the data branch
      gitPath: commandPath('git') || 'git',
      pickFolder: async (current) => {
        const r = await dialog.showOpenDialog(win && !win.isDestroyed() ? win : undefined, { title: 'The EquipRite project folder (the code to fix)', defaultPath: current, properties: ['openDirectory'] });
        return r.canceled ? '' : (r.filePaths[0] || '');
      },
    });
  }
  return fixStoreInst;
}
// Find a command for transcription (ffmpeg, whisper-cli), looking beyond the app's start-time PATH — in winget, Scoop,
// Chocolatey and Homebrew folders — so a tool just installed is found without restarting the app (lib/findCommand.js).
function commandPath(cmd) {
  return require('./lib/findCommand').find(cmd, {});
}
// Run a command for transcription (ffmpeg, whisper, winget, brew). Never rejects: resolves { code, errno, stdout, stderr,
// cmd }. On Windows some tools are launched through a shim/alias that Node cannot spawn directly ("spawn … EFTYPE" /
// EINVAL) — so a spawn-level failure is retried once through the shell, which runs those. errno is the spawn error code
// (a string) when there was one, so the caller can explain it.
const SPAWN_ERR = /^(ENOENT|EFTYPE|EINVAL|EACCES|EPERM|UNKNOWN)$/;
function runCommand(cmd, args) {
  const { execFile } = require('child_process');
  const opts = { maxBuffer: 64 * 1024 * 1024, windowsHide: true };
  const quote = (s) => '"' + String(s).replace(/"/g, '""') + '"';
  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    const pack = (err, stdout, stderr) => ({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
      errno: err && typeof err.code === 'string' ? err.code : '', stdout: String(stdout || ''), stderr: String(stderr || (err && err.message) || ''), cmd });
    const viaShell = () => {
      try {
        execFile(quote(cmd) + ' ' + (args || []).map(quote).join(' '), Object.assign({ shell: true }, opts),
          (err, stdout, stderr) => done(pack(err, stdout, stderr)));
      } catch (e) { done(pack(e, '', '')); }
    };
    try {
      execFile(cmd, args || [], opts, (err, stdout, stderr) => {
        if (err && typeof err.code === 'string' && SPAWN_ERR.test(err.code)) { viaShell(); return; }
        done(pack(err, stdout, stderr));
      });
    } catch (e) {
      if (e && typeof e.code === 'string' && SPAWN_ERR.test(e.code)) { viaShell(); return; }
      done(pack(e, '', ''));
    }
  });
}
let recSource = '';
const REC_KEYS = { shot: 'CommandOrControl+Alt+S', stop: 'CommandOrControl+Alt+X' };
ipcMain.handle('rec:sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
  return sources.map((x) => ({ id: x.id, name: x.name, kind: x.id.startsWith('screen:') ? 'screen' : 'window',
    thumb: x.thumbnail && !x.thumbnail.isEmpty() ? x.thumbnail.toDataURL() : '' }));
});
ipcMain.handle('rec:use', (event, id) => { recSource = String(id || ''); return true; });
// While recording: a screenshot and Stop from anywhere (the test usually runs in another window or app).
ipcMain.handle('rec:state', (event, on) => {
  Object.values(REC_KEYS).forEach((k) => { if (globalShortcut.isRegistered(k)) globalShortcut.unregister(k); });
  if (on) {
    const sender = event.sender;
    Object.entries(REC_KEYS).forEach(([what, k]) => {
      globalShortcut.register(k, () => { if (!sender.isDestroyed()) sender.send('rec:key', what); });
    });
  }
  const mac = process.platform === 'darwin';
  return { shot: mac ? '⌘⌥S' : 'Ctrl+Alt+S', stop: mac ? '⌘⌥X' : 'Ctrl+Alt+X' };
});
ipcMain.handle('rec:window', (event, what) => {
  const w = BrowserWindow.fromWebContents(event.sender);
  if (!w || w.isDestroyed()) return false;
  if (what === 'minimize') w.minimize();
  else if (what === 'restore') { if (w.isMinimized()) w.restore(); w.show(); w.focus(); }
  return true;
});
const VERSIONS = {
  old: { webApp: 'vbredwoodapp', label: 'Old EquipRite', port: PORT },
  new: { webApp: 'equiprite', label: 'New EquipRite', port: PORT + 1 },
  next: { webApp: 'equiprite-next', label: 'EquipRite Next', port: PORT + 2 },
  // Never the main window's app: it opens in a phone-sized window of its own (openMobileWindow).
  mobile: { webApp: 'equiprite-mobile', label: 'EquipRite Mobile', port: PORT + 3 },
  // Served like Next (only when built); its data is simulated in the browser, so it calls no backend.
  future: { webApp: 'equiprite-future', label: 'EquipRite Future', port: PORT + 4 },
  // Build.Rite: EquipRite Next's build shown as the team's own tools (the Insights screens only: Jira, standups,
  // follow-ups, the FDD, application pages, code fix), a product apart from the business one, on a port of its own.
  build: { webApp: 'equiprite-next', label: 'Build.Rite', port: PORT + 5, product: 'buildrite' },
};
const originOf = (v) => `http://localhost:${VERSIONS[v].port}`;
/** Next, or Build.Rite (Next's build shown as the team's tools): the same screens, given the same stores. */
const nextLike = (v) => v === 'next' || v === 'build';
const urlOf = (v) => `${originOf(v)}/`;

process.env.EQP_DESKTOP_VERSION = app.getVersion();

let win = null;
let signinWin = null;
let logWin = null;
let servicesWin = null;
let oldWin = null; // Old EquipRite beside New, opened from New's "Old" links
let mobileWin = null; // EquipRite Mobile, phone-sized
let phoneWin = null; // EquipRite on your phone: the QR codes
// EquipRite Mobile for a phone on the Wi-Fi (File > EquipRite on your phone): off until switched on, one pairing key.
const PHONE_PORT = PORT + 10;
const lan = { server: null, token: null, url: '', error: '' };
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

// When the app's own process is held (a long piece of work: nothing it serves can answer meanwhile, so a screen opening
// waits), the log says for how long — File → Backend calls… (Ctrl+Shift+L).
(function watchBusy() {
  let last = Date.now();
  const t = setInterval(() => {
    const now = Date.now();
    const held = now - last - 250;
    last = now;
    if (held > 500) { try { pushLog(new Date(now).toLocaleTimeString() + ' busy: the app was held for ' + held + ' ms (screens waited)'); } catch (e) { /* not yet */ } }
  }, 250);
  if (t.unref) t.unref();
}());
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
  // A paired phone works as the person signed in: it stops with them, and is forgotten.
  stopLan(true);
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
    futureAvailable: !!servers.future,
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
  // Signing in as someone else: a phone paired for the one before must pair again.
  stopLan(true);
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

/** File → Open Old / New EquipRite / EquipRite Next / EquipRite Future: switch apps and stay signed in. The choice is remembered. */
function openVersion(v) {
  if (v === 'mobile' && servers.mobile) {
    openMobileWindow();
    return;
  }
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
    if (/^(https?|mailto|ms-outlook|ms-settings):/i.test(next)) {
      shell.openExternal(next);
    }
    return { action: 'deny' };
  });
  oldWin.webContents.on('will-navigate', (event, next) => {
    if (allowedNav(next)) {
      return;
    }
    event.preventDefault();
    if (/^(https?|mailto|ms-outlook|ms-settings):/i.test(next)) {
      shell.openExternal(next);
    }
  });
  oldWin.on('closed', () => {
    oldWin = null;
  });
  pushLog(`${new Date().toTimeString().slice(0, 8)} opening ${VERSIONS.old.label} in its own window`);
  oldWin.loadURL(target).catch(() => {});
}

/** EquipRite Mobile in a phone-sized window of its own (one; a second open brings it to the front). */
function openMobileWindow(url) {
  if (!identity) {
    openSignIn();
    return;
  }
  const target = url || urlOf('mobile');
  if (mobileWin && !mobileWin.isDestroyed()) {
    mobileWin.loadURL(target).catch(() => {});
    if (mobileWin.isMinimized()) {
      mobileWin.restore();
    }
    mobileWin.focus();
    return;
  }
  const [x, y] = win && !win.isDestroyed() ? win.getPosition() : [undefined, undefined];
  mobileWin = new BrowserWindow({
    width: 410,
    height: 860,
    minWidth: 340,
    minHeight: 560,
    x: x != null ? x + 72 : undefined,
    y: y != null ? y + 32 : undefined,
    title: `${VERSIONS.mobile.label} (preview) · ${app.getVersion()}`,
    backgroundColor: '#f3f5f8',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  mobileWin.setMenu(null);
  mobileWin.on('page-title-updated', (event) => event.preventDefault());
  mobileWin.webContents.setWindowOpenHandler(({ url: next }) => {
    if (allowedNav(next)) {
      return { action: 'allow' };
    }
    if (/^(https?|mailto|ms-outlook|ms-settings):/i.test(next)) {
      shell.openExternal(next);
    }
    return { action: 'deny' };
  });
  mobileWin.webContents.on('will-navigate', (event, next) => {
    if (allowedNav(next)) {
      return;
    }
    event.preventDefault();
    if (/^(https?|mailto|ms-outlook|ms-settings):/i.test(next)) {
      shell.openExternal(next);
    }
  });
  mobileWin.on('closed', () => {
    mobileWin = null;
  });
  pushLog(`${new Date().toTimeString().slice(0, 8)} opening ${VERSIONS.mobile.label} in a phone-sized window`);
  mobileWin.loadURL(target).catch(() => {});
}

// ── EquipRite on your phone ──────────────────────────────────────────────────────────────────────────────
const phoneFile = () => path.join(app.getPath('userData'), 'phone.json');

/** Keeps these in phone.json (this PC's user data): the VBCS address, and whether the Wi-Fi link is on, with its key. */
function savePhone(patch) {
  fs.writeFileSync(phoneFile(), JSON.stringify(Object.assign(loadPhone(), patch), null, 2), 'utf8');
}

function loadPhone() {
  try {
    return JSON.parse(fs.readFileSync(phoneFile(), 'utf8')) || {};
  } catch {
    return {};
  }
}

/** What the phone window shows: the VBCS code (from the saved address) and the Wi-Fi code (when switched on). */
function phoneState(vbcsError) {
  const saved = loadPhone();
  const vbcs = saved.vbcs ? phone.mobileUrlFromVbcs(saved.vbcs) : {};
  return {
    built: !!servers.mobile,
    vbcs: { input: saved.vbcs || '', url: vbcs.url || '', qr: vbcs.url ? phone.qrSvg(phone.fromQr(vbcs.url), 256) : '', error: vbcsError || '' },
    lan: { on: !!lan.server, url: lan.url, qr: lan.url ? phone.qrSvg(lan.url, 256) : '', error: lan.error },
  };
}

/** EquipRite for Android's version (android/build.sh writes it next to the APK), so a phone with an older app is offered it. */
function phoneAppVersion() {
  try {
    return String(JSON.parse(fs.readFileSync(path.join(__dirname, 'phone-app', 'version.json'), 'utf8')).versionName || '');
  } catch {
    return '';
  }
}

/** Opens EquipRite Mobile to a paired phone on the Wi-Fi: with token, the same key as before (a restart). */
async function startLan(token) {
  lan.error = '';
  if (!servers.mobile) {
    lan.error = 'EquipRite Mobile is not built on this PC yet: run "npm run desktop:fresh".';
    return;
  }
  if (!identity) {
    lan.error = 'Sign in first (File > Sign in as…): the phone works as the person signed in here.';
    return;
  }
  const addresses = phone.lanAddresses(os.networkInterfaces());
  if (!addresses.length) {
    lan.error = 'This PC is not on a network a phone can reach. Connect it to the same Wi-Fi as the phone.';
    return;
  }
  lan.token = token || phone.newToken();
  try {
    lan.server = await createDevServer({
      buildDir: BUILD_DIR,
      webApp: VERSIONS.mobile.webApp,
      port: PHONE_PORT,
      host: '0.0.0.0',
      pairToken: () => lan.token,
      getIdentity: () => identity,
      // The other versions' addresses here are this PC's own (localhost): not for a phone.
      getVersions: () => ({}),
      // EquipRite for Android (android/build.sh): "Open in the EquipRite app" on the phone, or its download.
      phoneApp: { apkFile: path.join(__dirname, 'phone-app', 'EquipRite.apk'), version: phoneAppVersion() },
      backendOverrides: backendOverridesFromEnv(process.env),
      onLog: pushLog,
      onProblem: backendProblem,
    });
  } catch (e) {
    lan.token = null;
    lan.error = `Could not start it: ${(e && e.message) || e}`;
    return;
  }
  lan.url = phone.pairUrl(addresses[0].address, PHONE_PORT, lan.token);
  // On again with this key next time EquipRite starts, so a phone (and its app) keeps working after a restart.
  savePhone({ lanOn: true, lanToken: lan.token });
  pushLog(`${new Date().toTimeString().slice(0, 8)} EquipRite Mobile open to a paired phone at http://${addresses[0].address}:${PHONE_PORT}/`);
}

/** Closes it. forget: switched off, signed out or someone else signed in (a new key next time); else EquipRite is
 * quitting, and it comes back on with the same key when EquipRite starts again. */
async function stopLan(forget) {
  if (forget) {
    savePhone({ lanOn: false, lanToken: null });
  }
  lan.token = null;
  lan.url = '';
  const s = lan.server;
  lan.server = null;
  if (s) {
    await s.close();
    pushLog(`${new Date().toTimeString().slice(0, 8)} EquipRite Mobile closed to phones`);
  }
}

/** File > EquipRite on your phone: the QR codes. */
function openPhoneWindow() {
  if (phoneWin && !phoneWin.isDestroyed()) {
    phoneWin.focus();
    return;
  }
  phoneWin = new BrowserWindow({
    width: 900,
    height: 780,
    minWidth: 760,
    minHeight: 640,
    title: 'EquipRite on your phone',
    backgroundColor: '#f3f5f8',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'phone-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  phoneWin.setMenu(null);
  phoneWin.on('closed', () => {
    phoneWin = null;
  });
  phoneWin.loadFile(path.join(__dirname, 'phone.html'));
}

const fromPhone = (event) => !!phoneWin && !phoneWin.isDestroyed() && event.sender === phoneWin.webContents;

/** The addresses a phone opens EquipRite Mobile at, for Next's toolbar QR code (/__phone, this PC only). */
function phoneLinks() {
  const saved = loadPhone();
  const vbcs = saved.vbcs ? phone.mobileUrlFromVbcs(saved.vbcs) : {};
  return { vbcs: vbcs.url ? phone.fromQr(vbcs.url) : '', lan: lan.url || '' };
}

// Next's toolbar QR code, from one of the app's windows: "Set it up" opens the phone window.
ipcMain.handle('desktop:phone', (event) => {
  const fromApp = [win, oldWin, mobileWin].some((w) => w && !w.isDestroyed() && event.sender === w.webContents);
  if (fromApp) {
    openPhoneWindow();
  }
  return fromApp;
});

ipcMain.handle('phone:state', (event) => (fromPhone(event) ? phoneState() : null));
ipcMain.handle('phone:vbcs', (event, text) => {
  if (!fromPhone(event)) {
    return null;
  }
  const raw = String(text || '').trim();
  const checked = raw ? phone.mobileUrlFromVbcs(raw) : {};
  if (checked.error) {
    return phoneState(checked.error);
  }
  savePhone({ vbcs: raw });
  return phoneState();
});
ipcMain.handle('phone:lan', async (event, on) => {
  if (!fromPhone(event)) {
    return null;
  }
  if (on && !lan.server) {
    await startLan();
  } else if (!on) {
    lan.error = '';
    await stopLan(true);
  }
  return phoneState();
});
ipcMain.handle('phone:copy', (event, text) => {
  if (fromPhone(event)) {
    clipboard.writeText(String(text || ''));
  }
  return true;
});

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
    // Next's profile menu links to EquipRite Mobile: the phone-sized window.
    if (servers.mobile && String(url).startsWith(urlOf('mobile'))) {
      openMobileWindow(url);
      return { action: 'deny' };
    }
    if (allowedNav(url)) {
      return { action: 'allow' };
    }
    if (/^(https?|mailto|ms-outlook|ms-settings):/i.test(url)) {
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
    if (servers.mobile && String(url).startsWith(urlOf('mobile'))) {
      event.preventDefault();
      openMobileWindow(url);
      return;
    }
    if (allowedNav(url)) {
      return;
    }
    event.preventDefault();
    if (/^(https?|mailto|ms-outlook|ms-settings):/i.test(url)) {
      shell.openExternal(url);
    }
  });
  // Switching with the version switch in the app (Old / New / Next / Future): the window title and the app opened next
  // time follow. Mobile opens in its own phone-sized window instead (above).
  win.webContents.on('did-navigate', (_event, url) => {
    const v = Object.keys(VERSIONS).find((k) => k !== 'mobile' && servers[k] && String(url).startsWith(urlOf(k)));
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
        { label: 'Open EquipRite Mobile (phone size)', accelerator: 'CmdOrCtrl+Shift+4', click: () => openVersion('mobile') },
        { label: 'Open EquipRite Future', accelerator: 'CmdOrCtrl+Shift+5', click: () => openVersion('future') },
        { label: 'Open Build.Rite (the team\'s tools)', accelerator: 'CmdOrCtrl+Shift+7', click: () => openVersion('build') },
        { label: 'EquipRite on your phone (QR code)…', accelerator: 'CmdOrCtrl+Shift+6', click: () => openPhoneWindow() },
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
    // Record (a Jira story's panel): the page asks for the screen (getDisplayMedia); this answers with the screen or window
    // the person picked in the page (rec:use), else the main screen. Only EquipRite's own pages on this PC are answered.
    // EquipRite's own pages on this PC (lib/localOrigin.js): the origin may arrive with a path or as a bare origin.
    const localOnly = require('./lib/localOrigin').isLocal;
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      const from = String((request.frame && request.frame.url) || request.securityOrigin || '');
      if (!localOnly(from)) { callback({}); return; }
      desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
        const pick = sources.find((x) => x.id === recSource) || sources.find((x) => x.id.startsWith('screen:'));
        callback(pick ? { video: pick } : {});
      }).catch(() => callback({}));
    });
    // Record (screen capture) and Record my voice (microphone) ask the session for permission. Grant EquipRite's own
    // pages on this PC what they ask for (screen, mic, clipboard…); refuse everything from any other origin.
    session.defaultSession.setPermissionRequestHandler((wc, permission, done) => {
      done(localOnly(wc && !wc.isDestroyed() ? wc.getURL() : ''));
    });
    session.defaultSession.setPermissionCheckHandler((wc, permission, origin) => localOnly(origin || (wc && !wc.isDestroyed() ? wc.getURL() : '')));
    Menu.setApplicationMenu(appMenu());
    createWindow();
    try {
      // The old app must be there (it is today's app); New, Next, Mobile and Future are served when they have been built.
      for (const v of Object.keys(VERSIONS)) {
        if (v === 'old' || isBuilt(BUILD_DIR, VERSIONS[v].webApp)) {
          servers[v] = await createDevServer(Object.assign(await appServerOptions(v), { buildDir: BUILD_DIR, webApp: VERSIONS[v].webApp, port: VERSIONS[v].port }));
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
      // The phone's Wi-Fi link was on when EquipRite closed: on again, same key, so a paired phone just carries on.
      const phoneSaved = loadPhone();
      if (phoneSaved.lanOn && phoneSaved.lanToken) {
        startLan(phoneSaved.lanToken).catch(() => {});
      }
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
    if (futureDbStore) futureDbStore.close().catch(() => {});
    if (sqlConnStore) sqlConnStore.close().catch(() => {});
    quitting = true;
    Object.values(servers).forEach((s) => s.close());
    stopLan();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' || quitting) {
      app.quit();
    }
  });
}

// Record: shortcuts released and open recordings closed as they are (what was written stays playable).
app.on('will-quit', () => {
  try { globalShortcut.unregisterAll(); } catch (e) { /* not registered */ }
  if (evidenceStoreInst) evidenceStoreInst.closeAll();
});

// Record, with its technical trace (lib/testTrace.js): while a traced recording runs, every EquipRite window's console
// errors and warnings, crashes and page changes go on its timeline (the web service calls come from lib/devserver.js).
app.on('web-contents-created', (event, wc) => {
  const TT = require('./lib/testTrace');
  const tracing = () => !!(evidenceStoreInst && evidenceStoreInst.tracing());
  const add = (entry) => { try { if (entry && tracing()) evidenceStoreInst.traceAdd(entry); } catch (e) { /* the trace is best effort */ } };
  wc.on('console-message', (...args) => { if (tracing()) add(TT.consoleEntry(args, wc.isDestroyed() ? '' : wc.getURL())); });
  wc.on('did-navigate', (e, url) => { if (tracing()) add(TT.pageEntry(url)); });
  wc.on('did-navigate-in-page', (e, url, isMainFrame) => { if (isMainFrame && tracing()) add(TT.pageEntry(url)); });
  wc.on('render-process-gone', (e, details) => add({ kind: 'console', t: Date.now(), level: 'error', message: 'The page stopped: ' + ((details && details.reason) || 'crashed'), source: '', line: 0, page: '' }));
  wc.on('unresponsive', () => add({ kind: 'console', t: Date.now(), level: 'warning', message: 'The page stopped responding.', source: '', line: 0, page: '' }));
});
