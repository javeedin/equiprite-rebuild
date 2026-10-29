define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  const LISTS = { class: 'classes', project: 'projects', yard: 'yards' };
  const DEFAULT_LIMIT = 60;

  /**
   * The filter row: search text, the class / project / yard choices (any of the picked values), "Conflicts only",
   * opening a filter's choices, and clearing one filter or all of them.
   */
  class setFilterChain extends ActionChain {
    /**
     * @param {Object} context
     * @param {Object} params
     * @param {string} params.kind  text | class | project | yard | conflicts | open | clear
     * @param {string} [params.value] the text, the picked value, the filter to open, or the filter to clear ('' = all)
     */
    async run(context, { kind, value }) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      const f = Object.assign(fns.emptyFilters(), v.filters || {});
      const val = value == null ? '' : String(value);
      if (kind === 'open') {
        v.openFilter = v.openFilter === val ? '' : val;
        return;
      }
      if (kind === 'text') {
        f.text = val;
      } else if (LISTS[kind]) {
        f[LISTS[kind]] = fns.toggle(f[LISTS[kind]], val);
      } else if (kind === 'conflicts') {
        f.conflictsOnly = !f.conflictsOnly;
      } else if (kind === 'clear') {
        if (LISTS[val]) {
          f[LISTS[val]] = [];
        } else {
          Object.assign(f, fns.emptyFilters(), { text: f.text });
        }
      } else {
        return;
      }
      v.filters = f;
      v.listLimit = DEFAULT_LIMIT;
      await Actions.callChain(context, { chain: 'applyFilterChain' });
    }
  }

  return setFilterChain;
});
