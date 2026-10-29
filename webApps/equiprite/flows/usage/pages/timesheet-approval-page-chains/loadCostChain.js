define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Cost so far for each request in the week on screen: views/project-cost-detail?requestNumber= (the reports
  // page's view of EQR_PROJECT_COST_DETAIL_V), summed. Read once per request and kept, so paging through weeks does
  // not re-read. Non-fatal: a failure leaves the card saying it is unknown.
  class loadCostChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;
      const requests = (v.rowsAll || []).filter((r) => r.week === v.weekKey).map((r) => r.requestNumber)
        .filter((x, i, a) => x && a.indexOf(x) === i);
      const known = Object.assign({}, v.costByRequest || {});
      const todo = requests.filter((r) => !(r in known));
      for (const req of todo) {
        try {
          const res = await Actions.callRest(context, {
            endpoint: 'eqp-v1/getEquipriteV1ViewsProjectCostDetail2',
            uriParams: { requestNumber: req, page: 0, size: 2000 },
          });
          if (res && res.ok && res.body && Array.isArray(res.body.data)) {
            known[req] = $page.functions.sumCostRows(res.body.data);
          }
        } catch (e) {
          console.warn('[loadCostChain] cost to date not read for', req, e && e.message);
        }
      }
      if (todo.length) v.costByRequest = known;
    }
  }

  return loadCostChain;
});
