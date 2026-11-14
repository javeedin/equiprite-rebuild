'use strict';
/**
 * Sync from VB Studio, from inside VB Studio's own page (desktop app). VB Studio's internal calls (api2) answer only VB
 * Studio's page: the username and password, or a call from outside, get its sign-in page. So each call is made from
 * inside VB Studio — a hidden window on the organization's page, signed in with the session kept from Open VB Studio
 * (its partition), and the call a fetch() in that page: its cookies, plus the sign-in and X-… headers VB Studio's own
 * calls send (seen in its network; memory only). VB Studio's own host only; read only (GET). The window is closed a
 * minute after the last call. Not signed in (the sign-in page stays): { signIn: true }.
 *
 *   create({ BrowserWindow, partition, isHost(host), signInUrl: RegExp, apiPath: RegExp, log(text), idleMs, readyMs })
 *     → { fetch(url, init) → Response-like { ok, status, headers.get, text() } | { signIn: true }, close() }
 */
const str = (v) => (v === undefined || v === null ? '' : String(v));

function create(o) {
  const BrowserWindow = o.BrowserWindow;
  const partition = o.partition || 'persist:vbstudio';
  const isHost = o.isHost || (() => false);
  const signInUrl = o.signInUrl || /identity\.oraclecloud\.com|\/sso\/|signin|login\.|\/oauth2\//i;
  const apiPath = o.apiPath || /\/(api2|rest|s2)\//;
  const log = o.log || (() => {});
  const idleMs = o.idleMs || 60000;
  const readyMs = o.readyMs || 35000;
  const signInMs = o.signInMs || 5000;
  const quietMs = o.quietMs || 8000;
  let cur = null;

  function page(orgUrl) {
    if (cur && cur.orgUrl === orgUrl && !cur.win.isDestroyed()) return cur;
    close();
    const host = new URL(orgUrl).hostname.toLowerCase();
    const win = new BrowserWindow({ show: false, width: 1280, height: 860, webPreferences: { partition: partition, contextIsolation: true, sandbox: true, nodeIntegration: false } });
    const wc = win.webContents;
    // a browser's own name (VB Studio and Oracle's sign-in may turn away one they do not know)
    try { wc.setUserAgent(wc.getUserAgent().replace(/\s(Electron|build-?rite|equiprite[\w-]*)\/\S+/gi, '')); } catch (e) { /* kept */ }
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    const st = { win: win, orgUrl: orgUrl, host: host, token: '', extra: {}, calls: 0, idle: null };
    cur = st;
    try {
      wc.debugger.attach('1.3');
      wc.debugger.on('message', (event, method, params) => {
        if (method !== 'Network.requestWillBeSent') return;
        const q = params.request || {};
        try {
          const u = new URL(q.url);
          if (u.hostname.toLowerCase() !== host || !apiPath.test(u.pathname)) return;
          st.calls++;
          // its sign-in, and the headers of its own (X-…: a CSRF token, its client's name), sent again with Sync's calls
          Object.keys(q.headers || {}).forEach((k) => {
            if (/^authorization$/i.test(k) && /^Bearer\s/i.test(str(q.headers[k]))) st.token = str(q.headers[k]);
            else if (/^x-/i.test(k) && !/^x-client-data$/i.test(k)) st.extra[k] = str(q.headers[k]);
          });
        } catch (e) { /* not an address */ }
      });
      wc.debugger.sendCommand('Network.enable').catch(() => {});
    } catch (e) { log('its network not watched (' + e.message + ')'); }
    win.on('closed', () => { if (cur === st) cur = null; });
    log('opening VB Studio\'s page ' + orgUrl.replace(/^https?:\/\/[^/]+/, '<host>'));
    st.ready = new Promise((resolve) => {
      const t0 = Date.now();
      let onVbs = 0, onSignIn = 0;
      const tick = setInterval(() => {
        if (win.isDestroyed()) { clearInterval(tick); resolve({ ok: false, error: 'VB Studio\'s page closed.' }); return; }
        const url = wc.getURL();
        let h = '';
        try { h = new URL(url).hostname.toLowerCase(); } catch (e) { h = ''; }
        const loading = wc.isLoading();
        const signIn = !!h && (h !== host || signInUrl.test(url));
        onVbs = h === host && !signIn && !loading ? (onVbs || Date.now()) : 0;
        onSignIn = signIn && !loading ? (onSignIn || Date.now()) : 0;
        // on VB Studio, loaded: its page given a moment to make its own calls (its sign-in seen)
        if (onVbs && (st.calls > 0 || st.token) && Date.now() - onVbs > 600) { clearInterval(tick); log('signed in: VB Studio\'s page is ready'); resolve({ ok: true }); return; }
        if (onVbs && Date.now() - onVbs > quietMs) { clearInterval(tick); log('VB Studio\'s page is ready (it made no call of its own yet)'); resolve({ ok: true }); return; }
        // the sign-in page, and it stays: not signed in
        if (onSignIn && Date.now() - onSignIn > signInMs) { clearInterval(tick); log('not signed in: the sign-in page'); resolve({ ok: false, signIn: true }); return; }
        if (Date.now() - t0 > readyMs) { clearInterval(tick); log('VB Studio\'s page did not open in time'); resolve({ ok: false, error: 'VB Studio\'s page did not open in time.' }); }
      }, 300);
    });
    win.loadURL(orgUrl).catch((e) => log('could not load: ' + e.message));
    return st;
  }

  async function fetchIn(url, init) {
    const u = new URL(url);
    if (!isHost(u.hostname)) throw new Error('Not VB Studio.');
    const org = u.pathname.split('/').filter(Boolean)[0] || '';
    const st = page(u.protocol + '//' + u.host.toLowerCase() + '/' + org + '/');
    if (st.idle) clearTimeout(st.idle);
    const ready = await st.ready;
    st.idle = setTimeout(() => { try { if (!st.win.isDestroyed()) st.win.destroy(); } catch (e) { /* gone */ } }, idleMs);
    if (!ready.ok) {
      if (ready.signIn) return { signIn: true };
      throw new Error(ready.error || 'VB Studio\'s page did not open.');
    }
    if (st.win.isDestroyed()) throw new Error('VB Studio\'s page closed.');
    const headers = Object.assign({ Accept: 'application/json' }, st.extra, (init && init.headers) || {}, st.token ? { Authorization: st.token } : {});
    const out = await st.win.webContents.executeJavaScript('fetch(' + JSON.stringify(url) + ', { credentials: "include", headers: ' + JSON.stringify(headers) + ' })'
      + '.then(function (r) { return r.text().then(function (t) { return { status: r.status, type: r.headers.get("content-type") || "", text: t }; }); },'
      + ' function (e) { return { status: 0, type: "", text: "", error: String((e && e.message) || e) }; })', true);
    if (out.error) throw new Error(out.error);
    return { ok: out.status >= 200 && out.status < 300, status: out.status, headers: { get: (k) => (/content-type/i.test(k) ? out.type : '') }, text: async () => out.text };
  }
  function close() { try { if (cur && !cur.win.isDestroyed()) cur.win.destroy(); } catch (e) { /* gone */ } cur = null; }

  return { fetch: fetchIn, close: close };
}

module.exports = { create };
