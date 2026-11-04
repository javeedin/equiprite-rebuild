define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // The Redwood look's schedule detail: open an equipment's rates in Oracle's drawer (edit, a row or its Edit button),
  // close it (Done, Escape, a click outside), show only the rates below cost or every rate (only), or close the margin
  // banner for this schedule (banner).
  class rwRatesChain extends ActionChain {
    async run(context, { act, key }) {
      const v = context.$page.variables;
      if (act === 'edit') v.rwEditKey = String(key || '');
      else if (act === 'close') { if (v.rwEditKey) v.rwEditKey = ''; }
      else if (act === 'only') v.rwOnlyLow = !v.rwOnlyLow;
      else if (act === 'banner') v.rwBannerOff = String(v.selectedId || '');
    }
  }

  return rwRatesChain;
});
