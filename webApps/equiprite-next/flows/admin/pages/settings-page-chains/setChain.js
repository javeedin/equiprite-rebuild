define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The setting search, the history search, "show more" history, an export menu, or a jump to a section.
  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const v = context.$page.variables;
      if (field === 'exportOpen') { v.exportOpen = v.exportOpen === value ? '' : String(value || ''); return; }
      if (field === 'histLimit') { v.histLimit += 50; return; }
      if (field === 'jump') {
        const el = typeof document !== 'undefined' ? document.getElementById('st-' + value) : null;
        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (field === 'q') v.q = String(value || '');
      else if (field === 'hq') { v.hq = String(value || ''); v.histLimit = 50; }
      else return;
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return setChain;
});
