define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Tick boxes on requests to decide: one (its key), every one shown ('all') or none ('none'). Ticking opens no
  // request; the bulk bar says what the ticked requests add up to.
  class tickChain extends ActionChain {
    async run(context, { id, checked }) {
      const v = context.$page.variables;
      const on = checked === true || checked === 'true';
      if (id === 'none') {
        v.selectedIds = [];
      } else if (id === 'all') {
        v.selectedIds = on ? (v.shown || []).filter((r) => r.kind === 'decide').map((r) => r.key) : [];
      } else if (id !== undefined && id !== null && id !== '') {
        const rest = (v.selectedIds || []).filter((s) => String(s) !== String(id));
        v.selectedIds = on ? rest.concat([String(id)]) : rest;
      }
      if (!v.selectedIds.length) v.bulk = { mode: '', reason: '', error: '' };
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return tickChain;
});
