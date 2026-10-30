define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // A chip, the search, "asked for / everything waiting" or the export menu changed.
  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const v = context.$page.variables;
      if (field === 'exportOpen') { v.exportOpen = value === 'toggle' ? !v.exportOpen : !!value; return; }
      if (field === 'text') v.text = String(value || '');
      else if (field === 'chip') v.chip = value || 'all';
      else if (field === 'scope') v.scope = value === 'all' ? 'all' : 'required';
      else return;
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return setChain;
});
