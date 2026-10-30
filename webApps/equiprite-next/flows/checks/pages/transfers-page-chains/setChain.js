define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // A chip, the kind, the search, "show more" or the export menu changed.
  const PAGE = 100;

  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const v = context.$page.variables;
      if (field === 'exportOpen') { v.exportOpen = value === 'toggle' ? !v.exportOpen : !!value; return; }
      if (field === 'limit') { v.limit += PAGE; return; }
      if (field === 'text') v.text = String(value || '');
      else if (field === 'chip') v.chip = value || 'all';
      else if (field === 'kind') v.kind = value || 'all';
      else return;
      v.limit = PAGE;
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return setChain;
});
