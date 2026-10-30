define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // A filter, the view, the source, "show more" or the export menu changed.
  const PAGE = 100;

  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const v = context.$page.variables;
      if (field === 'exportOpen') { v.exportOpen = value === 'toggle' ? !v.exportOpen : !!value; return; }
      if (field === 'limit') { v.limit += PAGE; return; }
      if (field === 'text') v.text = String(value || '');
      if (field === 'stage') v.stage = value || 'all';
      if (field === 'source') v.source = v.source === value ? '' : (value || '');
      v.limit = PAGE;
      await Actions.callChain(context, { chain: 'applyChain', params: field === 'view' ? { view: value || 'list' } : {} });
    }
  }

  return setChain;
});
