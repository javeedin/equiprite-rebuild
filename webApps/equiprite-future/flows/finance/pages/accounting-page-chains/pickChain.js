define(['vb/action/actionChain', 'vb/action/actions'], (ActionChain, Actions) => {
  'use strict';

  // A pick on the page: the company (le: a legal entity or GROUP), the journal's kind, or an export menu (exportOpen,
  // the same one again closes it). A new company starts the journal on All. The company and kind reload v.
  class pickChain extends ActionChain {
    async run(context, { field, value }) {
      const pv = context.$page.variables;
      const val = value || '';
      if (field === 'exportOpen') {
        pv.exportOpen = pv.exportOpen === val ? '' : val;
        return;
      }
      if (field === 'le') {
        pv.le = val;
        pv.kind = '';
      } else if (field === 'kind') {
        pv.kind = val;
      } else {
        return;
      }
      pv.exportOpen = '';
      await Actions.callChain(context, { chain: 'loadChain' });
    }
  }

  return pickChain;
});
