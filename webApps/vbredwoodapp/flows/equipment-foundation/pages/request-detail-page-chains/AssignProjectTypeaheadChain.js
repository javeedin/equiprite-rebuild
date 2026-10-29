define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Server-side typeahead for the Assign Project drawer's Project field.
   *
   * Rewrite the Fusion q= predicate held in projectSearchQ, then reset the SDP so
   * it re-fetches. The search is SERVER-side — assignProjectsSDP binds q= to this
   * variable — because the pod holds far more projects than any client-side filter
   * over a single fetched page could cover.
   *
   * This was copied from customer-portal project-create-request-page-chains/
   * ProjectTypeaheadChain.js. That chain was deleted when the create-request
   * Project LOV was cut down to a 3-row demo allow-list, then restored when the
   * allow-list was removed — so the two surfaces once again resolve projects from
   * the SAME set (every project on the pod, searched server-side via q=).
   * Note the Transfer drawer on this page still has its own separate allow-list
   * (transferProjectsArray) — that one was left in place.
   *
   * Typing is debounced (200ms) via the page module's debounce(), which resolves
   * to null for every call superseded by a later keystroke; only the last one
   * through issues a fetch.
   */
  class AssignProjectTypeaheadChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const rawText = (params && params.searchValue != null) ? String(params.searchValue) : '';
      const minChars = 2;
      const searchField = 'ProjectName';

      let filterQ = '';

      if (rawText.length === 0) {
        filterQ = searchField + " LIKE '*'";
      } else if (rawText.length >= minChars) {
        const resolved = await $page.functions.debounce('assignProjectSearch', rawText, 200);
        if (resolved) {
          filterQ = searchField + " LIKE '*" + resolved + "*'";
        }
      }

      if (filterQ) {
        $page.variables.projectSearchQ = filterQ;
        await Actions.resetVariables(context, { variables: ['$page.variables.assignProjectsSDP'] });
      }
    }
  }

  return AssignProjectTypeaheadChain;
});
