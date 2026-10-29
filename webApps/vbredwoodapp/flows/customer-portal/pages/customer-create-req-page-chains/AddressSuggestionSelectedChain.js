define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // A typeahead suggestion was picked (oj-input-search on-oj-value-action). The
  // chosen candidate's parsed components + coords ride along on the item, so we
  // hand the whole object to the module's applySuggestion — it moves the map pin
  // and fires locationResolved, which fills the drawer's address fields. No
  // second geocode / top-result guessing.
  class AddressSuggestionSelectedChain extends ActionChain {
    async run(context, { data } = {}) {
      const { $page } = context;
      if (data && $page.functions && typeof $page.functions.applySuggestion === 'function') {
        $page.functions.applySuggestion(data);
      }
    }
  }

  return AddressSuggestionSelectedChain;
});
