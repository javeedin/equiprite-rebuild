define([
  'vb/action/actionChain',
  'resources/js/agreementRules',
], (ActionChain, A) => {
  'use strict';

  // What the list shows: the chip and the search (New's filterRows), in the chosen order; the chips' counts; the
  // summary. Nothing is read again.
  class applyChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const rows = v.rows || [];
      v.chips = A.chips(rows);
      v.summary = A.summary(rows);
      v.shown = A.sort(A.filterRows(rows, v.text, v.chip), v.sortKey, v.sortDir);
    }
  }

  return applyChain;
});
