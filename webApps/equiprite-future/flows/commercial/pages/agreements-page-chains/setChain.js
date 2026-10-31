define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The search, a chip (the chip that is on goes back to All), a column header (sort by it, or turn the order round),
  // or the export menu.
  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const v = context.$page.variables;
      if (field === 'exportOpen') { v.exportOpen = value === 'toggle' ? !v.exportOpen : !!value; return; }
      if (field === 'text') v.text = String(value || '');
      if (field === 'chip') v.chip = value && value !== v.chip ? String(value) : 'all';
      if (field === 'sort') {
        if (v.sortKey === value) v.sortDir = v.sortDir === 'asc' ? 'desc' : 'asc';
        else { v.sortKey = String(value || 'newest'); v.sortDir = value === 'lines' ? 'desc' : 'asc'; }
      }
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return setChain;
});
