'use strict';

/**
 * Who the desktop client signs in as, and how that is kept between starts.
 *
 * Saved as local-identity.json in Electron's userData folder (%APPDATA%\EquipRite on Windows): outside the
 * project, so it is never committed and never copied into build/processed by Oracle's build. The Fusion password
 * is stored only encrypted with Electron safeStorage (DPAPI on Windows, Keychain on macOS); where that is not
 * available it is kept for this run only.
 *
 * Plain Node; encrypt/decrypt are passed in, so npm test can check it without Electron.
 */
const fs = require('fs');

/** Which app the window opens: 'old' (webApps/vbredwoodapp, unchanged) or 'new' (webApps/equiprite, the redesign). */
const VERSIONS = ['old', 'new'];
const versionOf = (v) => (VERSIONS.includes(v) ? v : 'old');

/**
 * Checks the sign-in form. Returns { error } or { saved, password } where saved is what goes to disk (no password).
 * form: { version: 'old'|'new', username, rolesFrom: 'fusion'|'pick', roles: string[], otherRoles, fusionUser,
 *         fusionPassword }
 */
function validate(form, previous) {
  const f = form || {};
  const username = String(f.username || '').trim();
  if (!username) {
    return { error: 'Enter the Fusion username to sign in as.' };
  }
  const roles = [...(Array.isArray(f.roles) ? f.roles : []), ...String(f.otherRoles || '').split(/[,\s]+/)]
    .map((r) => String(r).trim().toUpperCase())
    .filter((r, i, all) => r && all.indexOf(r) === i);
  const rolesFrom = f.rolesFrom === 'pick' ? 'pick' : 'fusion';
  const fusionUser = String(f.fusionUser || '').trim() || username;
  const password = String(f.fusionPassword || '');
  const keepsPassword = !password && previous && previous.fusionUser === fusionUser && !!previous.fusionPassword;
  if (rolesFrom === 'pick' && !roles.length) {
    return { error: 'Tick at least one role, or read roles from Fusion.' };
  }
  if (rolesFrom === 'fusion' && !password && !keepsPassword) {
    return { error: 'Enter the Fusion password: roles are read from the ROLES_RP report in Fusion.' };
  }
  return {
    saved: { username, rolesFrom, roles: rolesFrom === 'pick' ? roles : [], fusionUser, version: versionOf(f.version) },
    password: password || null,
    keepsPassword,
  };
}

/** Reads the saved sign-in, or null. */
function load(file) {
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    return saved && saved.username ? saved : null;
  } catch {
    return null;
  }
}

/** Writes the sign-in; the password only as encrypt(password) in base64, or not at all when encrypt is null. */
function save(file, saved, password, encrypt, previous) {
  const out = Object.assign({}, saved);
  if (password && encrypt) {
    out.fusionPassword = encrypt(password).toString('base64');
  } else if (!password && previous && previous.fusionUser === saved.fusionUser && previous.fusionPassword) {
    out.fusionPassword = previous.fusionPassword;
  }
  fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');
  return out;
}

/** The identity the local server uses: username, roles (only when picked), Fusion login (when there is a password). */
function toServerIdentity(saved, password, decrypt) {
  if (!saved || !saved.username) {
    return null;
  }
  let pw = password || null;
  if (!pw && saved.fusionPassword && decrypt) {
    try {
      pw = decrypt(Buffer.from(saved.fusionPassword, 'base64'));
    } catch {
      pw = null;
    }
  }
  return {
    username: saved.username,
    roles: saved.rolesFrom === 'pick' && saved.roles && saved.roles.length ? saved.roles : null,
    fusion: pw ? { user: saved.fusionUser || saved.username, password: pw } : null,
  };
}

/** True when the saved sign-in can be used as-is (reading roles from Fusion needs a password we can decrypt). */
function usable(identity, saved) {
  return !!identity && (saved.rolesFrom === 'pick' || !!identity.fusion);
}

/** Forgets the saved sign-in (File → Sign out). */
function remove(file) {
  fs.rmSync(file, { force: true });
}

/** Remembers which app to open (File → Open Old / New EquipRite) without touching the rest of the sign-in. */
function saveVersion(file, version) {
  const saved = load(file);
  if (saved) {
    fs.writeFileSync(file, JSON.stringify(Object.assign({}, saved, { version: versionOf(version) }), null, 2), 'utf8');
  }
}

module.exports = { validate, load, save, remove, saveVersion, versionOf, toServerIdentity, usable };
