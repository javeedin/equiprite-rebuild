define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Opens a request: New EquipRite's pickRequestChain reads, in its order: its lines (views/request-detail-lines), what
  // has been consumed (inventory-consumptions?requestId), its direct costs (direct-cost-txns?requestId) and its cost
  // history (views/project-cost-detail?requestNumber). Only the lines are needed; the rest are non-fatal. New's form
  // for recording a material issue is not carried (it stays in New EquipRite), so nothing else is read.
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
    async run(context, { id, force }) {
      const { $page } = context;
      const v = $page.variables;
      const req = (v.requests || []).find((r) => String(r.id) === String(id));
      if (!req || v.detailLoading) return;
      if (!force && v.current && v.current.id === req.id) return;
      v.current = Object.assign({}, req);
      v.detailLoading = true;
      v.detailError = '';
      v.exportOpen = '';
      v.lines = [];
      v.consumptions = [];
      v.directCosts = [];
      v.costRows = [];
      try {
        const res = await Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1ViewsRequestDetailLines', uriParams: { requestId: Number(req.id), size: 10000 } });
        const rows = res && res.ok && res.body && Array.isArray(res.body.data) ? res.body.data : [];
        if (!res || !res.ok) v.detailError = 'The lines of ' + req.requestNumber + ' could not be loaded.';
        v.lines = $page.functions.issuableLines(rows);
        v.consumptions = await listOf(context, 'eqp-v1/getInventoryConsumptions', { requestId: Number(req.id) });
        v.directCosts = await listOf(context, 'eqp-v1/getDirectCostTxns', { requestId: Number(req.id) });
        v.costRows = await listOf(context, 'eqp-v1/getEquipriteV1ViewsProjectCostDetail2', { requestNumber: req.requestNumber, page: 0, size: 2000 });
      } finally {
        v.detailLoading = false;
      }
    }
  }

  return pickRequestChain;
});
