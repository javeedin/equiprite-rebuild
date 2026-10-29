define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Server-side search for the "Attach to Existing Request" picker, backed
   * by the real eqp-v1/getEquipriteV1ViewsMyRequests view. Unlike the
   * Project/Customer typeaheads elsewhere on this page (which build a
   * Fusion ADF q= predicate like "Field LIKE '*text*'"), this endpoint's own
   * q param is already a plain case-insensitive substring match across
   * requestNumber/projectName/taskName/requestorName — so this chain just
   * debounces and passes the raw text straight through.
   */
  class TransferExistingRequestTypeaheadChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const rawText = (params && params.searchValue != null) ? String(params.searchValue) : '';

      const resolved = await $page.functions.debounce('transferExistingRequestSearch', rawText, 200);
      if (resolved == null) return; // superseded by a later keystroke

      $page.variables.transferExistingRequestSearchQ = resolved;
      await Actions.resetVariables(context, { variables: ['$page.variables.transferExistingRequestsSDP'] });
    }
  }

  return TransferExistingRequestTypeaheadChain;
});
