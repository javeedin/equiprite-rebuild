define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/commercialRedwood',
], (ActionChain, Actions, RW) => {
  'use strict';

  // Redwood's Smart Search: what was typed and each filter picked narrow the table (rwCols); Smart Search applies a
  // picked filter as its list closes (Oracle's own behaviour).
  const COLS = ['status', 'epic', 'assignee', 'release', 'sprint', 'priority', 'type'];

  class rwFilterChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const c = RW.readCriterion(v.rwCriterion);
      const cols = { text: c.text || '' };
      COLS.forEach((k) => { cols[k] = c.fields[k] || ''; });
      v.rwCols = cols;
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return rwFilterChain;
});
