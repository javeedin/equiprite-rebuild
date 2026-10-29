define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  /** Mirrors AddressSuggestionSelectedChain. */
  class TransferAddressSuggestionSelectedChain extends ActionChain {
    async run(context, { data } = {}) {
      const { $page } = context;
      if (data && $page.functions && typeof $page.functions.applySuggestion === 'function') {
        $page.functions.applySuggestion(data);
      }
    }
  }

  return TransferAddressSuggestionSelectedChain;
});
