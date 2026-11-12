define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // A plain page setting: the JQL as typed, the breakdown shown, the Export menu.
  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const v = context.$page.variables;
      if (field === 'jql') v.jql = String(value || '');
      else if (field === 'tab') v.tab = String(value || 'sprints');
      else if (field === 'exportOpen') v.exportOpen = value === true || value === 'true';
      else if (field === 'actTab') v.actTab = /^(all|comments|history|worklog)$/.test(String(value)) ? String(value) : 'all';
    }
  }

  return setChain;
});
