define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Loads My requests: the old list's endpoint (views/my-requests) with its role-scoped origin filter
  // (myRequestsOriginFilter: ALL for managers and administrators, Internal for everyone else). That filter is only
  // right once the roles are known, so this waits briefly for them, as the old Home does.
  const TRIES = 60;
  const GAP_MS = 50;

  class loadRequestsChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const vars = $application.variables;
      for (let i = 0; i < TRIES && !vars.sessionRolesLoaded; i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      const fns = $application.functions;
      $page.variables.isManager = !!fns.canChooseCustomerType(vars.fusionRoles, vars.sessionRoles);
      $page.variables.isLoading = true;
      $page.variables.fetchError = '';
      try {
        const res = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipriteV1ViewsMyRequests',
          uriParams: { size: 2000, filter: fns.myRequestsOriginFilter(vars.fusionRoles, vars.sessionRoles) },
        });
        if (!res || !res.ok) {
          $page.variables.allRows = [];
          $page.variables.fetchError = `Your requests could not be loaded (HTTP ${res && res.status}).`;
          return;
        }
        const rows = (res.body && Array.isArray(res.body.data)) ? res.body.data : [];
        // Newest first, as people expect a work list to read.
        rows.sort((a, b) => Number(b.eqrEquipmentRequestId || 0) - Number(a.eqrEquipmentRequestId || 0));
        $page.variables.allRows = rows;
      } catch (e) {
        console.error('[loadRequestsChain] failed', e);
        $page.variables.allRows = [];
        $page.variables.fetchError = 'Your requests could not be loaded.';
      } finally {
        $page.variables.isLoading = false;
      }
    }
  }

  return loadRequestsChain;
});
