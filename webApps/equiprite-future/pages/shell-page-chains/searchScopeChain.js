define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The scope row over the matches: Everything | Screens | Requests | Equipment. Typing carries on in the box.
  class searchScopeChain extends ActionChain {
    async run(context, { scope }) {
      const pv = context.$page.variables;
      pv.search = Object.assign({}, pv.search, { scope: scope || 'all', expanded: '' });
      await Actions.callChain(context, { chain: 'searchChain', params: {} });
      const box = document.getElementById('nxCommand');
      if (box) box.focus();
    }
  }

  return searchScopeChain;
});
