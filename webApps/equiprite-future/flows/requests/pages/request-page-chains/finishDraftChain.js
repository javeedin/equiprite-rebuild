define(['vb/action/actionChain', 'resources/js/shellBus'], (ActionChain, bus) => {
  'use strict';

  // A draft project request: finish it in New request (its own draft tab, opened on Review), then submit it there.
  class finishDraftChain extends ActionChain {
    async run(context) {
      const h = context.$page.variables.head || {};
      if (!h.id) return;
      bus.open({ record: 'draft', params: { id: h.id, number: h.requestNumber || '', startStep: 'review' } });
    }
  }

  return finishDraftChain;
});
