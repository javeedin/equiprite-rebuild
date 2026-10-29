define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Release the PDF object URL on page exit. Without this each visit leaks the
  // decoded blob (a few MB per quote) for the life of the browser tab.
  class ProjectQuoteExitChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const url = $page.variables.quotePdfUrl;
      if (url && url.indexOf('blob:') === 0) {
        try {
          URL.revokeObjectURL(url);
        } catch (e) {
          console.warn('[ProjectQuoteExitChain] revokeObjectURL failed:', e);
        }
      }
    }
  }

  return ProjectQuoteExitChain;
});
