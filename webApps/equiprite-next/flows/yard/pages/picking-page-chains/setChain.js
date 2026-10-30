define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // A stage tile (again: every stage), a yard, the search, a section shown or hidden, or an export menu.
  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const v = context.$page.variables;
      if (field === 'exportOpen') { v.exportOpen = v.exportOpen === value ? '' : (value || ''); return; }
      v.exportOpen = '';
      if (field === 'text') v.text = String(value || '');
      if (field === 'stage') {
        v.stage = !value || value === v.stage ? 'all' : value;
        // A tile for pieces in a hidden section shows that section.
        if (v.stage === 'shipped' && v.collapsed && v.collapsed.done) v.collapsed = Object.assign({}, v.collapsed, { done: false });
      }
      if (field === 'yard') v.yard = value || 'all';
      if (field === 'collapse' && value) v.collapsed = Object.assign({}, v.collapsed, { [value]: !(v.collapsed || {})[value] });
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return setChain;
});
