define([
  'vb/action/actionChain',
  'vb/action/actions'
], (ActionChain, Actions) => {
  'use strict';

  class baseQueryChangedChain extends ActionChain {
    async run(context, params) {
      const { $fragment } = context;
      const baseQ = params.value || '';
      const searchField = $fragment.variables.searchField || '';
      const filterQ = searchField + " LIKE '*'";

      $fragment.variables.searchQ = baseQ ? "(" + baseQ + ") AND (" + filterQ + ")" : filterQ;
      
      // Also clear out the current selection if the baseQuery changed (like if the parent Project changes)
      // Though that is technically up to the caller to clear the selectedKey, it's safer.
      // But we will definitely reset the SDP to fetch new options.
      await Actions.resetVariables(context, { variables: ['$fragment.variables.suggestionsSDP'] });
    }
  }

  return baseQueryChangedChain;
});
