define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/jiraBacklog',
], (ActionChain, Actions, J) => {
  'use strict';

  // The item open in the drawer ('' closes it), and its images: each attachment that is an image, read through the jira
  // connection (jiraBacklog.loadImages), shown in its comment, under the description and among the attachments.
  class selectChain extends ActionChain {
    async run(context, { key }) {
      const v = context.$page.variables;
      const k = String(key || '');
      if (v.selKey !== k) v.selKey = k;
      if (!k) return;
      await Actions.callChain(context, { chain: 'evidenceChain', params: { act: 'list' } });
      const row = (v.rows || []).filter((r) => r.key === k)[0];
      if (!row || !row.attachments || !row.attachments.some((a) => a.image)) return;
      const got = await J.loadImages(context, Actions, JSON.parse(JSON.stringify(row)));
      if (v.selKey !== k) return; // another item was opened meanwhile
      v.images = Object.assign(JSON.parse(JSON.stringify(v.images || {})), got);
    }
  }

  return selectChain;
});
