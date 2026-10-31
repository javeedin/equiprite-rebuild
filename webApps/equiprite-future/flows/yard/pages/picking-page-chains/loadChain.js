define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/yardLoad',
], (ActionChain, Actions, yardLoad) => {
  'use strict';

  // Loads what has to go out: the picking queue (views/workbench-requests?stage=INITIATE&size=1000, New's queue), then
  // each request's lines (views/request-detail-lines), then shows the list; the yards follow (lookupYardsChain).
  // Reads only. A newer load (Refresh) makes an older one stop writing (loadToken).
  class loadChain extends ActionChain {
    async run(context, { refresh }) {
      const v = context.$page.variables;
      const token = (v.loadToken || 0) + 1;
      v.loadToken = token;
      v.isLoading = true;
      v.error = '';
      try {
        const q = await yardLoad.queue(context, Actions, 'picking');
        if (v.loadToken !== token) return;
        if (!q.ok) {
          v.error = 'What has to go out could not be loaded: ' + q.error;
          v.linesFailed = 0;
          v.records = [];
          return;
        }
        const res = await yardLoad.lines(context, Actions, q.rows);
        if (v.loadToken !== token) return;
        if (refresh) v.yards = {};
        v.linesBy = res.linesBy;
        v.linesFailed = res.failed;
        v.records = q.rows;
      } finally {
        if (v.loadToken === token) v.isLoading = false;
      }
      if (v.loadToken !== token) return;
      await Actions.callChain(context, { chain: 'applyChain' });
      if (v.openId && refresh) {
        await Actions.callChain(context, { chain: 'openWorkChain', params: { id: v.openId, keepBanner: true } });
      }
      // Not awaited: the list is usable while the yards come in.
      Actions.callChain(context, { chain: 'lookupYardsChain', params: { token } });
      await Actions.callChain(context, { chain: 'focusChain' });
    }
  }

  return loadChain;
});
