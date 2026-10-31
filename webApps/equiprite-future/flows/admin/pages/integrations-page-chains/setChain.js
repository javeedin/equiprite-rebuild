define([
  'vb/action/actionChain',
  'resources/js/integrationsView',
], (ActionChain, view) => {
  'use strict';

  // The exception queue's integration chip (picked again = all), or which export menu is open.
  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const v = context.$page.variables;
      if (field === 'exportOpen') { v.exportOpen = v.exportOpen === value ? '' : String(value || ''); return; }
      if (field !== 'integ') return;
      v.integ = v.integ === value ? '' : String(value || '');
      v.exportOpen = '';
      v.m = view.view(v.raw, Date.now(), { integ: v.integ });
    }
  }

  return setChain;
});
