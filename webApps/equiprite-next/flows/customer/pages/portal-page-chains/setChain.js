define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // A view, a chip, a search, the sort, "show more" or the export menu changed.
  const PAGE = 50;
  const VIEWS = ['home', 'requests', 'equipment', 'invoices'];
  const FIELDS = ['reqGroup', 'reqText', 'eqChip', 'eqText', 'invChip', 'invText'];

  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const v = context.$page.variables;
      if (field === 'exportOpen') { v.exportOpen = value === 'toggle' ? !v.exportOpen : !!value; return; }
      if (field === 'limit') { v.limit += PAGE; return; }
      if (field === 'view') {
        if (VIEWS.indexOf(value) === -1 || (value === 'invoices' && !v.billingShown)) return;
        v.exportOpen = false;
        v.limit = PAGE;
        v.view = value;
        return;
      }
      if (field === 'sort') {
        if (v.reqSort === value) v.reqDir = v.reqDir === 'asc' ? 'desc' : 'asc';
        else { v.reqSort = value === 'dates' ? 'dates' : 'number'; v.reqDir = value === 'dates' ? 'asc' : 'desc'; }
      } else if (FIELDS.indexOf(field) !== -1) {
        v[field] = String(value == null ? '' : value);
      } else {
        return;
      }
      v.limit = PAGE;
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return setChain;
});
