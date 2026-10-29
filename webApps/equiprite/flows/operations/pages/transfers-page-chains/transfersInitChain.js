define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Opens Inter-project transfer. Side by side:
  //   workbench-requests?stage=DEPLOYED   requests with equipment on site (the From list; Workbench › Deployed)
  //   workbench-requests?stage=OUTBOUND   approved requests on their way out (the To list)
  //   inv-orgs                            names for the sites
  //   transfer-history                    the recent transfers, all requests
  // Then the request from the URL (?sourceRequestId=), when one was passed.
  async function get(context, endpoint, uriParams) {
    try {
      const res = await Actions.callRest(context, { endpoint, uriParams });
      if (!res || !res.ok) {
        return { ok: false, status: res && res.status, rows: [] };
      }
      const b = res.body;
      return { ok: true, rows: Array.isArray(b) ? b : ((b && Array.isArray(b.data)) ? b.data : []) };
    } catch (e) {
      console.warn('[transfersInitChain] ' + endpoint + ' failed', e);
      return { ok: false, status: 0, rows: [] };
    }
  }

  class transfersInitChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;
      v.isLoading = true;
      v.loadError = '';
      try {
        const [deployed, outbound, orgs, recent] = await Promise.all([
          get(context, 'eqp-v1/getEquipriteV1ViewsWorkbenchRequests', { stage: 'DEPLOYED', size: 1000 }),
          get(context, 'eqp-v1/getEquipriteV1ViewsWorkbenchRequests', { stage: 'OUTBOUND', size: 1000 }),
          get(context, 'eqp-v1/getInvOrgs', { size: 500 }),
          get(context, 'eqp-v1/getTransferHistory', {}),
        ]);
        v.sourceRows = deployed.rows;
        v.destRows = outbound.rows;
        v.invOrgs = orgs.rows;
        v.recent = recent.rows;
        const failed = [];
        if (!deployed.ok) {
          failed.push('the requests with deployed equipment (HTTP ' + (deployed.status || 0) + ')');
        }
        if (!outbound.ok) {
          failed.push('the approved requests (HTTP ' + (outbound.status || 0) + ')');
        }
        if (failed.length) {
          v.loadError = 'Could not load ' + failed.join(' or ') + '.';
        }
      } finally {
        v.isLoading = false;
      }
      const from = Number(v.sourceRequestId) || 0;
      if (from > 0) {
        await Actions.callChain(context, { chain: 'pickRequestChain', params: { side: 'source', id: String(from) } });
      }
    }
  }

  return transfersInitChain;
});
