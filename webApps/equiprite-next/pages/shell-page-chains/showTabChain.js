define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/tabs',
  'resources/js/shellTabs',
], (ActionChain, Actions, tabs, shellTabs) => {
  'use strict';

  class showTabChain extends ActionChain {
    async run(context, { id }) {
      if (!id) return;
      context.$page.variables.tabMenuOpen = false;
      await shellTabs.apply(context, Actions, tabs.show(shellTabs.state(context), id));
    }
  }

  return showTabChain;
});
