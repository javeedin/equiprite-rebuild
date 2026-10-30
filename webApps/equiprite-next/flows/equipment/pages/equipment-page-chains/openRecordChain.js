define(['vb/action/actionChain', 'resources/js/shellBus'], (ActionChain, bus) => {
  'use strict';

  // An item opens in a tab of its own (the shell keeps this list's tab as it is). The record kind is 'equipment-item'
  // (nav.js RECORDS): 'equipment' is the menu item's id, and ?open=equipment must open the catalog.
  class openRecordChain extends ActionChain {
    async run(context, { id, number }) {
      if (!id) return;
      bus.open({ record: 'equipment-item', params: { id: Number(id), number: number || '' } });
    }
  }

  return openRecordChain;
});
