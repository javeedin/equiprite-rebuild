define(['vb/action/actionChain', 'resources/js/shellBus'], (ActionChain, bus) => {
  'use strict';

  // A transfer opens in a tab of its own (this list stays as it was left). An inter-project transfer on record without
  // an order of its own says so (source 'history'), so its tab reads it from the history rather than ask for the order.
  // The Redwood table's row action gives the row's key only: the transfer is found by it in the list.
  class openRecordChain extends ActionChain {
    async run(context, { id, number, source, key }) {
      if (key) {
        const row = (context.$page.variables.rows || []).filter((r) => r.key === key)[0];
        if (!row) return;
        id = row.id == null ? '' : String(row.id);
        number = row.number;
        source = row.synthetic ? 'history' : '';
      }
      if (!id && !number) return;
      const params = { id: id ? Number(id) : undefined, number: number || '' };
      if (source === 'history') params.source = 'history';
      bus.open({ record: 'transfer', params });
    }
  }

  return openRecordChain;
});
