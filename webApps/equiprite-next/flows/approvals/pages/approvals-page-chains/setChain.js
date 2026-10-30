define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // A filter, "show more", the export menu, a reason being typed, or a result dismissed.
  const PAGE = 60;

  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const v = context.$page.variables;
      if (field === 'exportOpen') { v.exportOpen = value === 'toggle' ? !v.exportOpen : !!value; return; }
      if (field === 'limit') { v.limit += PAGE; return; }
      if (field === 'reason') { v.reason = String(value || ''); if (v.reason.trim()) v.formError = ''; return; }
      if (field === 'bulkReason') { v.bulk = Object.assign({}, v.bulk, { reason: String(value || ''), error: '' }); return; }
      if (field === 'result') { v.result = null; return; }
      if (field === 'bulkResult') { v.bulkResult = null; return; }
      if (field === 'text') v.text = String(value || '');
      if (field === 'stage') v.stage = value || 'all';
      if (field === 'source') v.source = v.source === value ? '' : (value || '');
      v.limit = PAGE;
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return setChain;
});
