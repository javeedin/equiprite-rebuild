define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // The request search, or a card's export menu (a second click on the same one closes it).
  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const v = context.$page.variables;
      if (field === 'requestText') v.requestText = value == null ? '' : String(value);
      if (field === 'exportOpen') v.exportOpen = v.exportOpen === value ? '' : String(value || '');
    }
  }

  return setChain;
});
