define([
  'vb/action/actionChain',
  'resources/js/commercialRedwood',
], (ActionChain, RW) => {
  'use strict';

  // Smart Search over a schedule's rates (Redwood, in Oracle's header): what was typed and each filter picked narrow the
  // rates table (rwRateCols; commercialRedwood.rateLineKeys). Smart Search applies a picked filter as its list closes,
  // as Oracle does in Old.
  class rwRateFilterChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const c = RW.readCriterion(v.rwRateCriterion);
      const cols = { text: c.text };
      RW.RATE_LINE_FIELDS.forEach((f) => { cols[f] = c.fields[f] || ''; });
      v.rwRateCols = cols;
    }
  }

  return rwRateFilterChain;
});
