define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Loads the role picker, then the matrix for whichever role lands first.
  //
  // Roles come from RBAC_APP_ROLES rather than a hard-coded list, so seeding a
  // third app role makes it appear here with no frontend change — the same
  // discipline that made the client-side role allow-list in loadPageAccessChain
  // a mistake worth removing.
  class initRbacAdminChain extends ActionChain {

    async run(context) {
      const { $page, $application } = context;

      // Second gate, stricter than the vbBeforeEnter guard.
      //
      // canEnterPage() deliberately ALLOWS while pageAccessLoaded is false, so
      // a cold load does not bounce every user to the dashboard. That trade is
      // right for ordinary pages; it is wrong for the screen that edits the
      // permission matrix itself. Here we require the map to be genuinely
      // loaded AND to grant FULL — anything else loads no data at all.
      //
      // READ_ONLY is treated as no access rather than a view-only grid: a
      // half-usable permissions editor invites confusion, and nothing in the
      // matrix is worth reading without the ability to change it.
      const level = $application.functions.pageAccess(
        $application.variables.pageAccessMap,
        $application.variables.pageAccessLoaded,
        'EQR_RBAC_ADMIN');

      if (level !== 'FULL') {
        console.warn('[initRbacAdminChain] refusing to load - EQR_RBAC_ADMIN is', level);
        $page.variables.loadError =
          'You do not have permission to manage page access.';
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
            'Could not load the role list (' + ((result && result.statusCode) || 'no response') + ').';
          return;
        }

        // Contract is { data: [...] }. Tolerate a bare array too, rather than
        // showing an empty picker if the envelope differs.
        const body = result.body;
        const rows = Array.isArray(body) ? body : ((body && body.data) || []);
        const roles = rows.filter(function (r) {
          return r && r.isActive !== 'N';
        });

        $page.variables.rolesArray = roles;

        if (!roles.length) {
          $page.variables.loadError =
            'No active application roles are defined for EQUIP_RITE.';
          return;
        }

        // Default to the first role so the grid is never empty on open.
        const first = roles[0].appRoleId;
        $page.variables.selectedRoleId = first;

        await Actions.callChain(context, {
          chain: 'loadMatrixChain',
          params: { appRoleId: first }
        });
      } catch (e) {
        console.error('[initRbacAdminChain] unexpected error', e);
        $page.variables.loadError = 'Unexpected error loading roles.';
      } finally {
        $page.variables.isLoading = false;
      }
    }
  }

  return initRbacAdminChain;
});
