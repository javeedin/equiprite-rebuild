define(['vb/action/actionChain', 'resources/js/shellBus'], (ActionChain, bus) => {
  'use strict';

  // From a quote: its request in a tab of its own, or the portal.
  class openChain extends ActionChain {
    async run(context, { record }) {
      const v = context.$page.variables;
      if (record === 'portal') { bus.open({ navId: 'customer-portal' }); return; }
      const id = v.requestId || Number(v.id) || undefined;
      const number = (v.quote && v.quote.requestNumber) || v.number || '';
      if (record === 'customer-request' && (id || number)) bus.open({ record, params: { id, number } });
    }
  }

  return openChain;
});
