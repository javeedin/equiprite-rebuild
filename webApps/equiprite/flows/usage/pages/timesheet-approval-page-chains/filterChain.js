define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Week, status, search, compare and the ticks. A week change clears the ticks and any adjustment (they belong to
  // the week on screen) and reads the new week's cost so far.
  class filterChain extends ActionChain {
    async run(context, { action, key, value }) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      v.actionError = '';
      if (action === 'week') {
        if (!value || value === v.weekKey) return;
        v.weekKey = String(value);
        v.weekDays = fns.weekDays(v.weekKey);
        v.picked = {};
        v.adjust = null;
        v.confirm = '';
        await Actions.callChain(context, { chain: 'loadCostChain' });
      } else if (action === 'status') {
        v.statusKey = value ? String(value) : 'SUBMITTED';
        v.picked = {};
        v.confirm = '';
      } else if (action === 'text') {
        v.searchText = value == null ? '' : String(value);
      } else if (action === 'compare') {
        v.compare = value === true || value === 'true';
      } else if (action === 'pick') {
        const picked = Object.assign({}, v.picked || {});
        if (value === true || value === 'true') picked[key] = true; else delete picked[key];
        v.picked = picked;
      } else if (action === 'pickAll') {
        const picked = {};
        if (value === true || value === 'true') {
          fns.visible(v.rowsAll, v.weekKey, v.statusKey, v.searchText)
            .filter((r) => fns.canAct(r, v.readOnly)).forEach((r) => { picked[r.key] = true; });
        }
        v.picked = picked;
        // Redraw the rows so boxes the user ticked by hand follow the new state.
        v.rowsAll = (v.rowsAll || []).map((r) => Object.assign({}, r));
      }
    }
  }

  return filterChain;
});
