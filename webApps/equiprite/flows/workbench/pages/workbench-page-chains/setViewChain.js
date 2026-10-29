define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Tab, source chip, search box, and closing the result of a bulk action. Changing tab clears the ticks.
  class setViewChain extends ActionChain {
    async run(context, { tab, source, text, dismiss }) {
      const { $page } = context;
      const v = $page.variables;
      if (tab && tab !== v.tab) {
        v.tab = tab;
        v.tabChosen = true;
        v.selectedIds = [];
      }
      if (source !== undefined && source !== null && source !== '') {
        v.source = source === 'ALL' ? '' : source;
      }
      if (text !== undefined && text !== null) {
        v.searchText = String(text);
      }
      if (dismiss) {
        v.bulkResult = null;
      }
      await Actions.callChain(context, { chain: 'applyFilterChain' });
    }
  }

  return setViewChain;
});
