define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // A filter, the view, the source, "show more", the export menu, or the look (ui: Redwood or Current, kept in this
  // browser; the Redwood look is the list, so it shows the list).
  const PAGE = 100;
  const UI_KEY = 'equiprite-next:ui:requests';

  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const v = context.$page.variables;
      if (field === 'exportOpen') { v.exportOpen = value === 'toggle' ? !v.exportOpen : !!value; return; }
      if (field === 'limit') { v.limit += PAGE; return; }
      if (field === 'ui') {
        const ui = value === 'redwood' ? 'redwood' : 'current';
        try { window.localStorage.setItem(UI_KEY, ui); } catch (e) { /* no storage: this visit only */ }
        if (ui === v.ui) return;
        await Actions.callChain(context, { chain: 'applyChain', params: ui === 'redwood' ? { view: 'list' } : {} });
        // The switch that asked is inside the look being hidden: let it finish its own event first.
        await new Promise((r) => setTimeout(r, 0));
        if (ui === 'redwood') v.rwMounted = true;
        v.ui = ui;
        return;
      }
      if (field === 'text') v.text = String(value || '');
      if (field === 'stage') v.stage = value || 'all';
      if (field === 'source') v.source = v.source === value ? '' : (value || '');
      v.limit = PAGE;
      await Actions.callChain(context, { chain: 'applyChain', params: field === 'view' ? { view: value || 'list' } : {} });
    }
  }

  return setChain;
});
