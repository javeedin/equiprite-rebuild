define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // The Export menu: opens or closes it, or (with what) picks which list it writes: units, documents or work orders.
  const WHAT = ['units', 'docs', 'wos'];

  class menuChain extends ActionChain {
    async run(context, params) {
      const v = context.$page.variables;
      const what = params && params.what;
      if (what && WHAT.indexOf(what) !== -1) { v.exportWhat = what; return; }
      v.exportOpen = !v.exportOpen;
    }
  }

  return menuChain;
});
