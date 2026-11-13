define(['vb/action/actionChain', 'vb/action/actions'], (ActionChain, Actions) => {
  'use strict';

  // Escape or a click outside: close whichever popup is open.
  class dismissChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      v.bellOpen = false;
      v.profileOpen = false;
      v.cartOpen = false;
      v.phoneOpen = false;
      v.qaOpen = false;
      v.tabMenuOpen = false;
      v.showResults = false;
      v.navOpen = false;
      if (v.jiraOpen) await Actions.callChain(context, { chain: 'jiraFeedChain', params: { act: 'close', key: '' } });
    }
  }

  return dismissChain;
});
