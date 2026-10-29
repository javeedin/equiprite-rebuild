define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Loads the page x access rows for ONE role. The old loadMatrixChain (setup/rbac-admin), unchanged in what it
  // calls and keeps: GET /rbac/page-access-matrix?appRoleId=, rows filtered to that role client-side (the parameter
  // is optional on the backend), ordered by sortOrder, pending edits discarded (switching role is a context change;
  // carrying edits across is how you save to the wrong role).
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
      $page.variables.saveError = '';
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
            'Page access for this role could not be loaded (' + ((result && (result.status || result.statusCode)) || 'no response') + '). Pick the role again to retry.';
          return;
        }

        const body = result.body;
        const rows = Array.isArray(body) ? body : ((body && body.data) || []);

        const mine = rows.filter(function (r) {
          return r && Number(r.appRoleId) === roleId;
        });

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
