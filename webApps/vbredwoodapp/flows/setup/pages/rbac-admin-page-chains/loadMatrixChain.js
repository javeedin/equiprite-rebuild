define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Loads the page x access rows for ONE role.
  //
  // Uses /rbac/page-access-matrix, not /rbac/page-access: the latter resolves a
  // single role and OMITS non-granted pages (absent = HIDDEN), which is right
  // for the runtime gate but useless for an editing grid — a HIDDEN page would
  // simply vanish from the list instead of showing as HIDDEN.
  //
  // Discards any pending edits: switching role is an explicit context change,
  // and silently carrying edits across roles is how you save to the wrong one.
  class loadMatrixChain extends ActionChain {

    /**
     * @param {Object} context
     * @param {Object} params
     * @param {number} params.appRoleId
     */
    async run(context, { appRoleId }) {
      const { $page } = context;

      if (appRoleId === undefined || appRoleId === null || appRoleId === '') {
        return;
      }

      const roleId = Number(appRoleId);

      $page.variables.isLoading = true;
      $page.variables.loadError = '';
      $page.variables.dirtyMap = {};
      $page.variables.selectedRoleId = roleId;

      try {
        const result = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getRbacPageAccessMatrix',
          uriParams: { appRoleId: roleId }
        });

        if (!result || !result.ok) {
          $page.variables.matrixArray = [];
          $page.variables.loadError =
            'Could not load page access (' + ((result && result.statusCode) || 'no response') + ').';
          return;
        }

        // Contract is { data: [...] }. Tolerate a bare array too, rather than
        // showing an empty grid if the envelope differs.
        const body = result.body;
        const rows = Array.isArray(body) ? body : ((body && body.data) || []);

        // Defensive: the endpoint takes appRoleId as an OPTIONAL filter, so a
        // backend that ignores it would return every role's rows and the grid
        // would show duplicates and save the wrong values. Filter client-side.
        const mine = rows.filter(function (r) {
          return r && Number(r.appRoleId) === roleId;
        });

        // Group by module, then by the page's own sort order, so the grid reads
        // in the same order as the navigation drawer.
        mine.sort(function (a, b) {
          return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
        });

        $page.variables.matrixArray = mine;

        if (!mine.length) {
          $page.variables.loadError =
            'No pages are defined for this application.';
        }
      } catch (e) {
        console.error('[loadMatrixChain] unexpected error', e);
        $page.variables.matrixArray = [];
        $page.variables.loadError = 'Unexpected error loading page access.';
      } finally {
        $page.variables.isLoading = false;
      }
    }
  }

  return loadMatrixChain;
});
