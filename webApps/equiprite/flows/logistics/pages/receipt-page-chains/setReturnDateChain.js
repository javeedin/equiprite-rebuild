define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // The Actual return date field (old page: oj-input-date bound to actualReturnDate). Blank means today;
  // AcceptReturnLinesChain turns it into the YYYY-MM-DDT00:00:00Z it sends.
  class setReturnDateChain extends ActionChain {
    async run(context, { value }) {
      context.$page.variables.actualReturnDate = value ? String(value).slice(0, 10) : '';
    }
  }

  return setReturnDateChain;
});
