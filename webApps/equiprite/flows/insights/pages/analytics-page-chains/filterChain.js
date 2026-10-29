define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/analyticsData',
], (ActionChain, Actions, analyticsData) => {
  'use strict';

  // Search box and chips (the old OnAnalyticsSmartSearchChangedChain). The old page's smart search produced a
  // criterion; here the search text and chip picks build the same criterion shape ($functions.criterion), and from
  // there it is the old chain: skip when nothing changes for THIS endpoint (searchSignature), debounce typing so
  // the last keystroke wins, reload, bump the filter version.
  const DEBOUNCE_MS = 300;
  let timer = null;
  let seq = 0;

  class filterChain extends ActionChain {
    /**
     * @param {Object} context
     * @param {Object} params
     * @param {string} [params.text]  search text (typing)
     * @param {string} [params.field] chip field (className, unitStatus, lineStatus, invOrgId)
     * @param {string} [params.value] chip value; the picked chip again, or empty, clears the field
     * @param {boolean} [params.clear] clear search and chips
     */
    async run(context, { text, field, value, clear }) {
      const { $page } = context;
      const v = $page.variables;
      const typed = text !== undefined && text !== null;
      if (clear) {
        v.searchText = '';
        v.picks = {};
      }
      if (typed) {
        v.searchText = String(text);
      }
      if (field) {
        const picks = Object.assign({}, v.picks || {});
        if (value === undefined || value === null || value === '' || (picks[field] != null && String(picks[field]) === String(value))) {
          delete picks[field];
        } else {
          picks[field] = String(value);
        }
        v.picks = picks;
      }

      const tab = v.analyticsActiveTab;
      const criterion = $page.functions.criterion(v.searchText, v.picks);
      v.analyticsFilterCriterion = criterion;

      const sig = analyticsData.searchSignature(tab, criterion);
      if (sig === v.analyticsLastQuerySignature) {
        return;
      }
      v.analyticsLastQuerySignature = sig;

      const mySeq = ++seq;
      if (typed) {
        if (timer) clearTimeout(timer);
        await new Promise((resolve) => { timer = setTimeout(resolve, DEBOUNCE_MS); });
        if (mySeq !== seq) {
          return;
        }
      }

      await Actions.callChain(context, { chain: 'loadReportChain' });
      v.analyticsFilterVersion = (v.analyticsFilterVersion || 0) + 1;
    }
  }

  return filterChain;
});
