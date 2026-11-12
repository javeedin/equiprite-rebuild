define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/jiraBacklog',
], (ActionChain, Actions, J) => {
  'use strict';

  // A sprint's item open in the drawer, as on Jira stories ('' closes it): its test evidence, its whole activity, and its images: each attachment that is an image, read through the jira
  // connection (jiraBacklog.loadImages), shown in its comment, under the description and among the attachments.
  class selectChain extends ActionChain {
    async run(context, { key }) {
      const v = context.$page.variables;
      const k = String(key || '');
      if (v.selKey !== k) v.selKey = k;
      if (!k) return;
      await Actions.callChain(context, { chain: 'evidenceChain', params: { act: 'list' } });
      if (!(v.pgCat || []).length) Actions.callChain(context, { chain: 'pagesChain', params: { act: 'load', id: '' } }); // the story's Application pages
      const row = ((v.report && v.report.rows) || []).filter((r) => r.key === k)[0];
      if (!row) return;
      const plain = JSON.parse(JSON.stringify(row));
      // its whole activity (every comment, change and work log entry), once per item
      const activity = async () => {
        const have = (v.activity || {})[k];
        if (have && (have.ok || have.loading)) return;
        v.activity = Object.assign({}, v.activity || {}, { [k]: { loading: true } });
        const act = await J.loadActivity(context, Actions, k, plain.attachments || []);
        act.loadedAt = Date.now();
        v.activity = Object.assign({}, v.activity || {}, { [k]: act.ok ? act : { ok: false, message: act.message } });
      };
      const images = async () => {
        if (!(plain.attachments || []).some((a) => a.image)) return;
        const got = await J.loadImages(context, Actions, plain);
        if (v.selKey !== k) return; // another item was opened meanwhile
        v.images = Object.assign(JSON.parse(JSON.stringify(v.images || {})), got);
      };
      await Promise.all([activity(), images()]);
    }
  }

  return selectChain;
});
