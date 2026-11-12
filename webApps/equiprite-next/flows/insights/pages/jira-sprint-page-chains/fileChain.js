define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/jiraBacklog',
  'resources/js/shellBus',
], (ActionChain, Actions, J, bus) => {
  'use strict';

  // An attachment that is not an image (a PDF, a spreadsheet, a video…): read through the jira connection and opened (a
  // PDF) or saved under its own name (jiraBacklog.openAttachment).
  class fileChain extends ActionChain {
    async run(context, { id }) {
      const v = context.$page.variables;
      const rows = (v.rows || (v.report && v.report.rows) || (v.story ? [v.story] : []));
      const row = rows.filter((r) => r.key === v.selKey)[0] || v.story || {};
      const att = ((row && row.attachments) || []).filter((a) => a.id === String(id || ''))[0];
      if (!att) return;
      bus.toast('Opening ' + att.name + '…', 'info');
      const ok = await J.openAttachment(context, Actions, att);
      if (!ok) bus.toast('Jira did not give ' + att.name + '. Open it from the story in Jira.', 'error');
    }
  }

  return fileChain;
});
