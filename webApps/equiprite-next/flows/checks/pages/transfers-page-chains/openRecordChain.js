define(['vb/action/actionChain', 'resources/js/shellBus'], (ActionChain, bus) => {
  'use strict';

  // A transfer opens in a tab of its own (this list stays as it was left). An inter-project transfer on record without
  // an order of its own says so (source 'history'), so its tab reads it from the history rather than ask for the order.
  class openRecordChain extends ActionChain {
    async run(context, { id, number, source }) {
      if (!id && !number) return;
      const params = { id: id ? Number(id) : undefined, number: number || '' };
      if (source === 'history') params.source = 'history';
      bus.open({ record: 'transfer', params });
    }
  }

  return openRecordChain;
});
