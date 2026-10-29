define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Opens or closes one line's invoices (the old page's toggleGroupChain, keyed by the line's index here rather than
  // a row id read off the clicked element). The array is replaced so the bindings update.
  class toggleGroupChain extends ActionChain {
    async run(context, { index }) {
      const { $page } = context;
      const at = Number(index);
      $page.variables.lines = ($page.variables.lines || []).map((l, i) => (i === at ? Object.assign({}, l, { expanded: !l.expanded }) : l));
    }
  }

  return toggleGroupChain;
});
