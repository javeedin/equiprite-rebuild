define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/yardLoad',
], (ActionChain, Actions, yardLoad) => {
  'use strict';

  // After a step: re-reads one request's lines (views/request-detail-lines) so its card says where its pieces are now
  // (Next's refreshRowChain). Reads only.
  class refreshRowChain extends ActionChain {
    async run(context, { id }) {
      const v = context.$page.variables;
      const rec = (v.records || []).filter((r) => String(r.id) === String(id))[0];
      if (!rec) return;
      const res = await yardLoad.lines(context, Actions, [rec]);
      v.linesBy = Object.assign({}, v.linesBy, res.linesBy);
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return refreshRowChain;
});
