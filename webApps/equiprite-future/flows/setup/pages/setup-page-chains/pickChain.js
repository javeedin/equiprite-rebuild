define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // A pick on the page: the section shown (section), or an export menu (exportOpen: the same one again closes it).
  class pickChain extends ActionChain {
    async run(context, { field, value }) {
      const pv = context.$page.variables;
      if (field === 'exportOpen') {
        pv.exportOpen = pv.exportOpen === value ? '' : (value || '');
      } else if (field === 'section' && value) {
        pv.section = value;
        pv.exportOpen = '';
      }
    }
  }

  return pickChain;
});
