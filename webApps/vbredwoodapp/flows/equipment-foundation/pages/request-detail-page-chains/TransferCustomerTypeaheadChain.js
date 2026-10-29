define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Server-side typeahead for the Transfer drawer's Internal Customer field.
   * Mirrors CustomerTypeaheadChain exactly, scoped to
   * transferInternalCustomerSearchQ/transferInternalCustomerSDP.
   */
  class TransferCustomerTypeaheadChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const rawText = (params && params.searchValue != null) ? String(params.searchValue) : '';
      const minChars = 2;
      const searchField = 'Customer';

      let filterQ = '';

      if (rawText.length === 0) {
        filterQ = searchField + " LIKE '*'";
      } else if (rawText.length >= minChars) {
        const resolved = await $page.functions.debounce('transferCustomerSearch', rawText, 200);
        if (resolved) {
          filterQ = searchField + " LIKE '*" + resolved + "*'";
        }
      }

      if (filterQ) {
        $page.variables.transferInternalCustomerSearchQ = filterQ;
        await Actions.resetVariables(context, { variables: ['$page.variables.transferInternalCustomerSDP'] });
      }
    }
  }

  return TransferCustomerTypeaheadChain;
});
