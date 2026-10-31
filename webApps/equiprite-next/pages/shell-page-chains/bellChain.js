define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Opens or closes the bell; opening checks again when the last check is over a minute old.
  const FRESH_MS = 60000;

  class bellChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.bellOpen = !$page.variables.bellOpen;
      $page.variables.tabMenuOpen = false;
      $page.variables.profileOpen = false;
      $page.variables.cartOpen = false;
      $page.variables.phoneOpen = false;
      $page.variables.qaOpen = false;
      if ($page.variables.bellOpen && (!this.constructor.lastAt || Date.now() - this.constructor.lastAt > FRESH_MS)) {
        this.constructor.lastAt = Date.now();
        await Actions.callChain(context, { chain: 'loadAlertsChain' });
      }
    }
  }

  return bellChain;
});
