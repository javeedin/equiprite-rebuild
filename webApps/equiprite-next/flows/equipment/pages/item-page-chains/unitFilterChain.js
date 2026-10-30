define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // The units search box: narrows the units already loaded (filterUnits in the page module).
  class unitFilterChain extends ActionChain {
    async run(context, { text }) {
      context.$page.variables.unitFilter = text == null ? '' : String(text);
    }
  }

  return unitFilterChain;
});
