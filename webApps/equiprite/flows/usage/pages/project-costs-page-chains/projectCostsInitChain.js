define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/usageGuard',
], (ActionChain, Actions, usageGuard) => {
  'use strict';

  // Opens Direct cost & inventory: the feature guard, then the requests a cost can be charged against. They come from
  // views/my-requests with the role's origin filter (My requests' own call), narrowed to approved and active
  // requests. ?request= opens one.
  const TRIES = 60;
  const GAP_MS = 50;

  class projectCostsInitChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      if (!(await usageGuard.allow(context, Actions))) {
        return;
      }
      const vars = $application.variables;
      const fns = $application.functions;
      for (let i = 0; i < TRIES && !vars.sessionRolesLoaded; i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      $page.variables.readOnly = !!fns.isPageReadOnly(vars.pageAccessMap, vars.pageAccessLoaded, 'EQR_EQUIPMENT_MASTER');
      try {
        const res = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipriteV1ViewsMyRequests',
          uriParams: { size: 2000, filter: fns.myRequestsOriginFilter(vars.fusionRoles, vars.sessionRoles) },
        });
        if (!res || !res.ok) {
          $page.variables.loadError = 'The requests could not be loaded (HTTP ' + (res && res.status) + ').';
        } else {
          $page.variables.requests = $page.functions.activeRequests(res.body && res.body.data);
        }
      } catch (e) {
        console.error('[projectCostsInitChain] failed', e);
        $page.variables.loadError = 'The requests could not be loaded.';
      } finally {
        $page.variables.isLoading = false;
      }
      const wanted = String($page.variables.request || '').trim();
      const hit = wanted ? ($page.variables.requests || []).find((r) => r.requestNumber === wanted) : null;
      if (hit) {
        await Actions.callChain(context, { chain: 'pickRequestChain', params: { id: String(hit.id) } });
      }
    }
  }

  return projectCostsInitChain;
});
