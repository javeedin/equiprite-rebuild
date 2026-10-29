define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Loads the role picker, then the matrix for the first role. From the old initRbacAdminChain (setup/rbac-admin):
  // the same stricter-than-the-guard gate (page access genuinely loaded AND EQR_RBAC_ADMIN = FULL, else load
  // nothing), the same GET /rbac/app-roles, the same active filter and first-role default.
  //
  // One difference: the gate waits briefly for page access to settle, as My requests waits for the roles. The old
  // chain read the latch once on vbEnter, so a cold load straight onto the page refused a real administrator.
  const TRIES = 100;
  const GAP_MS = 50;

  class pageAccessInitChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      for (let i = 0; i < TRIES && !$application.variables.pageAccessLoaded; i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }

      const level = $application.functions.pageAccess(
        $application.variables.pageAccessMap,
        $application.variables.pageAccessLoaded,
        'EQR_RBAC_ADMIN');

      if (level !== 'FULL') {
        console.warn('[pageAccessInitChain] refusing to load - EQR_RBAC_ADMIN is', level);
        $page.variables.loadError =
          'You do not have permission to manage page access. Ask an administrator to give your role Full access to Page access.';
        $page.variables.rolesArray = [];
        $page.variables.matrixArray = [];
        return;
      }

      $page.variables.isLoading = true;
      $page.variables.loadError = '';

      try {
        const result = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getRbacAppRoles'
        });

        if (!result || !result.ok) {
          $page.variables.loadError =
            'The role list could not be loaded (' + ((result && (result.status || result.statusCode)) || 'no response') + '). Reload the page to try again.';
          return;
        }

        const body = result.body;
        const rows = Array.isArray(body) ? body : ((body && body.data) || []);
        const roles = rows.filter(function (r) {
          return r && r.isActive !== 'N';
        });

        $page.variables.rolesArray = roles;

        if (!roles.length) {
          $page.variables.loadError =
            'No active application roles are defined for EquipRite (COMMONRITE.RBAC_APP_ROLES).';
          return;
        }

        const first = roles[0].appRoleId;
        $page.variables.selectedRoleId = first;

        await Actions.callChain(context, {
          chain: 'loadMatrixChain',
          params: { appRoleId: first }
        });
      } catch (e) {
        console.error('[pageAccessInitChain] unexpected error', e);
        $page.variables.loadError = 'Unexpected error loading roles. Reload the page to try again.';
      } finally {
        $page.variables.isLoading = false;
      }
    }
  }

  return pageAccessInitChain;
});
