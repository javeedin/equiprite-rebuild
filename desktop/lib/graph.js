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
 *   people(q)                { ok, contacts:[{name,email}] } from /me/people (falls back to /me/contacts)
 *   sendMail({to,subject,html}) → { ok } via /me/sendMail
 */
const fs = require('fs');
const path = require('path');

const AUTHORITY = 'https://login.microsoftonline.com';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPE = 'offline_access openid profile User.Read People.Read Contacts.Read Mail.Send';

function qs(o) { return Object.keys(o).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(o[k])).join('&'); }

function open(o) {
  o = o || {};
  const file = o.file;
  const encrypt = o.encrypt || null;
  const decrypt = o.decrypt || null;
  const doFetch = o.fetch || (typeof fetch === 'function' ? fetch : null);
  const openExternal = o.openExternal || (() => {});

  let data = { tenantId: '', clientId: '', account: '', tokens: null };
  try { data = Object.assign(data, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) { /* first run */ }
  let pending = null; // { userCode, verificationUri, error, done } while a device-code sign-in is in progress

  function write() { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 1), { mode: 0o600 }); }
  function seal(t) { if (!t || !encrypt) return t || null; try { return 'enc:' + encrypt(t).toString('base64'); } catch (e) { return null; } }
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
    const res = await httpForm(AUTHORITY + '/' + encodeURIComponent(data.tenantId || 'common') + '/oauth2/v2.0/token',
      { grant_type: 'refresh_token', client_id: data.clientId, refresh_token: refresh, scope: SCOPE });
    if (res.status >= 200 && res.status < 300 && res.body.access_token) { storeTokens(res.body); return res.body.access_token; }
    return '';
  }

  function status() {
    return { configured: !!(data.tenantId && data.clientId), signedIn: !!(data.tokens && data.tokens.refresh), account: data.account || '',
      tenantId: data.tenantId || '', clientId: data.clientId || '', pending: !!(pending && !pending.done),
      userCode: pending ? pending.userCode : '', verificationUri: pending ? pending.verificationUri : '', error: pending ? pending.error || '' : '' };
  }

  return {
    status,
    saveConfig(b) {
      b = b || {};
      if (b.tenantId !== undefined) data.tenantId = String(b.tenantId).trim();
      if (b.clientId !== undefined) data.clientId = String(b.clientId).trim();
      write();
      return status();
    },
    signOut() { data.tokens = null; data.account = ''; pending = null; write(); return status(); },
    async beginSignIn() {
      if (!data.tenantId || !data.clientId) return { ok: false, error: 'Enter your Microsoft 365 Tenant ID and Client ID first.' };
      if (!doFetch) return { ok: false, error: 'Sign-in is not available in this app.' };
      const res = await httpForm(AUTHORITY + '/' + encodeURIComponent(data.tenantId) + '/oauth2/v2.0/devicecode', { client_id: data.clientId, scope: SCOPE });
      if (res.status >= 400 || !res.body.device_code) return { ok: false, error: (res.body.error_description || res.body.error || 'Could not start sign-in.') };
      const dc = res.body;
      pending = { userCode: dc.user_code, verificationUri: dc.verification_uri, error: '', done: false };
      try { openExternal(dc.verification_uri); } catch (e) { /* user can open it manually */ }
      // Poll for the token in the background; status() reports progress.
      const deadline = Date.now() + (Number(dc.expires_in || 900) * 1000);
      let interval = Math.max(2, Number(dc.interval || 5)) * 1000;
      const poll = async () => {
        if (!pending || pending.done) return;
        if (Date.now() > deadline) { pending.error = 'Sign-in timed out. Try again.'; pending.done = true; return; }
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
        pending.error = r.body.error_description || err || 'Sign-in failed.'; pending.done = true;
      };
      setTimeout(poll, interval);
      return { ok: true, userCode: dc.user_code, verificationUri: dc.verification_uri, message: dc.message || ('Open ' + dc.verification_uri + ' and enter code ' + dc.user_code) };
    },
    async people(q) {
      const t = await token();
      if (!t) return { ok: false, available: !!(data.tenantId && data.clientId), contacts: [], error: 'Not signed in to Microsoft 365.' };
      const term = String(q || '').trim();
      try {
        const r = term
          ? await graph('GET', '/me/people?$search=' + encodeURIComponent('"' + term + '"') + '&$top=15&$select=displayName,scoredEmailAddresses,userPrincipalName', t)
          : await graph('GET', '/me/people?$top=25&$select=displayName,scoredEmailAddresses,userPrincipalName', t);
        if (r.status >= 400) return { ok: false, available: true, contacts: [], error: (r.body && r.body.error && r.body.error.message) || ('Graph HTTP ' + r.status) };
        const out = ((r.body && r.body.value) || []).map((p) => {
          const email = (p.scoredEmailAddresses && p.scoredEmailAddresses[0] && p.scoredEmailAddresses[0].address) || p.userPrincipalName || '';
          return { name: p.displayName || email, email: email };
        }).filter((p) => p.email);
        return { ok: true, available: true, contacts: out };
      } catch (e) { return { ok: false, available: true, contacts: [], error: String((e && e.message) || e) }; }
    },
    async sendMail(b) {
      const t = await token();
      if (!t) return { ok: false, error: 'Not signed in to Microsoft 365.' };
      b = b || {};
      const to = String(b.to || '').split(/[;,]/).map((s) => s.trim()).filter(Boolean).map((a) => ({ emailAddress: { address: a } }));
      const msg = { message: { subject: String(b.subject || ''), body: { contentType: 'HTML', content: String(b.html || '') }, toRecipients: to }, saveToSentItems: true };
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
