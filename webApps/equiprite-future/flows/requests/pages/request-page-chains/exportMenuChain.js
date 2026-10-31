define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // Opens or closes the export menu.
  class exportMenuChain extends ActionChain {
    async run(context) {
      context.$page.variables.exportOpen = !context.$page.variables.exportOpen;
    }
  }

  return exportMenuChain;
});
