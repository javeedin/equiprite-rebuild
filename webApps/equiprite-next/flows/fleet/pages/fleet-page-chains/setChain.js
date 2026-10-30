define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // A filter, the view or the export menu.
  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const v = context.$page.variables;
      if (field === 'exportOpen') { v.exportOpen = value === 'toggle' ? !v.exportOpen : !!value; return; }
      if (field === 'text') v.text = value ? '' + value : '';
      if (field === 'lane') {
        if (value === 'tight') { v.tight = !v.tight; v.lane = 'all'; } else { v.tight = false; v.lane = v.lane === value ? 'all' : (value || 'all'); }
      }
      if (field === 'cls') v.cls = v.cls === value ? '' : (value || '');
      if (field === 'yard') v.yard = v.yard === value ? '' : (value || '');
      await Actions.callChain(context, { chain: 'applyChain', params: field === 'view' ? { view: value || 'board' } : {} });
    }
  }

  return setChain;
});
