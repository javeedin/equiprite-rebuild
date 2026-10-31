define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // A stage tile (again: every stage), a yard, the search, a section shown or hidden, an export menu; the return date;
  // the unit search box and a found unit's tick (never pre-filled).
  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const v = context.$page.variables;
      if (field === 'exportOpen') { v.exportOpen = v.exportOpen === value ? '' : (value || ''); return; }
      if (field === 'returnDate') { v.returnDate = String(value || '').slice(0, 10); return; }
      if (field === 'findQuery') { v.findQuery = String(value || ''); return; }
      if (field === 'foundTick') {
        const key = String(value || '');
        if (!key) return;
        const list = (v.foundTicks || []).slice();
        const at = list.indexOf(key);
        if (at === -1) list.push(key);
        else list.splice(at, 1);
        v.foundTicks = list;
        v.findBanner = { type: '', text: '' };
        return;
      }
      v.exportOpen = '';
      if (field === 'text') v.text = String(value || '');
      if (field === 'stage') {
        v.stage = !value || value === v.stage ? 'all' : value;
        // On site includes pieces due back later: a tile shows what it counts.
        if (v.stage === 'site' && v.collapsed && v.collapsed.later) v.collapsed = Object.assign({}, v.collapsed, { later: false });
      }
      if (field === 'yard') v.yard = value || 'all';
      if (field === 'collapse' && value) v.collapsed = Object.assign({}, v.collapsed, { [value]: !(v.collapsed || {})[value] });
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return setChain;
});
