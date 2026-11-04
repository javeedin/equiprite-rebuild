define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // A row of the Redwood view's table: the request in a tab of its own, through openChain as a row of the current
  // look opens it. The table's row action gives the row's key only (the request's id): its number from the requests.
  class rwOpenChain extends ActionChain {
    async run(context, { id }) {
      if (!id) return;
      const row = (context.$page.variables.rows || []).filter((r) => String(r.id) === String(id))[0];
      await Actions.callChain(context, { chain: 'openChain', params: { record: 'customer-request', id: String(id), number: row ? row.requestNumber : '' } });
    }
  }

  return rwOpenChain;
});
