define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Server-side typeahead for the split drawer's Project field.
   *
   * Clone of request-detail-page-chains/AssignProjectTypeaheadChain so every
   * Project LOV in the app behaves the same way: rewrite the Fusion q= predicate
   * held in splitProjectSearchQ, then reset the SDP so it re-fetches.
   *
   * SERVER-side, not a client filter, because the pod holds 7,259 projects --
   * far more than one fetched page could cover.
   *
   * On the debounce: a call SUPERSEDED inside the window never settles at all
   * (the next call clears its timer first), so this chain simply stops at the
   * await for every keystroke the user has typed past. That is the intended
   * "drop this keystroke" -- do NOT add an else branch expecting a null, and do
   * not put cleanup after the await.
   */
  class splitProjectTypeaheadChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const rawText = (params && params.searchValue != null) ? String(params.searchValue) : '';
      const minChars = 2;
      const searchField = 'ProjectName';

      let filterQ = '';

      if (rawText.length === 0) {
        filterQ = searchField + " LIKE '*'";
      } else if (rawText.length >= minChars) {
        const resolved = await $page.functions.debounce('splitProjectSearch', rawText, 200);
        if (resolved) {
          filterQ = searchField + " LIKE '*" + resolved + "*'";
        }
      }

      if (filterQ) {
        $page.variables.splitProjectSearchQ = filterQ;
        await Actions.resetVariables(context, { variables: ['$page.variables.splitProjectsSDP'] });
      }
    }
  }

  return splitProjectTypeaheadChain;
});
