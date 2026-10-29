define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The request list: the old post-cost-test vbEnterChain's two reads, views/post-cost (page 0, size 10000: the view
  // fans one row per request x week) and the unfiltered misc charges, grouped one row per request by
  // post-costs-page.js buildList (future weeks left out of the money, charges added in).
  class listChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;
      v.listLoading = true;
      v.listError = '';
      try {
        const res = await Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1ViewsPostCost', uriParams: { page: 0, size: 10000 } });
        if (!res || !res.ok || !res.body || !Array.isArray(res.body.data)) {
          v.list = [];
          v.listError = 'The requests to post could not be loaded (HTTP ' + (res && res.status) + ').';
          return;
        }
        let misc = [];
        try {
          const m = await Actions.callRest(context, { endpoint: 'eqp-v1/getMiscTransactions', uriParams: { page: 0, size: 10000 } });
          misc = $page.functions.arrOf(m && m.body);
        } catch (e) {
          console.warn('[listChain] misc charges not read (non-fatal):', e && e.message);
        }
        v.list = $page.functions.buildList(res.body.data, misc);
      } catch (e) {
        console.error('[listChain] failed', e);
        v.list = [];
        v.listError = 'The requests to post could not be loaded.';
      } finally {
        v.listLoading = false;
      }
    }
  }

  return listChain;
});
