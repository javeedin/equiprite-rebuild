define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/helpGuide',
  'resources/js/requestData',
], (ActionChain, Actions, guide, requestData) => {
  'use strict';

  // Help: how many pieces sit at each step now (the shared request list, as Requests and My work read it), which steps
  // are this user's (page access), then the diagram is drawn. Reads only. Someone without the request list still gets
  // the diagram, without numbers.
  const TRIES = 60;
  const GAP_MS = 50;

  class loadChain extends ActionChain {
    async run(context, { refresh }) {
      const v = context.$page.variables;
      const app = context.$application.variables;
      v.isLoading = true;
      v.statuses = guide.statusRows();
      for (let i = 0; i < TRIES && !app.pageAccessLoaded; i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      v.mine = guide.mine(app.pageAccessMap, app.pageAccessLoaded);
      let counts = {};
      try {
        const data = await requestData.load(context, Actions, { refresh: !!refresh });
        counts = data.error ? {} : guide.counts(data.rows, data.linesByRequest);
      } finally {
        v.isLoading = false;
      }
      v.counts = counts;
      await Actions.callChain(context, { chain: 'stepChain', params: { act: 'draw', key: (v.sel && v.sel.key) || '' } });
    }
  }

  return loadChain;
});
