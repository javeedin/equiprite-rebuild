define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/shellBus',
], (ActionChain, Actions, bus) => {
  'use strict';

  // A record opens in a tab of its own (a request, its quote, its invoices, a new request); a tile or a "See all"
  // shows one of the portal's own views, with its chip.
  const RECORDS = ['customer-request', 'quote', 'invoice', 'customer-order'];
  const CHIP = { requests: 'reqGroup', equipment: 'eqChip', invoices: 'invChip' };

  class openChain extends ActionChain {
    async run(context, { record, id, number, view, chip }) {
      const v = context.$page.variables;
      if (record && RECORDS.indexOf(record) !== -1) {
        if (record === 'customer-order') { bus.open({ record, params: {} }); return; }
        if (!id && !number) return;
        bus.open({ record, params: { id: id ? Number(id) : undefined, number: number || '' } });
        return;
      }
      if (!view) return;
      if (chip && CHIP[view]) {
        v[CHIP[view]] = chip;
        await Actions.callChain(context, { chain: 'applyChain' });
      }
      await Actions.callChain(context, { chain: 'setChain', params: { field: 'view', value: view } });
    }
  }

  return openChain;
});
