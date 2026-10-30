define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/equipmentMaster',
], (ActionChain, Actions, em) => {
  'use strict';

  // A column header: sort by it, or turn the order round when it is already the sort.
  class sortChain extends ActionChain {
    async run(context, { key }) {
      const v = context.$page.variables;
      if (!key) return;
      if (v.sortKey === key) v.sortDir = v.sortDir === 'asc' ? 'desc' : 'asc';
      else { v.sortKey = key; v.sortDir = em.firstDir(key); }
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return sortChain;
});
