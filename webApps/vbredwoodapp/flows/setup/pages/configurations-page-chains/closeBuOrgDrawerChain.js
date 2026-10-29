define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Close the BU & Org Mapping "Add" drawer. Bound to the Cancel/Close buttons
  // and the drawer's on-opened-changed(false), so it must be idempotent.
  class closeBuOrgDrawerChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.isBuOrgDrawerOpen = false;
    }
  }

  return closeBuOrgDrawerChain;
});
