define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // App-level page RBAC loader. Runs once on app vbEnter alongside
  // loadFeatureFlagsChain.
  //
  // Resolves the signed-in user's Fusion/IDCS job role(s) from the reserved
  // $application.user variable (NOT a hand-rolled fetch to _currentuser — that
  // path differs between local dev, Designer preview and a deployed app, and
  // fails differently in each), then asks the backend which pages that role may
  // see. The result lands in:
  //   $application.variables.pageAccessMap  { PAGE_CODE: 'FULL'|'READ_ONLY'|'HIDDEN' }
  //   $application.variables.pageAccessLoaded  latch, set LAST
  //
  // Both the nav-menu filter (visibleNavGroups) and the page-entry guard
  // (pageAccess) read that one map, so the menu and the guards can never
  // disagree about what a role may open.
  //
  // FAILS CLOSED at every step: no user, no recognised role, a failed call or a
  // malformed payload all leave the map empty, and an empty map resolves every
  // page to HIDDEN. This is the UX layer only — the backend must independently
  // reject requests for pages the caller may not see.
  //
  // The latch is set however the chain ends (see finally). It used to stay
  // false on every failure path, which read as "still loading" — and
  // canEnterPage ADMITS while loading, so a user with no role could open any
  // page by URL or through the Dashboard's View All. Settled-and-empty is what
  // sends them to the No Access page instead.

  // Roles are NOT filtered client-side. COMMONRITE.RBAC_ROLE_MAP is the single
  // authority on which Fusion job role maps to which EquipRite app role, and
  // the backend returns {} for anything it does not recognise. Sending the
  // user's full role list means adding a third app role later is a ROLE_MAP
  // insert with no frontend change — which is the whole point of table-driven
  // RBAC. (An earlier version filtered against a hard-coded allow-list here;
  // that silently skipped the call whenever the identity provider surfaced a
  // different role vocabulary.)
  //
  // Only obvious non-Fusion noise is dropped, to keep the query string sane.
  // VB Studio's Designer preview authenticates with the developer's STUDIO
  // account, so $application.user.roles there is ~42 platform roles
  // (GIT_READ, BUILD_EXEC, APPROLE.*, ROLE_ADMIN …) and contains no Fusion job
  // role at all. Those are excluded by prefix rather than by allow-list.
  const NON_FUSION_PREFIXES = ['APPROLE.', 'ROLE_'];
  const NON_FUSION_EXACT = {
    ENV_DEFN_WRITE: 1, ENV_DEFN_READ: 1, ENV_RUNT_READ: 1, ENV_DEFN_WRITE_ANY: 1,
    BUILD_READ: 1, BUILD_WRITE: 1, BUILD_EXEC: 1, PROJECT_ADMIN: 1,
    SNIPPET_READ: 1, SNIPPET_WRITE: 1, NPM_READ: 1, NPM_WRITE: 1,
    GIT_READ: 1, GIT_WRITE: 1, GIT_ADMIN: 1, WIKI_READ: 1, WIKI_WRITE: 1,
    WIKI_COMMENT: 1, RELEASE_READ: 1, RELEASE_WRITE: 1, AGILE_READ: 1,
    AGILE_WRITE: 1, AGILE_ADMIN: 1, SPRINT_REPORTS: 1, MVN_READ: 1,
    MVN_WRITE: 1, MR_READ: 1, MR_WRITE: 1, MR_ADMIN: 1, MR_COMMENT: 1,
    ISSUE_READ: 1, ISSUE_WRITE: 1, DOCKER_READ: 1, DOCKER_WRITE: 1
  };

  /**
   * True for roles that cannot possibly be Fusion job roles (VB Studio
   * platform roles). Keeps the outbound query string short; it is NOT a
   * security decision — the backend authorises, this only reduces noise.
   */
  function isNonFusionRole(role) {
    if (NON_FUSION_EXACT[role]) {
      return true;
    }
    return NON_FUSION_PREFIXES.some(function (p) {
      return role.indexOf(p) === 0;
    });
  }

  const VALID_LEVELS = { FULL: 1, READ_ONLY: 1, HIDDEN: 1 };

  /**
   * Pulls job-role codes out of $application.user.roles.
   *
   * Identity providers disagree on the shape here, so all three known forms are
   * handled: an array of strings, an array of objects with a name/role field,
   * and the object-map form ({ RoleName: true }) that the VB role-mapping.json
   * mechanism produces. Anything else yields [] and the caller fails closed.
   *
   * @param {Object} user - $application.user
   * @returns {string[]} upper-cased role codes (possibly empty)
   */
  function extractRoles(user) {
    if (!user || !user.roles) {
      return [];
    }
    const roles = user.roles;
    const out = [];

    if (Array.isArray(roles)) {
      roles.forEach(function (r) {
        if (typeof r === 'string') {
          out.push(r);
        } else if (r && typeof r === 'object') {
          const v = r.name || r.roleName || r.role || r.code;
          if (v) out.push(String(v));
        }
      });
    } else if (typeof roles === 'object') {
      // { RoleName: true } — keep only the truthy ones.
      Object.keys(roles).forEach(function (k) {
        if (roles[k]) out.push(k);
      });
    }

    return out.map(function (s) { return String(s).trim().toUpperCase(); })
      .filter(Boolean);
  }

  /**
   * Resolves the user's SESSION_ROLE codes (EQUIP_MGR, REQUESTOR, ...) from
   * GET /rbac/session-roles into $application.variables.sessionRoles, ordered
   * by RBAC_ROLE_MAP priority, lower first.
   *
   * This is what lets the dashboard persona and the manager-tier checks follow
   * the DB map instead of the hard-coded RT_EQP_* list in app-flow.js, so a
   * customer whose Fusion roles are named differently (OII_RT_EQP_MANAGER_JR)
   * needs only RBAC_ROLE_MAP rows.
   *
   * Runs alongside the page-access call and NEVER affects it: any failure
   * (including a 404 from a backend that predates the endpoint) leaves
   * sessionRoles empty, and the role functions fall back to the hard-coded map.
   * sessionRolesLoaded is a SETTLED latch, set however this ends, so a page
   * waiting on it never waits out its full bound.
   *
   * @param {Object}   context  - chain context
   * @param {string[]} appRoles - the same role list sent to /rbac/page-access
   */
  async function loadSessionRoles(context, appRoles) {
    const { $application } = context;
    try {
      const res = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getRbacSessionRoles',
        uriParams: {
          oracleRole: appRoles.length === 1 ? appRoles[0] : appRoles
        }
      });

      if (!res || !res.ok) {
        console.warn('[loadPageAccessChain] session-roles call failed',
          res && res.statusCode, '- dashboard persona falls back to the RT_EQP_* map');
        return;
      }

      const rows = (res.body && Array.isArray(res.body.data)) ? res.body.data : [];
      // The server already orders by priority; sorted again so the contract
      // does not rest on it. Array.prototype.sort is stable, so ties keep the
      // server's sessionRole order.
      const ordered = rows.slice().sort(function (a, b) {
        return Number(a && a.priority) - Number(b && b.priority);
      });
      const codes = [];
      ordered.forEach(function (row) {
        const c = String((row && row.sessionRole) || '').trim().toUpperCase();
        if (c && codes.indexOf(c) < 0) codes.push(c);
      });

      $application.variables.sessionRoles = codes;
      console.log('[loadPageAccessChain] session roles', codes.join(',') || '(none)');
    } catch (e) {
      console.warn('[loadPageAccessChain] session-roles lookup error', e);
    } finally {
      $application.variables.sessionRolesLoaded = true;
    }
  }

  class loadPageAccessChain extends ActionChain {
    async run(context) {
      const { $application } = context;
      // Started once the role list is known; awaited in finally so the chain
      // does not finish with the lookup still in flight.
      let sessionRolesTask = null;

      try {
        const user = $application.user;

        // Defensive: different providers populate different identity fields,
        // and Designer preview may leave them blank. Logged for diagnosis only
        // — role resolution never depends on the login string.
        const login = (user && (user.userName || user.login)) || '(unresolved)';

        // Fusion job roles come from the ROLES_RP BIP report, not from the
        // IDCS token: $application.user.roles carries only VB Studio platform
        // roles here. loadFusionRolesChain must have run first — it is awaited
        // below rather than relied on by vbEnter ordering, because VB runs
        // vbEnter chains in parallel.
        await Actions.callChain(context, { chain: 'loadFusionRolesChain' });

        const fusionRoles = ($application.variables.fusionRoles || [])
          .map(function (r) { return String(r).trim().toUpperCase(); })
          .filter(Boolean);

        // Fall back to whatever the token carried, in case an environment does
        // surface job roles directly (then BIP is redundant and this still works).
        const allRoles = extractRoles(user);
        let appRoles = fusionRoles.length
          ? fusionRoles
          : allRoles.filter(function (r) {
            return !isNonFusionRole(r);
          });

        // NOTE: a Designer-preview fallback used to sit here, substituting a
        // hard-coded ADMIN role when no job role could be resolved. It has been
        // REMOVED now that the BIP lookup works in preview — it did exactly what
        // such fallbacks always do: produced a full, correct-looking menu on top
        // of a completely failed role lookup, twice. Do not reintroduce it.
        // If roles cannot be resolved, the menu must be empty.

        if (!appRoles.length) {
          // Nothing resolvable. Every page stays HIDDEN (fail-closed).
          console.warn('[loadPageAccessChain] no resolvable job role for user',
            login, '- roles seen:', allRoles);
          return;
        }

        // In parallel with page access, never blocking it. See loadSessionRoles.
        sessionRolesTask = loadSessionRoles(context, appRoles);

        const result = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getRbacPageAccess',
          // Query params belong under uriParams; anything passed as `parameters`
          // is silently ignored by callRest.
          uriParams: {
            oracleRole: appRoles.length === 1 ? appRoles[0] : appRoles
          }
        });

        if (!result || !result.ok) {
          console.error('[loadPageAccessChain] page-access call failed',
            result && result.statusCode);
          return; // fail closed: map stays empty
        }

        // Contract: a flat { PAGE_CODE: LEVEL } object. Tolerate the common
        // wrapper shapes rather than blanking the whole menu if the backend
        // nests the payload.
        const body = result.body;
        const raw = (body && !Array.isArray(body) && typeof body === 'object')
          ? (body.data && typeof body.data === 'object' && !Array.isArray(body.data)
            ? body.data
            : body)
          : null;

        if (!raw) {
          console.error('[loadPageAccessChain] unexpected payload shape', body);
          return;
        }

        // Copy only well-formed entries, so one bad value can't grant access.
        const map = {};
        Object.keys(raw).forEach(function (code) {
          const lvl = raw[code];
          if (typeof lvl === 'string' && VALID_LEVELS[lvl.toUpperCase()]) {
            map[code] = lvl.toUpperCase();
          }
        });

        $application.variables.pageAccessMap = map;
        // Set LAST — it is the latch every gate reads, so the map must be in
        // place before it flips.
        $application.variables.pageAccessLoaded = true;

        console.log('[loadPageAccessChain] resolved', Object.keys(map).length,
          'pages for', appRoles.join(','));
      } catch (e) {
        console.error('[loadPageAccessChain] unexpected error', e);
        // Fail closed: the map is only ever assigned whole, just before the
        // latch, so here it is still the empty default.
      } finally {
        // Settle the latch on EVERY path. On the success path it is already
        // true; on the others the map is still {}, so every page resolves to
        // HIDDEN and the guards redirect to No Access instead of admitting.
        $application.variables.pageAccessLoaded = true;

        if (sessionRolesTask) {
          // Never rejects: loadSessionRoles catches everything and sets the latch.
          await sessionRolesTask;
        } else {
          // Exited before a role list existed (no roles, or an early error):
          // nothing to look up, so settle the latch for anyone waiting on it.
          $application.variables.sessionRolesLoaded = true;
        }
      }
    }
  }

  return loadPageAccessChain;
});
