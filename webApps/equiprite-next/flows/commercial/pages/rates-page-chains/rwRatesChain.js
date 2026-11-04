define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // The Redwood look's schedule detail: open an equipment's rates in Oracle's drawer (edit, a row or its Edit button),
  // close it (Done, Escape, a click outside).
  class rwRatesChain extends ActionChain {
    async run(context, { act, key }) {
      const v = context.$page.variables;
      if (act === 'edit') v.rwEditKey = String(key || '');
      else if (act === 'close') { if (v.rwEditKey) v.rwEditKey = ''; }
    }
  }

  return rwRatesChain;
});
