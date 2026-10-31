define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The search, the chip (all pages, changed, locked) or the export menu.
  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const v = context.$page.variables;
      if (field === 'exportOpen') { v.exportOpen = value === 'toggle' ? !v.exportOpen : !!value; return; }
      if (field === 'text') v.text = String(value || '');
      else if (field === 'only') v.only = value === 'changed' || value === 'locked' ? value : 'all';
      else return;
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return setChain;
});
