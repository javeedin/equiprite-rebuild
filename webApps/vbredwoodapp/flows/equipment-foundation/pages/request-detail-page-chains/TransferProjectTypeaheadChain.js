define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Server-side typeahead for the Transfer drawer's destination-Project field.
   *
   * Exact mirror of AssignProjectTypeaheadChain, scoped to its own
   * transferProjectSearchQ/transferProjectsSDP pair so picking a destination
   * project for a transfer never disturbs (or races) the Assign Project
   * drawer's own staged search, if both happen to be touched in the same
   * session.
   */
  class TransferProjectTypeaheadChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const rawText = (params && params.searchValue != null) ? String(params.searchValue) : '';
      const minChars = 2;
      const searchField = 'ProjectName';

      let filterQ = '';

      if (rawText.length === 0) {
        filterQ = searchField + " LIKE '*'";
      } else if (rawText.length >= minChars) {
        const resolved = await $page.functions.debounce('transferProjectSearch', rawText, 200);
        if (resolved) {
          filterQ = searchField + " LIKE '*" + resolved + "*'";
        }
      }

      if (filterQ) {
        $page.variables.transferProjectSearchQ = filterQ;
        await Actions.resetVariables(context, { variables: ['$page.variables.transferProjectsSDP'] });
      }
    }
  }

  return TransferProjectTypeaheadChain;
});
