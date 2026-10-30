define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/bipLov',
  'resources/js/currentUser',
], (ActionChain, Actions, bipLov, cu) => {
  'use strict';

  // Fetches the signed-in user's FUSION job roles from BI Publisher and puts
  // them on $application.variables.fusionRoles.
  //
  // WHY THIS EXISTS: $application.user.roles does NOT carry Fusion job roles in
  // this environment. A real session returns ~42 VB Studio platform roles
  // (GIT_READ, BUILD_EXEC, APPROLE.*, ROLE_*) and no ORA_*_JOB code at all, so
  // there is nothing for RBAC_ROLE_MAP to match. This chain goes back to Fusion
  // and asks "what roles does this username have?" via the ROLES_RP report.
  //
  // Report: /shared/Custom/RiteSuite/Common/ROLES_RP  (the '/shared' prefix is
  // stripped for the SOAP call — same convention as the existing LOV chains).
  //
  // SECURITY BOUNDARY — read this before relying on it:
  // The credential is a stored VB reference and the bipService backend is
  // forceProxy:'always', so the browser never sees it. But the resolved roles
  // are still ASSERTED BY THE CLIENT when they are passed to /rbac/page-access.
  // Anyone can edit that request. This is a UX gate, not authorization. The
  // real fix is for the backend to resolve the username server-side (call BIP
  // itself, map via RBAC_ROLE_MAP) and ignore any client-supplied role — see
  // docs/RBAC_PAGE_LEVEL.md. Until then the backend must independently reject
  // requests for pages the caller may not see.
  //
  // FAILS CLOSED: any failure leaves fusionRoles empty, which resolves every
  // page to HIDDEN.

  // EquipRite's OWN copy of the roles report, duplicated from
  // /shared/Custom/RiteSuite/Common/ROLES_RP so its SQL can be changed without
  // affecting the other Rite Suite apps that share the Common one.
  // ('/shared' is stripped for the SOAP call, same as the LOV chains.)
  //
  // Its data set must UNION two sources, or users whose roles carry no
  // data-security context resolve to nothing:
  //   fun_user_role_data_asgnmnts  — roles provisioned WITH data access
  //   per_user_roles               — plain role grants (e.g. RT_EQP_*)
  // The Common report reads only the first, which is why the new EQUIPMENT.*
  // users returned zero rows while john.dunbar worked.
  const XDO_PATH = '/Custom/EquipRite/ROLES_RP.xdo';

  // Report parameter name. CONFIRMED as P_LOGIN by the report's own echo:
  // a run with the wrong name came back as <DATA_DS><P_LOGIN></P_LOGIN></DATA_DS>
  // — i.e. BIP silently DROPPED the unknown parameter, ran unfiltered, matched
  // no user and returned zero rows. A wrong name here does not error; it just
  // quietly resolves everyone to no roles.
  const PARAM_NAME = 'P_LOGIN';

  // Confirmed shape of ROLES_RP (see the report output):
  //   USERNAME | EMAIL_ADDRESS | ORACLE_ROLE_COMMON_NAME | ORACLE_ROLE_DISPLAY
  // ORACLE_ROLE_COMMON_NAME is the stable machine code to map on
  // (e.g. ORA_OSS_SUBSCRIPTION_SPECIALIST_JOB); ORACLE_ROLE_DISPLAY is a
  // human label that can be renamed, so it is never matched against.
  //
  // CONFIRMED against a live run: data source DATA_DS, repeating row element
  // G_1, one G_1 per role.
  const ROW_TAG = 'G_1';
  const CODE_FIELD = 'ORACLE_ROLE_COMMON_NAME';
  const LABEL_FIELD = 'ORACLE_ROLE_DISPLAY';

  // ── Identity resolution lives in resources/js/currentUser.js ──────────────
  //
  // usernameFromJwt() and fusionUsername() used to be defined here. They are now
  // shared, because the SAME answer is needed by the Transfer Order audit stamp
  // (X-User-Id on /reserve and /record). Two copies would eventually disagree,
  // and then a Transfer Order would be attributed to a user this role lookup
  // does not recognise — the audit trail would quietly stop matching RBAC.
  //
  // Behaviour is unchanged: JWT `sub` first, $application.user as the fallback,
  // same candidate walk, same email-domain and idcs- prefix stripping.
  //
  // SECURITY BOUNDARY (unchanged, and repeated because it governs both callers):
  // the JWT is DECODED, NOT VERIFIED. No signature, issuer or expiry check is
  // possible in the browser — it has no signing key and must not have one. The
  // value is a CLAIM. That is acceptable only because the roles it leads to are
  // a UX gate, not authorization, and the audit stamp is a label, not a
  // permission. A forged `sub` gets a different menu and a misleading audit
  // line; the backend must still reject the requests behind it. If either ever
  // needs to TRUST the actor, this moves server-side.

  class loadFusionRolesChain extends ActionChain {

    async run(context) {
      const { $application } = context;

      try {
        // JWT `sub` first, $application.user as the fallback.
        //
        // The token is the account the session was actually issued for, which
        // is the thing per_users.username needs to match. $application.user is
        // inconsistently populated in this environment — the CANDIDATES walk in
        // the CANDIDATES walk in currentUser exists precisely because login/userName come back
        // empty while VB still logs "User john.dunbar is authenticated".
        //
        // Fallback, not replacement: no ?jwt= on the URL (a direct nav, a
        // bookmark, Designer preview) must keep working exactly as before.
        const jwtSub = cu.usernameFromJwt($application.variables.jwt);
        const username = cu.resolveUsername(cu.vbUser({ user: $application.user }), jwtSub);

        if (jwtSub) {
          console.log('[loadFusionRolesChain] username from JWT sub:', username);
        }

        if (!username) {
          // Dump the whole identity object so the real field name can be read
          // off it directly. VB reports "User <name> is authenticated" at
          // startup, so the name IS in here somewhere — just not under any of
          // the field names tried above.
          const u = $application.user || {};
          let keys = [];
          try {
            keys = Object.keys(u);
          } catch (e) { /* ignore */ }

          console.warn('[loadFusionRolesChain] no username on $application.user'
            + ' - cannot resolve Fusion roles, failing closed.'
            + '\n  keys present: ' + JSON.stringify(keys)
            + '\n  string-valued fields: ' + JSON.stringify(
              keys.reduce(function (acc, k) {
                if (typeof u[k] === 'string') { acc[k] = u[k]; }
                return acc;
              }, {})));
          return;
        }

        // Case is NOT handled here: the report's WHERE clause already wraps
        // both sides in UPPER(), and a HAR capture confirmed 'emma.adams' and
        // 'EMMA.ADAMS' return byte-identical results. An earlier retry-both-
        // cases loop was removed as dead weight once that was proven.
        //
        // The EMAIL DOMAIN, however, is a real difference between tenants.
        // resolveUsername strips it ('JOHN.DUNBAR@x.com' -> 'JOHN.DUNBAR'),
        // which matches tenants whose Fusion usernames have no domain (dev20).
        // Oceaneering's tenant issues tokens with sub = the full email
        // ('rpanganamamula@oceaneering.com', 2026-10-12) and the stripped value
        // found no roles there, so every page resolved HIDDEN and the app had
        // nowhere to land. So: try the stripped name first (unchanged
        // behaviour), and only if that returns nothing, retry once with the
        // token's sub exactly as issued.
        const logins = [username];
        if (jwtSub && jwtSub.toUpperCase() !== String(username).toUpperCase()) {
          logins.push(jwtSub);
        }

        let roles = [];
        let matchedLogin = username;
        for (let i = 0; i < logins.length && !roles.length; i++) {
          const login = logins[i];
          console.log('[loadFusionRolesChain] calling ROLES_RP with',
            PARAM_NAME + '=' + login);

          const soapBody = bipLov.buildSoapBody(XDO_PATH, [
            { name: PARAM_NAME, value: login }
          ]);

          const response = await Actions.callRest(context, {
            endpoint: 'bipService/runBIPReport',
            body: soapBody
          });

          if (!response || !response.ok) {
            console.error('[loadFusionRolesChain] BIP call failed',
              response && response.statusCode);
            return; // fail closed
          }

          roles = bipLov.decodeReportRows(
            response.body, ROW_TAG, CODE_FIELD, LABEL_FIELD) || [];
          matchedLogin = login;

          if (!roles.length) {
            // No rows for this login. Most often the username did not match
            // per_users.username, or P_LOGIN was dropped (an unknown parameter
            // name is silently ignored by BIP — it runs unfiltered and returns
            // nothing rather than erroring). Dump the XML: an empty
            // <P_LOGIN></P_LOGIN> echo means the parameter never arrived.
            try {
              const bytes = bipLov.extractReportBytes(response.body);
              const xml = bytes ? atob(String(bytes).replace(/\s/g, '')) : '(no reportBytes)';
              console.error('[loadFusionRolesChain] no roles returned for '
                + login + '. Raw report XML:\n' + String(xml).substring(0, 2000));
            } catch (e) {
              console.error('[loadFusionRolesChain] could not decode report body', e);
            }
          }
        }
        if (!roles.length) {
          return; // fail closed
        }

        // parseXmlRows returns each row as an object of tagName -> text, PLUS
        // convenience keys id/label/label2 mapped from the requested fields.
        // The role code is therefore `id` (or the raw column, if the row tag
        // matched a wrapper rather than the repeating element). Read the named
        // column first and fall back to `id`; never stringify the row itself,
        // which is how this previously produced '[object Object]'.
        const seen = {};
        const codes = [];
        roles.forEach(function (r) {
          if (!r || typeof r !== 'object') {
            return;
          }
          const code = String(r[CODE_FIELD] || r.id || '').trim().toUpperCase();
          if (code && !seen[code]) {
            seen[code] = 1;
            codes.push(code);
          }
        });

        $application.variables.fusionRoles = codes;

        console.log('[loadFusionRolesChain] resolved', codes.length,
          'Fusion role(s) for', matchedLogin, codes);
      } catch (e) {
        console.error('[loadFusionRolesChain] unexpected error', e);
        // fail closed: fusionRoles stays empty
      }
    }
  }

  return loadFusionRolesChain;
});
