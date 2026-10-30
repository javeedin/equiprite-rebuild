define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/tabs',
  'resources/js/shellTabs',
], (ActionChain, Actions, tabs, shellTabs) => {
  'use strict';

  // The tab strip's menu: toggle it, close the other tabs, or close them all (My work stays).
  class tabMenuChain extends ActionChain {
    async run(context, { action }) {
      const { $page } = context;
      if (action === 'toggle') {
        $page.variables.tabMenuOpen = !$page.variables.tabMenuOpen;
        $page.variables.bellOpen = false;
        return;
      }
      $page.variables.tabMenuOpen = false;
      const state = shellTabs.state(context);
      if (action === 'others') await shellTabs.apply(context, Actions, tabs.closeOthers(state, state.current));
      if (action === 'all') await shellTabs.apply(context, Actions, tabs.closeOthers(state, ''));
    }
  }

  return tabMenuChain;
});
