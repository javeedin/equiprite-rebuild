define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/portalView',
], (ActionChain, Actions, V) => {
  'use strict';

  // The Redwood header's buttons (Oracle's general overview page: its secondary actions, and back), each what the current
  // look's button does: Refresh reads the request again; Export to Excel exports its equipment; Quote and Invoices open in
  // tabs of their own; In New EquipRite goes to the same request there; back is the portal.
  class rwActChain extends ActionChain {
    async run(context, { id }) {
      const v = context.$page.variables;
      if (id === 'refresh') await Actions.callChain(context, { chain: 'loadRecordChain' });
      else if (id === 'export') await Actions.callChain(context, { chain: 'exportChain', params: { format: 'xlsx' } });
      else if (id === 'quote') await Actions.callChain(context, { chain: 'openChain', params: { record: 'quote' } });
      else if (id === 'invoices') await Actions.callChain(context, { chain: 'openChain', params: { record: 'invoice' } });
      else if (id === 'back') await Actions.callChain(context, { chain: 'openChain', params: { record: 'portal' } });
      else if (id === 'inNew') {
        const h = v.head || {};
        const url = h.id ? V.newRequestPage((context.$application.variables.appUrls || {}).new, 'customer-request', h.requestNumber, h.id) : '';
        if (url) window.location.assign(url);
      }
    }
  }

  return rwActChain;
});
