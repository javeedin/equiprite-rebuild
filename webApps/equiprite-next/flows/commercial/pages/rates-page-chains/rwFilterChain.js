define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/commercialRedwood',
], (ActionChain, Actions, RW) => {
  'use strict';

  // The Redwood look's Smart Search (your menu, Look): what was typed becomes the list's own search (listText) and the
  // Status filter its chip (listChip), so both looks filter alike; Schedule, Used by, Effective and Currency are the
  // column filters only the Redwood table applies (rwCols, applyChain). Smart Search applies a picked filter as its
  // list closes (Oracle's own behaviour, as in Old).
  const COLS = ['name', 'usedBy', 'dates', 'currency'];

  class rwFilterChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const c = RW.readCriterion(v.rwCriterion);
      const cols = {};
      COLS.forEach((k) => { cols[k] = c.fields[k] || ''; });
      v.listText = c.text;
      v.listChip = c.fields.chip || 'all';
      v.rwCols = cols;
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return rwFilterChain;
});
