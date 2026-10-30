define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Closes the business-unit editor without saving (New EquipRite's closeEsDrawerChain).
  class closeEsDrawerChain extends ActionChain {
    async run(context) {
      context.$page.variables.isEsDrawerOpen = false;
    }
  }

  return closeEsDrawerChain;
});
