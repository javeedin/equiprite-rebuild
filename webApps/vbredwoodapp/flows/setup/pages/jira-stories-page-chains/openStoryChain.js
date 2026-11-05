define([
  'vb/action/actionChain'
], (ActionChain) => {
  'use strict';

  // A row of the table (click or Enter): the story in the drawer. A copy of its row, since page variables are proxies.
  class openStoryChain extends ActionChain {
    async run(context, { key }) {
      const { $page } = context;
      const v = $page.variables;
      const row = (v.rows || []).filter((r) => r.key === key)[0];
      if (!row) return;
      v.selected = JSON.parse(JSON.stringify(row));
      v.drawerOpen = true;
    }
  }

  return openStoryChain;
});
