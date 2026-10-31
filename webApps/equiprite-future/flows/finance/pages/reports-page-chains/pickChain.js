define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // Opens or closes a report's export menu (exportOpen: the same one again closes it).
  class pickChain extends ActionChain {
    async run(context, { field, value }) {
      const pv = context.$page.variables;
      if (field === 'exportOpen') pv.exportOpen = pv.exportOpen === value ? '' : (value || '');
    }
  }

  return pickChain;
});
