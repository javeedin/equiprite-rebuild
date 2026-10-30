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
      await shellTabs.update(context, Actions, (st) => {
        const next = tabs.close(st, id);
        return next.closed ? next : null;
      });
    }
  }

  return closeTabChain;
});
