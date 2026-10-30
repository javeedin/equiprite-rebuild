define(['vb/action/actionChain', 'resources/js/rules', 'resources/js/shellBus'], (ActionChain, rules, bus) => {
  'use strict';

  // An agreement opens in a tab of its own, keyed by its number (the list's view rows may carry no id), so it opens
  // once. New agreement opens an empty one (agreement:new); FULL access, as New's newAgreementChain.
  class openChain extends ActionChain {
    async run(context, { number, isNew }) {
      if (isNew) {
        const av = context.$application.variables;
        if (rules.pageAccess(av.pageAccessMap, av.pageAccessLoaded, 'EQR_RENTAL_AGREEMENTS') !== 'FULL') return;
        bus.open({ record: 'agreement', params: { id: 'new' } });
        return;
      }
      if (!number) return;
      bus.open({ record: 'agreement', params: { number: String(number) } });
    }
  }

  return openChain;
});
