define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // The Export menu: opens or closes.
  class toggleExportChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      v.exportOpen = !v.exportOpen;
    }
  }

  return toggleExportChain;
});
