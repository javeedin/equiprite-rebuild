define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // A tick box in the Direct Return results (old page: the page module's toggleDirectRowIndex bound to the
  // grid cell). By row key, (line, unit), never by position: the results change on every search.
  class toggleDirectRowChain extends ActionChain {
    async run(context, { rowKey }) {
      const { $page } = context;
      if (rowKey) {
        $page.functions.toggleDirectRow(String(rowKey), $page);
      }
    }
  }

  return toggleDirectRowChain;
});
