define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Opens a request: its lines (views/request-detail-lines, the old request detail's single call), what has been
  // consumed (inventory-consumptions?requestId), its direct costs (direct-cost-txns?requestId) and its cost history
  // (views/project-cost-detail?requestNumber). Only the lines are needed to record; the rest are non-fatal.
  const listOf = async (context, endpoint, uriParams) => {
    try {
      const r = await Actions.callRest(context, { endpoint, uriParams });
      return r && r.ok && r.body && Array.isArray(r.body.data) ? r.body.data : [];
    } catch (e) {
      console.warn('[pickRequestChain] ' + endpoint + ' not read:', e && e.message);
      return [];
    }
  };

  class pickRequestChain extends ActionChain {
    async run(context, { id }) {
      const { $page } = context;
      const v = $page.variables;
      if (v.isSubmitting) return;
      const req = (v.requests || []).find((r) => String(r.id) === String(id));
      if (!req) return;
      v.current = Object.assign({}, req);
      v.detailLoading = true;
      v.formError = '';
      v.note = '';
      v.lines = [];
      v.units = [];
      v.issue = { lineId: null, itemNumber: '', quantity: null, uom: 'EA', subinventory: '' };
      try {
        const res = await Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1ViewsRequestDetailLines', uriParams: { requestId: Number(req.id), size: 10000 } });
        const rows = res && res.ok && res.body && Array.isArray(res.body.data) ? res.body.data : [];
        if (!res || !res.ok) v.formError = 'The lines of ' + req.requestNumber + ' could not be loaded.';
        v.lines = $page.functions.issuableLines(rows);
        v.consumptions = await listOf(context, 'eqp-v1/getInventoryConsumptions', { requestId: Number(req.id) });
        v.directCosts = await listOf(context, 'eqp-v1/getDirectCostTxns', { requestId: Number(req.id) });
        v.costRows = await listOf(context, 'eqp-v1/getEquipriteV1ViewsProjectCostDetail2', { requestNumber: req.requestNumber, page: 0, size: 2000 });
      } finally {
        v.detailLoading = false;
      }
      if (v.lines.length === 1) {
        await Actions.callChain(context, { chain: 'issueChain', params: { action: 'line', value: String(v.lines[0].lineId) } });
      }
    }
  }

  return pickRequestChain;
});
