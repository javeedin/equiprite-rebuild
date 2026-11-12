define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // The Activity tab in the item's drawer: all | comments | history | worklog.
  class actTabChain extends ActionChain {
    async run(context, { tab }) {
      context.$page.variables.actTab = /^(all|comments|history|worklog)$/.test(String(tab)) ? String(tab) : 'all';
    }
  }
  return actTabChain;
});
