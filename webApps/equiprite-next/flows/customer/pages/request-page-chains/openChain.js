define(['vb/action/actionChain', 'resources/js/shellBus'], (ActionChain, bus) => {
  'use strict';

  // From a request: its quote, its invoices, the draft reopened in New request (customer) on its Review or to edit
  // it, or the portal. Each in a tab of its own.
  class openChain extends ActionChain {
    async run(context, { record, step }) {
      const v = context.$page.variables;
      const h = v.head || {};
      const params = { id: v.requestId || h.id, number: h.requestNumber || v.number };
      if (record === 'portal') { bus.open({ navId: 'customer-portal' }); return; }
      if (!params.id) return;
      if (record === 'quote' || record === 'invoice') bus.open({ record, params });
      else if (record === 'customer-order') bus.open({ record, params: { draft: params.id, number: params.number, startStep: step === 'review' ? 'review' : 'edit' } });
    }
  }

  return openChain;
});
