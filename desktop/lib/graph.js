'use strict';
/**
 * Microsoft 365 (Microsoft Graph) for the Minutes page: the user's directory/contacts (like Outlook's "Suggested
 * contacts") and sending the minutes email — for PCs where Outlook COM is not available (the new Outlook has none).
 *
 * Sign-in uses the OAuth 2.0 device-code flow (no redirect URI, no client secret — a public client): the app shows a
 * code, the user signs in at microsoft.com/devicelogin in their browser, and we poll for the token. Tokens are kept
 * encrypted on this PC (refresh token reused silently); the Tenant ID and Client ID (not secrets) are stored in plain.
 *
 *   open({ file, encrypt, decrypt, fetch, openExternal }) → store
 *   status()                 { configured, signedIn, account, tenantId, clientId, pending, userCode, verificationUri, error }
 *   saveConfig({ tenantId, clientId })
 *   beginSignIn()            starts device-code sign-in: { ok, userCode, verificationUri, message } (poll status())
 *   signOut()
 *   people(q)                { ok, directory, contacts:[{name,email}] } — /me/people (relevant) + /me/contacts (saved),
 *                            both base-scope; plus /users (whole directory) only when the directory option is on
 *                            (needs User.ReadBasic.All + admin consent); directory=true only when /users succeeded
 *   sendMail({to,subject,html}) → { ok } via /me/sendMail
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AUTHORITY = 'https://login.microsoftonline.com';
const GRAPH = 'https://graph.microsoft.com/v1.0';
// Redirect for the in-app popup sign-in (auth-code + PKCE). The native-client URL needs no local server: the popup
// lands on it with ?code=… and we read the code from the URL. Register it on the app (Mobile & desktop applications).
const REDIRECT = 'https://login.microsoftonline.com/common/oauth2/nativeclient';
// BASE_SCOPE always works (sign-in, send, relevant people). SCOPE adds User.ReadBasic.All so the whole-company
// directory (/users) can be searched; when that permission is not on the app registration / not consented, sign-in and
// token refresh fall back to BASE_SCOPE so nothing breaks — the directory simply stays unavailable until IT grants it.
const BASE_SCOPE = 'offline_access openid profile User.Read People.Read Contacts.Read Mail.Send';
const SCOPE = BASE_SCOPE + ' User.ReadBasic.All';
const SCOPE_ERR = /scope|consent|AADSTS70011|AADSTS65001|AADSTS90008/i;
// The tenant requires an administrator to approve the app (user consent is disabled), e.g. the "Approval required" page.
const ADMIN_CONSENT = /AADSTS65004|AADSTS90094|AADSTS9008\d|admin[^.]{0,30}(approv|consent)|consent_required|requires? (admin )?approval/i;
const ADMIN_CONSENT_MSG = 'Microsoft 365 needs an administrator to approve the Equip_Rite app before you can sign in. Ask an admin to "Grant admin consent" for it in Azure, then sign in again.';

function qs(o) { return Object.keys(o).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(o[k])).join('&'); }

function open(o) {
  o = o || {};
  const file = o.file;
  const encrypt = o.encrypt || null;
  const decrypt = o.decrypt || null;
  const doFetch = o.fetch || (typeof fetch === 'function' ? fetch : null);
  const openExternal = o.openExternal || (() => {});
  const interactiveAuth = o.interactiveAuth || null; // (authUrl, redirectUri) -> { code } | { error } (a popup window)

  let data = { tenantId: '', clientId: '', account: '', directory: false, tokens: null };
  try { data = Object.assign(data, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) { /* first run */ }
  // Sign in with only the scopes the app is granted by default (base). The whole-company directory (User.ReadBasic.All)
  // is opt-in, because asking for it where it is not consented makes the tenant force "admin approval" and blocks sign-in.
  function scopeNow() { return data.directory ? SCOPE : BASE_SCOPE; }
  let pending = null; // { userCode, verificationUri, error, done } while a device-code sign-in is in progress

  function write() { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 1), { mode: 0o600 }); }
  // Encrypt the token at rest when the OS secure store is available; if it is not (encrypt throws, e.g. Windows
  // credential store unavailable) keep the token in the 0600 file rather than dropping it — otherwise a real sign-in
  // would be stored as null and the app would wrongly show "not signed in".
  function seal(t) { if (!t || !encrypt) return t || null; try { return 'enc:' + encrypt(t).toString('base64'); } catch (e) { return t; } }
  function unseal(t) { if (!t) return ''; if (!/^enc:/.test(t)) return t; if (!decrypt) return ''; try { return decrypt(Buffer.from(t.slice(4), 'base64')); } catch (e) { return ''; } }

  async function httpForm(url, form) {
    const r = await doFetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: qs(form) });
    const t = await r.text();
    let j = {}; try { j = t ? JSON.parse(t) : {}; } catch (e) { j = { error: 'bad_response', error_description: t.slice(0, 200) }; }
    return { status: r.status, body: j };
  }
  async function graph(method, pathq, token, body) {
    const r = await doFetch(GRAPH + pathq, { method: method, headers: Object.assign({ authorization: 'Bearer ' + token }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    const t = await r.text();
    let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
    return { status: r.status, body: j, text: t };
  }

  function storeTokens(tok) {
    data.tokens = { access: seal(tok.access_token), refresh: seal(tok.refresh_token), expiresAt: Date.now() + (Number(tok.expires_in || 3600) - 60) * 1000 };
    write();
  }

  async function token() {
    const t = data.tokens;
    if (!t) return '';
    if (t.access && t.expiresAt > Date.now()) return unseal(t.access);
    const refresh = unseal(t.refresh);
    if (!refresh) return '';
    const url = AUTHORITY + '/' + encodeURIComponent(data.tenantId || 'common') + '/oauth2/v2.0/token';
    const ok = (r) => r.status >= 200 && r.status < 300 && r.body.access_token;
    let res = await httpForm(url, { grant_type: 'refresh_token', client_id: data.clientId, refresh_token: refresh, scope: scopeNow() });
    // The refresh token was issued for whatever scopes were consented; asking for the directory scope on top can be
    // rejected — fall back to the base scopes so the session keeps working.
    if (!ok(res)) res = await httpForm(url, { grant_type: 'refresh_token', client_id: data.clientId, refresh_token: refresh, scope: BASE_SCOPE });
    if (ok(res)) { storeTokens(res.body); return res.body.access_token; }
    return '';
  }

  function status() {
    // Signed in when we hold a refresh token (a durable session) OR an access token that has not yet expired — so a
    // sign-in that returned no refresh token (offline_access withheld) still counts while the access token is valid.
    const signedIn = !!(data.tokens && (data.tokens.refresh || (data.tokens.access && data.tokens.expiresAt > Date.now())));
    return { configured: !!(data.tenantId && data.clientId), signedIn: signedIn, account: data.account || '', directory: !!data.directory,
      tenantId: data.tenantId || '', clientId: data.clientId || '', pending: !!(pending && !pending.done),
      userCode: pending ? pending.userCode : '', verificationUri: pending ? pending.verificationUri : '', error: pending ? pending.error || '' : '',
      // Diagnostics so the UI can explain "signed in on the web but not here": whether a token was stored, whether it
      // is still valid, and whether the OS secure store is in use for it.
      hasToken: !!(data.tokens && (data.tokens.access || data.tokens.refresh)), hasRefresh: !!(data.tokens && data.tokens.refresh),
      tokenValid: !!(data.tokens && data.tokens.access && data.tokens.expiresAt > Date.now()), encrypted: !!encrypt };
  }

  return {
    status,
    saveConfig(b) {
      b = b || {};
      if (b.tenantId !== undefined) data.tenantId = String(b.tenantId).trim();
      if (b.clientId !== undefined) data.clientId = String(b.clientId).trim();
      if (b.directory !== undefined) data.directory = !!b.directory;
      write();
      return status();
    },
    signOut() { data.tokens = null; data.account = ''; pending = null; write(); return status(); },
    async beginSignIn() {
      if (!data.tenantId || !data.clientId) return { ok: false, error: 'Enter your Microsoft 365 Tenant ID and Client ID first.' };
      if (!doFetch) return { ok: false, error: 'Sign-in is not available in this app.' };
      const dcUrl = AUTHORITY + '/' + encodeURIComponent(data.tenantId) + '/oauth2/v2.0/devicecode';
      let res = await httpForm(dcUrl, { client_id: data.clientId, scope: scopeNow() });
      // If the directory scope isn't on the app registration / can't be consented, retry without it so sign-in works.
      if ((res.status >= 400 || !res.body.device_code) && SCOPE_ERR.test(JSON.stringify(res.body || {}))) res = await httpForm(dcUrl, { client_id: data.clientId, scope: BASE_SCOPE });
      if (res.status >= 400 || !res.body.device_code) return { ok: false, error: (res.body.error_description || res.body.error || 'Could not start sign-in.') };
      const dc = res.body;
      pending = { userCode: dc.user_code, verificationUri: dc.verification_uri, deviceCode: dc.device_code, error: '', done: false };
      try { openExternal(dc.verification_uri); } catch (e) { /* user can open it manually */ }
      // Poll for the token in the background; status() reports progress.
      const deadline = Date.now() + (Number(dc.expires_in || 900) * 1000);
      let interval = Math.max(2, Number(dc.interval || 5)) * 1000;
      const poll = async () => {
        if (!pending || pending.done) return;
        if (Date.now() > deadline) { pending.error = 'Sign-in timed out — if your organisation needs an admin to approve the Equip_Rite app, ask them to grant consent, then try again.'; pending.done = true; return; }
        const r = await httpForm(AUTHORITY + '/' + encodeURIComponent(data.tenantId) + '/oauth2/v2.0/token',
          { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: data.clientId, device_code: dc.device_code });
        if (r.body.access_token) {
          storeTokens(r.body);
          try { const me = await graph('GET', '/me', r.body.access_token); data.account = (me.body && (me.body.userPrincipalName || me.body.mail)) || ''; write(); } catch (e) { /* account optional */ }
          pending.done = true; return;
        }
        const err = r.body.error;
        if (err === 'authorization_pending') { setTimeout(poll, interval); return; }
        if (err === 'slow_down') { interval += 5000; setTimeout(poll, interval); return; }
        pending.error = ADMIN_CONSENT.test(JSON.stringify(r.body || {})) ? ADMIN_CONSENT_MSG : (r.body.error_description || err || 'Sign-in failed.'); pending.done = true;
      };
      setTimeout(poll, interval);
      return { ok: true, userCode: dc.user_code, verificationUri: dc.verification_uri, message: dc.message || ('Open ' + dc.verification_uri + ' and enter code ' + dc.user_code) };
    },
    // One immediate token poll with the active device-code — for the "check now" button, so a just-completed web sign-in
    // is picked up at once, even if the background poll loop has stopped or missed it.
    async graphPoll() {
      if (status().signedIn) return status();
      if (!pending || !pending.deviceCode) return status();
      let r;
      try {
        r = await httpForm(AUTHORITY + '/' + encodeURIComponent(data.tenantId) + '/oauth2/v2.0/token',
          { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: data.clientId, device_code: pending.deviceCode });
      } catch (e) { return status(); }
      if (r.body && r.body.access_token) {
        storeTokens(r.body);
        try { const me = await graph('GET', '/me', r.body.access_token); data.account = (me.body && (me.body.userPrincipalName || me.body.mail)) || ''; write(); } catch (e) { /* account optional */ }
        pending.done = true;
      } else if (r.body && r.body.error && r.body.error !== 'authorization_pending' && r.body.error !== 'slow_down') {
        pending.error = ADMIN_CONSENT.test(JSON.stringify(r.body || {})) ? ADMIN_CONSENT_MSG : (r.body.error_description || r.body.error || 'Sign-in failed.'); pending.done = true;
      }
      return status();
    },
    // In-app popup sign-in (authorization code + PKCE): opens the Microsoft page in a window and captures the code from
    // the redirect, then exchanges it for a token. No device code to type, no background polling.
    async signInInteractive() {
      if (!data.tenantId || !data.clientId) return { ok: false, error: 'Enter your Microsoft 365 Tenant ID and Client ID first.' };
      if (!interactiveAuth) return { ok: false, error: 'In-app sign-in is not available in this app.' };
      const verifier = crypto.randomBytes(32).toString('base64url');
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      const authUrl = AUTHORITY + '/' + encodeURIComponent(data.tenantId) + '/oauth2/v2.0/authorize?' + qs({
        client_id: data.clientId, response_type: 'code', redirect_uri: REDIRECT, response_mode: 'query', scope: scopeNow(),
        code_challenge: challenge, code_challenge_method: 'S256', state: crypto.randomBytes(8).toString('hex'), prompt: 'select_account' });
      let res;
      try { res = await interactiveAuth(authUrl, REDIRECT); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
      if (!res || !res.code) return { ok: false, error: (res && res.error) || 'Sign-in did not complete.' };
      const tr = await httpForm(AUTHORITY + '/' + encodeURIComponent(data.tenantId) + '/oauth2/v2.0/token',
        { grant_type: 'authorization_code', client_id: data.clientId, code: res.code, redirect_uri: REDIRECT, code_verifier: verifier, scope: scopeNow() });
      if (!(tr.status >= 200 && tr.status < 300 && tr.body && tr.body.access_token)) {
        const b = tr.body || {};
        return { ok: false, error: ADMIN_CONSENT.test(JSON.stringify(b)) ? ADMIN_CONSENT_MSG : (b.error_description || b.error || 'Could not get a token.') };
      }
      storeTokens(tr.body);
      try { const me = await graph('GET', '/me', tr.body.access_token); data.account = (me.body && (me.body.userPrincipalName || me.body.mail)) || ''; write(); } catch (e) { /* account optional */ }
      pending = null;
      return { ok: true, status: status() };
    },
    async people(q) {
      const t = await token();
      if (!t) return { ok: false, available: !!(data.tenantId && data.clientId), contacts: [], error: 'Not signed in to Microsoft 365.' };
      const term = String(q || '').trim();
      const out = [];
      const seen = {};
      const add = (name, email) => { const k = String(email || '').toLowerCase(); if (email && !seen[k]) { seen[k] = true; out.push({ name: name || email, email: email }); } };
      let err = '';
      let directory = false; // whether the org-wide directory (/users) could be read — needs User.ReadBasic.All
      // Relevant people (like Outlook's suggested contacts): the people this user works with.
      try {
        const r = term
          ? await graph('GET', '/me/people?$search=' + encodeURIComponent('"' + term + '"') + '&$top=15&$select=displayName,scoredEmailAddresses,userPrincipalName', t)
          : await graph('GET', '/me/people?$top=25&$select=displayName,scoredEmailAddresses,userPrincipalName', t);
        if (r.status < 400) { err = ''; ((r.body && r.body.value) || []).forEach((p) => add(p.displayName, (p.scoredEmailAddresses && p.scoredEmailAddresses[0] && p.scoredEmailAddresses[0].address) || p.userPrincipalName)); }
        else err = (r.body && r.body.error && r.body.error.message) || ('Graph HTTP ' + r.status);
      } catch (e) { err = String((e && e.message) || e); }
      // The user's own saved contacts (Contacts.Read — granted with the base scopes, no admin consent needed).
      try {
        const r3 = await graph('GET', '/me/contacts?$top=100&$select=displayName,emailAddresses', t);
        if (r3.status < 400) { err = ''; ((r3.body && r3.body.value) || []).forEach((c) => add(c.displayName, (c.emailAddresses && c.emailAddresses[0] && c.emailAddresses[0].address) || '')); }
      } catch (e) { /* contacts optional */ }
      // The whole organisation directory (needs User.ReadBasic.All with admin consent). Only when the option is on, so we
      // never force the admin-approval prompt on a plain sign-in.
      if (data.directory) {
        try {
          const esc = term.replace(/'/g, "''");
          const dir = term
            ? "/users?$filter=" + encodeURIComponent("startswith(displayName,'" + esc + "') or startswith(mail,'" + esc + "') or startswith(userPrincipalName,'" + esc + "')") + "&$top=15&$select=displayName,mail,userPrincipalName"
            : '/users?$top=25&$select=displayName,mail,userPrincipalName';
          const r2 = await graph('GET', dir, t);
          if (r2.status < 400) { directory = true; ((r2.body && r2.body.value) || []).forEach((p) => add(p.displayName, p.mail || p.userPrincipalName)); }
        } catch (e) { /* no directory permission — relevant people + contacts only */ }
      }
      if (!out.length && err) return { ok: false, available: true, directory: directory, contacts: [], error: err };
      return { ok: true, available: true, directory: directory, contacts: out };
    },
    async sendMail(b) {
      const t = await token();
      if (!t) return { ok: false, error: 'Not signed in to Microsoft 365.' };
      b = b || {};
      const addrs = (v) => String(v || '').split(/[;,]/).map((s) => s.trim()).filter(Boolean).map((a) => ({ emailAddress: { address: a } }));
      const to = addrs(b.to);
      const cc = addrs(b.cc);
      const message = { subject: String(b.subject || ''), body: { contentType: 'HTML', content: String(b.html || '') }, toRecipients: to };
      if (cc.length) message.ccRecipients = cc;
      const msg = { message: message, saveToSentItems: true };
      try {
        const r = await graph('POST', '/me/sendMail', t, msg);
        if (r.status >= 200 && r.status < 300) return { ok: true };
        return { ok: false, error: (r.body && r.body.error && r.body.error.message) || ('Graph HTTP ' + r.status) };
      } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    },
    _token: token,
  };
}

module.exports = { open };
