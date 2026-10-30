define([], function () {
  'use strict';

  /**
   * Who is the signed-in user? Resolved from BOTH identity sources, because the
   * app is reached two ways and only one of them is populated in each:
   *
   *   published inside Fusion  -> ?jwt=... on the URL, decoded for its `sub`
   *   dev / Designer preview   -> $application.user, populated by VB
   *
   * Neither alone is sufficient. $application.user comes back with empty
   * `login` and `userName` in this environment even while VB logs
   * "User john.dunbar is authenticated"; the JWT is absent on a direct nav, a
   * bookmark or in Designer. So both are consulted, JWT first.
   *
   * This is the SAME resolution loadFusionRolesChain has used since the RBAC
   * work — extracted here rather than copied, so the audit stamp on a Transfer
   * Order names the user by exactly the identity the roles were resolved for.
   * A second, drifting copy of this walk is the failure this module prevents.
   *
   * ── SECURITY BOUNDARY ──────────────────────────────────────────────────────
   * A JWT decoded client-side is an UNVERIFIED CLAIM. Nothing here proves
   * identity, and nothing may authorise on it. Its only consumer is the
   * X-User-Id audit stamp (RESERVED_BY, LAST_UPDATED_BY, HELD_BY) — a spoofed
   * value produces a misleading audit trail, never a privilege escalation.
   * The backend treats this header the same way. If either side ever needs to
   * TRUST the actor, this must move server-side and the token be verified.
   */

  // VB's identity object when nobody is signed in: VB logs "User is anonymous."
  // and fills fullName / userName with the literal 'anonymous'. The app does not
  // require authentication, so this is the normal state when the identity comes
  // from ?jwt= instead. Treated as no user, so its placeholder never becomes a
  // requestor name or an audit stamp.
  function vbUser(app) {
    const u = app && app.user;
    if (!u || u.isAuthenticated === false) return {};
    const id = String(u.userId || u.username || u.userName || '').trim().toLowerCase();
    return id === 'anonymous' ? {} : u;
  }

  // Decode a JWT payload. Never throws; null when absent or undecodable.
  //
  // atob handles base64; the -/_ swap converts base64url first. The
  // percent-decode round-trip is what makes non-ASCII usernames survive —
  // atob yields bytes, not characters.
  function jwtPayload(token) {
    if (!token || typeof token !== 'string') return null;
    try {
      const parts = token.split('.');
      if (parts.length < 2) return null;
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(
        atob(base64).split('').map(function (c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join('')
      );
      return JSON.parse(json);
    } catch (e) {
      console.warn('[currentUser] JWT payload could not be decoded — falling back to $application.user', e);
      return null;
    }
  }

  // The token's subject claim. `sub` is standard; preferred_username/upn are
  // accepted as fallbacks because IDCS does not always put the account name
  // in sub.
  function usernameFromJwt(token) {
    const payload = jwtPayload(token);
    if (!payload) return '';
    return String(payload.sub || payload.preferred_username || payload.upn || '').trim();
  }

  /**
   * A human name ("John Dunbar") for the signed-in user, or '' when no source
   * carries one. Unlike auditActor this never falls back to a username — the
   * caller decides what to show instead.
   *
   * Sources, first hit wins:
   *   JWT  user_displayname (IDCS), name, given_name + family_name (OIDC)
   *   VB   $application.user fullName / displayName
   *
   * Presentation only, same unverified-claim caveat as the rest of this file.
   *
   * @param {Object} context - an Action Chain / page module context
   * @returns {string}
   */
  function displayName(context) {
    try {
      const app = context && context.$application;
      if (!app) return '';
      const p = jwtPayload((app.variables && app.variables.jwt) || '') || {};
      const joined = [p.given_name, p.family_name].filter(Boolean).join(' ');
      const u = vbUser(app);
      const candidates = [p.user_displayname, p.name, joined, u.fullName, u.displayName];
      for (let i = 0; i < candidates.length; i++) {
        const v = candidates[i];
        if (v && typeof v === 'string' && v.trim()) return v.trim();
      }
    } catch (e) {
      console.warn('[currentUser] display name resolution failed', e);
    }
    return '';
  }

  // JWT sub wins when present: it is the account the token was actually issued
  // for, which is more specific than whatever VB happened to populate on the
  // identity object. Falls through the same candidate walk otherwise.
  function resolveUsername(user, rawName) {
    let name = (rawName && typeof rawName === 'string') ? rawName.trim() : '';

    const CANDIDATES = [
      'login', 'userName', 'username', 'userId', 'user_id',
      'preferred_username', 'sub', 'name', 'displayName', 'email'
    ];

    if (!name && user) {
      for (let i = 0; i < CANDIDATES.length && !name; i++) {
        const v = user[CANDIDATES[i]];
        if (v && typeof v === 'string' && v.trim()) name = v.trim();
      }
    }

    // Strip an email domain so JOHN.DUNBAR@… still reads as JOHN.DUNBAR, and
    // drop an IDCS tenancy prefix ('idcs-abc/JOHN.DUNBAR' -> 'JOHN.DUNBAR').
    // Both make the value match how usernames are stored elsewhere.
    const at = name.indexOf('@');
    if (at > 0) name = name.substring(0, at);
    name = String(name).trim();
    const slash = name.indexOf('/');
    if (name.indexOf('idcs-') === 0 && slash > -1) name = name.substring(slash + 1);

    return name;
  }

  /**
   * The actor for an audit stamp, from whichever source this session has.
   *
   * Returns '' when neither yields a name. Callers MUST treat that as "omit the
   * header" rather than substituting a placeholder: the backend already
   * defaults to 'SYSTEM', and sending our own 'UNKNOWN' would put a second
   * meaningless sentinel into the same column.
   *
   * @param {Object} context - an Action Chain / page module context
   * @returns {string} username, or ''
   */
  function auditActor(context) {
    try {
      const app = context && context.$application;
      if (!app) return '';
      const jwt = (app.variables && app.variables.jwt) || '';
      const who = resolveUsername(vbUser(app), usernameFromJwt(jwt));

      // DIAGNOSTIC — remove once identity is confirmed resolving in every
      // environment. A confirm run in Designer preview on 2026-09-07 stamped
      // RESERVED_BY='SYSTEM', meaning this returned ''. VB is known to leave
      // login/userName empty here while still reporting the user as
      // authenticated, so the name is somewhere on the object under a field
      // the CANDIDATES walk does not list. Dumping the keys is the only way to
      // find out WHICH — guessing more field names would be the same mistake
      // that produced the walk in the first place.
      if (!who) {
        const u = app.user || {};
        let keys = [];
        try { keys = Object.keys(u); } catch (e2) { keys = ['<unreadable>']; }
        console.warn('[currentUser] no actor resolved — X-User-Id will be omitted ' +
                     'and the backend will stamp SYSTEM. jwt present: ' + (jwt ? 'yes' : 'no') +
                     '. $application.user keys: ' + JSON.stringify(keys));
      }
      return who;
    } catch (e) {
      console.warn('[currentUser] actor resolution failed — stamp will fall back to SYSTEM', e);
      return '';
    }
  }

  /**
   * Header object for a REST call, ready to spread into callRest.
   * Empty when no actor resolves, so the header is simply absent.
   *
   * Usage:
   *   Actions.callRest(context, { endpoint: '…', headers: cu.auditHeaders(context), … })
   */
  function auditHeaders(context) {
    const who = auditActor(context);
    return who ? { 'X-User-Id': who } : {};
  }

  return {
    usernameFromJwt: usernameFromJwt,
    displayName:     displayName,
    resolveUsername: resolveUsername,
    vbUser:          vbUser,
    auditActor:      auditActor,
    auditHeaders:    auditHeaders
  };
});
