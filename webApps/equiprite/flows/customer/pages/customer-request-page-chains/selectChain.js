define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The next-step button's shortcut: tick every line in one status (the arrived ones to accept, the ones on site to
  // return), so the matching action is ready, then bring the equipment into view. Nothing is sent.
  class selectChain extends ActionChain {
    async run(context, { status }) {
      const { $page } = context;
      if (!status) {
        return;
      }
      $page.functions.selectByStatus(status);
      await Actions.callChain(context, { chain: 'onSelectionChangedChain' });
      try {
        const el = document.getElementById('linesTitle');
        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) { /* not in a browser */ }
    }
  }

  return selectChain;
});
