define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The search box is focused (a click, Ctrl+K): the words still in it show their matches again, and what the global
  // search looks in is read in the background the first time (and once it is a few minutes old: searchLoadChain).
  class searchFocusChain extends ActionChain {
    async run(context) {
      const pv = context.$page.variables;
      if ((pv.query || '').trim() && !pv.showResults) await Actions.callChain(context, { chain: 'searchChain', params: { keep: true } });
      await Actions.callChain(context, { chain: 'searchLoadChain', params: {} });
    }
  }

  return searchFocusChain;
});
