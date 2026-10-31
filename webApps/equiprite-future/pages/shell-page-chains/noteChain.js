define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/future/fxStore',
], (ActionChain, Actions, store) => {
  'use strict';

  // A notification was clicked: the bell closes and what it is about opens, a screen ({ navId }) or a request
  // ({ record: 'request', id }, titled with its number). Read marks are the store's, per persona: Mark all read.
  class noteChain extends ActionChain {
    async run(context, { id }) {
      const v = context.$page.variables;
      const n = ((v.bell && v.bell.rows) || []).filter((x) => x.id === id)[0];
      v.bellOpen = false;
      const link = n && n.link;
      if (!link) return;
      if (link.record) {
        const r = (store.get().requests || []).filter((x) => x.id === link.id)[0];
        await Actions.callChain(context, { chain: 'openChain', params: { record: link.record, params: { id: link.id, number: r ? r.number : '' } } });
      } else if (link.navId) {
        await Actions.callChain(context, { chain: 'openChain', params: { navId: link.navId } });
      }
    }
  }

  return noteChain;
});
