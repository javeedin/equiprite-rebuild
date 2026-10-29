define([
  'vb/action/actionChain',
  'vb/action/actions',
], (
  ActionChain,
  Actions,
) => {
  'use strict';

  // Updates equipmentSearchText from the oj-input-search raw-value-changed
  // event and then calls applyBannerFiltersChain to re-run the search.
  //
  // Why this is a JS chain (not the JSON it used to be): the previous
  // JSON definition used callChainAction to invoke applyBannerFiltersChain,
  // which only resolves to JSON-registered chains. applyBannerFiltersChain
  // is now a JS chain (we needed JS to assign the new provider back to
  // $page.variables.dataGridProvider after filtering), so the JSON
  // callChainAction couldn't find it — VBCS threw "Failed to create code
  // chain" during compile and the search did nothing.
  class onSearchTextChangedChain extends ActionChain {

    /**
     * @param {Object} context
     * @param {Object} params
     * @param {Object} params.event  the oj-raw-value-changed event
     */
    async run(context, { event } = {}) {
      const { $page } = context;

      const newValue = event && event.detail ? event.detail.value : '';
      $page.variables.equipmentSearchText = newValue;

      await Actions.callChain(context, { chain: 'applyBannerFiltersChain' });
    }
  }

  return onSearchTextChangedChain;
});
