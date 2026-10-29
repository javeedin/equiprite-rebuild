define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Tick boxes on To approve: one request (its id), every visible request ('all') or none ('none').
  class toggleRowChain extends ActionChain {
    async run(context, { id, checked }) {
      const { $page } = context;
      const v = $page.variables;
      const on = checked === true || checked === 'true';
      if (id === 'none') {
        v.selectedIds = [];
      } else if (id === 'all') {
        v.selectedIds = on ? (v.visibleRows || []).map((r) => r.request_id) : [];
      } else if (id !== undefined && id !== null && id !== '') {
        const rest = (v.selectedIds || []).filter((s) => String(s) !== String(id));
        v.selectedIds = on ? rest.concat([id]) : rest;
      }
      await Actions.callChain(context, { chain: 'applyFilterChain' });
    }
  }

  return toggleRowChain;
});
