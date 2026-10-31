define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';
  class menuChain extends ActionChain {
    async run(context) { context.$page.variables.exportOpen = !context.$page.variables.exportOpen; }
  }
  return menuChain;
});
