define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // A toast over the tab bar: shown for five seconds, or until dismissed; a newer one replaces it.
  const SHOW_MS = 5000;

  class toastChain extends ActionChain {
    async run(context, { message, tone }) {
      const { $page } = context;
      const seq = (($page.variables.toast && $page.variables.toast.seq) || 0) + 1;
      $page.variables.toast = { message: message || '', tone: tone || 'info', seq };
      if (!message) return;
      await new Promise((r) => setTimeout(r, SHOW_MS));
      if ($page.variables.toast && $page.variables.toast.seq === seq) $page.variables.toast = { message: '', tone: 'info', seq };
    }
  }

  return toastChain;
});
