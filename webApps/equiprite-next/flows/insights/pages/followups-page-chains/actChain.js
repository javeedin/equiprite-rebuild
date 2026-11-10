define([
  'vb/action/actionChain',
  'resources/js/followupsClient',
  'resources/js/followup',
  'resources/js/exportKit',
  'resources/js/shellBus',
], (ActionChain, FC, F, exportKit, bus) => {
  'use strict';

  // The open follow-up's actions: copy it to the clipboard again (as the formatted email), or delete it.
  function rowsOf(d) {
    return ((d && d.lines) || []).map((l) => ({ key: l.storyKey, summary: l.summary, status: l.status, assignee: l.assignee,
      sprint: l.sprint, due: l.due, overdue: l.overdue, labels: l.customer ? String(l.customer).split(', ') : [], url: l.url }));
  }

  class actChain extends ActionChain {
    async run(context, { act, id }) {
      const v = context.$page.variables;
      if (act === 'delete') {
        const r = await FC.remove(id);
        if (r.ok && r.body && r.body.ok) {
          v.followups = (v.followups || []).filter((f) => f.id !== id);
          if (v.selId === id) { v.selId = ''; v.detail = null; }
          bus.toast('Follow-up deleted.', 'info');
        } else {
          bus.toast((r.body && r.body.error) || 'Could not delete the follow-up.', 'error');
        }
        return;
      }
      if (act === 'copy') {
        const d = v.detail;
        if (!d) return;
        const opts = { title: d.title, subtitle: d.subtitle, when: d.createdAt ? new Date(d.createdAt).toLocaleString() : '',
          message: d.message, signoff: d.signoff, rows: rowsOf(d), kind: d.kind };
        const ok = await exportKit.copyRich(F.composeHtml(opts), F.composeText(opts));
        bus.toast(ok ? 'Copied — click in your email body and press Ctrl+V to paste it.' : 'The clipboard is not available here.', ok ? 'info' : 'error');
      }
    }
  }

  return actChain;
});
