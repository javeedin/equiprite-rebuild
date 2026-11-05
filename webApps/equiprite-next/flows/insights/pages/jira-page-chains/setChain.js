define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // A plain page setting: the JQL as typed, the breakdown shown, the Export menu.
  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const v = context.$page.variables;
      if (field === 'jql') v.jql = String(value || '');
      else if (field === 'tab') v.tab = String(value || 'epics');
      else if (field === 'exportOpen') v.exportOpen = value === true || value === 'true';
    }
  }

  return setChain;
});
