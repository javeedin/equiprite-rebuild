define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Tells the shell which menu item this page stands for, on entry and whenever the menu opens another item here.
  class laterEnterChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      $application.variables.laterNavId = $page.variables.navId || '';
    }
  }

  return laterEnterChain;
});
