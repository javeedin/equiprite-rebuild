define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/jiraBacklog',
  'resources/js/shellBus',
], (ActionChain, Actions, J, bus) => {
  'use strict';

  // The item open in the drawer ('' closes it); its whole activity — every comment, change and work log entry — read from
  // Jira (jiraBacklog.loadActivity, once per story); and its images: every attachment that is an image, read through the
  // jira connection (jiraBacklog.loadImages), shown in its comment, in the history, under the description and among the
  // attachments.
  class selectChain extends ActionChain {
    async run(context, { key, ai }) {
      const v = context.$page.variables;
      const k = String(key || '');
      // the AI icon in the row: its analysis in a tab of its own (the saved one, or a new run), not the drawer
      if (k && (ai === true || ai === 'true')) { bus.open({ record: 'jira-analysis', params: { key: k } }); return; }
      if (v.selKey !== k) v.selKey = k;
      if (!k) return;
      await Actions.callChain(context, { chain: 'evidenceChain', params: { act: 'list' } });
      const row = (v.rows || []).filter((r) => r.key === k)[0];
      if (!row) return;
      const plain = JSON.parse(JSON.stringify(row));
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
