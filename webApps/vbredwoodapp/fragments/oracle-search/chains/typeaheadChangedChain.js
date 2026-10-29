define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class typeaheadChangedChain extends ActionChain {
    async run(context, params) {
      const { $fragment } = context;
      const rawText = (params && params.searchValue != null) ? String(params.searchValue) : '';
      const searchField = $fragment.variables.searchField || '';
      const minChars = Number($fragment.variables.minChars) || 2;

      const baseQ = $fragment.variables.baseQuery || '';
      let filterQ = '';

      if (rawText.length === 0) {
        filterQ = searchField + " LIKE '*'";
      } else if (rawText.length >= minChars) {
        const resolved = await $fragment.functions.debounce('fragmentSearch', rawText, 400);
        if (resolved) {
          filterQ = searchField + " LIKE '*" + resolved + "*'";
        }
      }

      if (filterQ) {
        $fragment.variables.searchQ = baseQ ? "(" + baseQ + ") AND (" + filterQ + ")" : filterQ;
        await Actions.resetVariables(context, { variables: ['$fragment.variables.suggestionsSDP'] });
      }
    }
  }

  return typeaheadChangedChain;
});
