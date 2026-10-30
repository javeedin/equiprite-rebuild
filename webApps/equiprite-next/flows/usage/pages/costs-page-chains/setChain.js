define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // The search, a chip, a column's sort, "show more" or the export menu changed.
  const PAGE = 100;

  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const v = context.$page.variables;
      if (field === 'exportOpen') { v.exportOpen = !v.exportOpen; return; }
      if (field === 'limit') { v.limit += PAGE; return; }
      if (field === 'text') v.text = String(value || '');
      if (field === 'chip') v.chip = value || 'all';
      if (field === 'sort') {
        if (v.sortKey === value) v.sortDir = v.sortDir === 'asc' ? 'desc' : 'asc';
        else { v.sortKey = value || 'request'; v.sortDir = value === 'end' ? 'asc' : 'desc'; }
      }
      v.limit = PAGE;
    }
  }

  return setChain;
});
