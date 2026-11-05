define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/jiraBacklog'
], (ActionChain, Actions, J) => {
  'use strict';

  // A row of the table (click or Enter): the story in the drawer (a copy of its row, since page variables are proxies),
  // then its images: each attachment that is an image, read through the jira connection (jiraBacklog.loadImages).
  class openStoryChain extends ActionChain {
    async run(context, { key }) {
      const { $page } = context;
      const v = $page.variables;
      const row = (v.rows || []).filter((r) => r.key === key)[0];
      if (!row) return;
      const copy = JSON.parse(JSON.stringify(row));
      v.selected = copy;
      v.drawerOpen = true;
      if (!(copy.attachments || []).some((a) => a.image)) return;
      const got = await J.loadImages(context, Actions, copy);
      if (!v.selected || v.selected.key !== key) return;
      v.images = Object.assign(JSON.parse(JSON.stringify(v.images || {})), got);
    }
  }

  return openStoryChain;
});
