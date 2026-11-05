'use strict';
/**
 * Connect Jira, for the Jira stories page in Old EquipRite and EquipRite Next: the Jira site, a Jira user's email and
 * an Atlassian API token, kept in this app's data folder (the token encrypted by the OS keychain; when the keychain
 * cannot encrypt, only for this run). The desktop app adds them to the calls the page makes to the `jira` backend
 * (services/jira through /__backend/jira): the page never holds the token, and it is never sent back to it.
 *
 *   open({ file, encrypt, decrypt }) → store
 *   settings()                 { site, email, hasToken, connected }, never the token
 *   save({ site, email, token })  an empty token keeps the saved one
 *   forget()                   the email and token removed
 *   auth()                     { site, header: 'Basic …' } for the proxy, or null when not connected
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_SITE = 'https://equiprite.atlassian.net';

/** "equiprite", "equiprite.atlassian.net" or a URL → "https://equiprite.atlassian.net"; '' when it is not a Jira Cloud site. */
function normaliseSite(v) {
  let s = String(v || '').trim();
  if (!s) return DEFAULT_SITE;
  if (/^[a-z0-9-]+$/i.test(s)) s = `${s}.atlassian.net`;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' || !/\.(atlassian\.net|jira\.com)$/i.test(u.hostname)) return '';
    return `https://${u.hostname.toLowerCase()}`;
  } catch {
    return '';
  }
}

function open(o) {
  const file = o.file;
  const encrypt = o.encrypt || null;
  const decrypt = o.decrypt || null;
  let memToken = null; // when the keychain cannot encrypt
  let saved = { site: DEFAULT_SITE, email: '', token: '' };
  try {
    saved = Object.assign(saved, JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch { /* first run */ }

  const write = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(saved, null, 2), { mode: 0o600 });
  };
  const token = () => {
    if (memToken) return memToken;
    if (!saved.token || !decrypt) return '';
    try { return decrypt(Buffer.from(saved.token, 'base64')); } catch { return ''; }
  };
  const settings = () => {
    const has = !!token();
    return { site: saved.site || DEFAULT_SITE, email: saved.email || '', hasToken: has, connected: has && !!saved.email, keychain: !!encrypt };
  };

  return {
    settings,
    save(b) {
      const site = normaliseSite(b && b.site);
      if (!site) throw new Error('That is not a Jira Cloud address (https://<your-site>.atlassian.net).');
      const email = String((b && b.email) || '').trim();
      if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error('Enter the email you sign in to Jira with.');
      saved.site = site;
      saved.email = email;
      const t = String((b && b.token) || '').trim();
      if (t) {
        if (encrypt) { saved.token = encrypt(t).toString('base64'); memToken = null; } else { saved.token = ''; memToken = t; }
      }
      write();
      return settings();
    },
    forget() {
      saved = { site: saved.site || DEFAULT_SITE, email: '', token: '' };
      memToken = null;
      write();
      return settings();
    },
    auth() {
      const t = token();
      if (!t || !saved.email) return null;
      return { site: saved.site || DEFAULT_SITE, header: `Basic ${Buffer.from(`${saved.email}:${t}`).toString('base64')}` };
    },
  };
}

module.exports = { open, normaliseSite, DEFAULT_SITE };
