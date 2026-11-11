define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // The items table's column filters and sort. Variables are reassigned (new object) so the bound view re-evaluates.
  class gridChain extends ActionChain {
    async run(context, { act, field, value, col }) {
      const v = context.$page.variables;
      if (act === 'filter') {
        const f = Object.assign({}, v.itemF || {});
        f[field] = value;
        v.itemF = f;
        return;
      }
      // A click on a By-status / By-person / By-customer row: set that column's filter, or clear it if it is already picked.
      if (act === 'pick') {
        const f = Object.assign({}, v.itemF || {});
        f[field] = (f[field] === value) ? '' : value;
        v.itemF = f;
        return;
      }
      if (act === 'sort') {
        const cur = v.itemSort || { col: '', dir: 'asc' };
        v.itemSort = (cur.col === col) ? { col: col, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { col: col, dir: 'asc' };
        return;
      }
      if (act === 'clear') { v.itemF = {}; v.itemSort = { col: '', dir: 'asc' }; }
    }
  }

  return gridChain;
});
