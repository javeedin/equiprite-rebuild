define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/rules',
  'resources/js/accessMatrix',
], (ActionChain, Actions, rules, access) => {
  'use strict';

  // Loads the roles and every role's pages. From New EquipRite's pageAccessInitChain and loadMatrixChain: the same
  // stricter-than-the-menu gate (page access loaded AND EQR_RBAC_ADMIN Full, else nothing is loaded), the same GET
  // rbac/app-roles and active filter, and for each role the same GET rbac/page-access-matrix?appRoleId= with its rows
  // kept to that role and ordered by sortOrder. New loads one role at a time as it is picked; the matrix needs them
  // all, so each role's call is made once here.
  const TRIES = 100;
  const GAP_MS = 50;

  class enterChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const v = $page.variables;
      const av = $application.variables;
      for (let i = 0; i < TRIES && !av.pageAccessLoaded; i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      if (rules.pageAccess(av.pageAccessMap, av.pageAccessLoaded, 'EQR_RBAC_ADMIN') !== 'FULL') {
        v.canEdit = false;
        v.isLoading = false;
        v.loadError = 'You do not have permission to manage access. Ask an administrator to give your role Full access to Access (page code EQR_RBAC_ADMIN).';
        return;
      }
      v.canEdit = true;
      v.isLoading = true;
      v.loadError = '';
      try {
        const result = await Actions.callRest(context, { endpoint: 'eqp-v1/getRbacAppRoles' });
        if (!result || !result.ok) {
          v.loadError = 'The role list could not be loaded (' + ((result && (result.status || result.statusCode)) || 'no response') + '). Refresh the tab to try again.';
          return;
        }
        const roles = access.activeRoles(result.body);
        if (!roles.length) {
          v.loadError = 'No active application roles are defined for EquipRite (COMMONRITE.RBAC_APP_ROLES).';
          return;
        }
        const results = await Promise.all(roles.map((role) => Actions.callRest(context, {
          endpoint: 'eqp-v1/getRbacPageAccessMatrix',
          uriParams: { appRoleId: Number(role.appRoleId) },
        }).catch(() => null)));
        const rowsByRole = {};
        const failed = [];
        roles.forEach((role, i) => {
          const res = results[i];
          if (!res || !res.ok) {
            failed.push(access.roleName(roles, role.appRoleId) + ' (' + ((res && (res.status || res.statusCode)) || 'no response') + ')');
            rowsByRole[role.appRoleId] = [];
            return;
          }
          rowsByRole[role.appRoleId] = access.roleRows(res.body, role.appRoleId);
        });
        v.roles = roles;
        v.rowsByRole = rowsByRole;
        v.dirty = {};
        v.saveErrors = {};
        if (failed.length) {
          v.loadError = 'Page access could not be loaded for ' + failed.join(', ') + '. Those columns are empty; refresh the tab to try again.';
        } else if (!Object.keys(rowsByRole).some((k) => rowsByRole[k].length)) {
          v.loadError = 'No pages are defined for this application.';
        }
      } catch (e) {
        console.error('[access enterChain] failed', e);
        v.loadError = 'Unexpected error loading access. Refresh the tab to try again.';
      } finally {
        v.isLoading = false;
      }
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return enterChain;
});
