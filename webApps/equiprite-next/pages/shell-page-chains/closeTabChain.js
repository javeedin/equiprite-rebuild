define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/tabs',
  'resources/js/shellTabs',
], (ActionChain, Actions, tabs, shellTabs) => {
  'use strict';

  // Closes a tab (the × or a middle-click); My work stays. The tab to its right is shown when it was the current one.
  class closeTabChain extends ActionChain {
    async run(context, { id }) {
      if (!id) return;
      const next = tabs.close(shellTabs.state(context), id);
      if (next.closed) await shellTabs.apply(context, Actions, next);
    }
  }

  return closeTabChain;
});
