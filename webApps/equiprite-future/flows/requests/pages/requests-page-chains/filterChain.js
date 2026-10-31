define(['vb/action/actionChain', 'resources/js/future/fxPage', 'resources/js/future/fxRequests'], (ActionChain, fx, fxReq) => {
  'use strict';

  // A chip (All, Open, Money not complete) or the search text: keep it and show the rows again. Reads only.
  class filterChain extends ActionChain {
    async run(context, { chip, text }) {
      const pv = context.$page.variables;
      if (chip !== undefined && chip !== null && chip !== '') pv.chip = chip;
      if (text !== undefined && text !== null) pv.text = text;
      try {
        pv.v = Object.assign({ ready: true, error: '' }, fxReq.list(fx.store.get(), { chip: pv.chip, text: pv.text }));
      } catch (e) {
        pv.v = { ready: true, error: 'My requests could not be shown: ' + ((e && e.message) || e), chips: [], rows: [] };
      }
    }
  }

  return filterChain;
});
