define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // The export menu, the rental terms, and the draft's delete question (asked before anything is deleted).
  class uiChain extends ActionChain {
    async run(context, { what }) {
      const v = context.$page.variables;
      if (what === 'export') v.exportOpen = !v.exportOpen;
      else if (what === 'terms') v.showTerms = !v.showTerms;
      else if (what === 'deleteAsk') { v.ask = {}; v.deleteAsk = true; }
      else if (what === 'deleteCancel') v.deleteAsk = false;
    }
  }

  return uiChain;
});
