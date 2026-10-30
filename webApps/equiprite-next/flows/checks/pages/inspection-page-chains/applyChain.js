define([
  'vb/action/actionChain',
  'resources/js/inspectionQueue',
], (ActionChain, Q) => {
  'use strict';

  // What the queue shows: New's queue (asked for or everything waiting) in this screen's words, the chips, the chip
  // and the search applied, the summary. Worked out first, then set, so the list never sees half of a change.
  class applyChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const entries = Q.entries(v.lines, v.matrix, v.scope, Date.now());
      const chips = Q.chips(entries);
      const shown = Q.filter(entries, v.chip, v.text);
      v.entries = entries;
      v.chips = chips;
      v.summary = Q.summary(entries);
      v.shown = shown;
    }
  }

  return applyChain;
});
