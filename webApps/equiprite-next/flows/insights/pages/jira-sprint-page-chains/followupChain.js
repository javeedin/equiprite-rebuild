define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/followup',
  'resources/js/followupsClient',
  'resources/js/shellBus',
], (ActionChain, exportKit, F, FC, bus) => {
  'use strict';

  // Copy to follow-up on a sprint's items: opens a small dialog that drafts the email in simple English (a greeting that
  // names the assignees, a body the user picks from a few templates, then the stories as a table). From there the user
  // copies it for an email, or opens a new mail in Outlook with the message (the table rides the clipboard to paste in).
  const KIND = 'sprint';

  function openLink(href) {
    const a = document.createElement('a');
    a.href = href; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(() => a.remove(), 0);
  }

  class followupChain extends ActionChain {
    async run(context, { act, key, field, value }) {
      const v = context.$page.variables;

      if (act === 'open') {
        const rows = (v.report && v.report.rows) || [];
        const sel = v.selected || [];
        const picked = sel.length ? rows.filter((r) => sel.indexOf(r.key) >= 0) : rows;
        if (!picked.length) { bus.toast('There are no items to copy.', 'error'); return; }
        const s = (v.report && v.report.sprint) || {};
        v.fuTitle = 'Follow-up — Sprint ' + (s.name || v.name || v.id);
        v.fuSubtitle = [s.state, s.start && s.end ? s.start + ' – ' + s.end : '', s.goal ? 'Goal: ' + s.goal : ''].filter(Boolean).join(' · ');
        v.fuWhen = new Date().toLocaleString();
        v.fuRows = picked;
        v.fuTpl = 'close';
        v.fuMessage = F.message(picked, 'close');
        v.fuSubject = F.template('close').subject;
        v.fuSignoff = v.fuSignoff || 'Thanks,';
        v.fuTo = v.fuTo || '';
        v.fuOpen = true;
        return;
      }
      if (act === 'template') {
        v.fuTpl = key;
        v.fuMessage = F.message(v.fuRows || [], key);
        v.fuSubject = F.template(key).subject;
        return;
      }
      if (act === 'field') {
        if (field === 'to') v.fuTo = value;
        else if (field === 'subject') v.fuSubject = value;
        else if (field === 'message') v.fuMessage = value;
        else if (field === 'signoff') v.fuSignoff = value;
        return;
      }
      if (act === 'close') { v.fuOpen = false; return; }
      if (act === 'save') {
        const rows = v.fuRows || [];
        if (!rows.length) { bus.toast('There are no items to save.', 'error'); return; }
        const s = (v.report && v.report.sprint) || {};
        const r = await FC.save({
          kind: KIND, title: v.fuTitle, subtitle: v.fuSubtitle, subject: v.fuSubject,
          to: v.fuTo, message: v.fuMessage, signoff: v.fuSignoff, sprintName: s.name || v.name || v.id || '', source: '',
          lines: rows.map((x) => ({ storyKey: x.key, summary: x.summary, status: x.status, assignee: x.assignee, sprint: x.sprint, due: x.due, overdue: !!x.overdue, customer: (x.labels || []).join(', '), url: x.url })),
        });
        if (r.ok && r.body && r.body.ok) { bus.toast('Follow-up saved — open it from the Follow-ups menu.', 'info'); v.fuOpen = false; }
        else bus.toast((r.body && r.body.error) || 'Could not save (saved follow-ups need the EquipRite desktop app).', 'error');
        return;
      }
      if (act === 'default') {
        // Open Windows' Default apps page (an app cannot change the default mail client itself) so Outlook can be set for mailto.
        openLink('ms-settings:defaultapps');
        bus.toast('Opening Windows settings — set Outlook as the default for “mailto”, then use Open in Outlook.', 'info');
        return;
      }

      const opts = { title: v.fuTitle, subtitle: v.fuSubtitle, when: v.fuWhen, message: v.fuMessage, signoff: v.fuSignoff, rows: v.fuRows || [], kind: KIND };
      if (act === 'outlook') {
        // The mail opens with the text draft; the clipboard holds only the table, so one Ctrl+V drops it in without repeating the message.
        const ok = await exportKit.copyRich(F.tableHtml(opts), F.tableText(opts));
        openLink(F.mailtoHref({ to: v.fuTo, subject: v.fuSubject, title: v.fuTitle, subtitle: v.fuSubtitle, when: v.fuWhen, message: v.fuMessage, signoff: v.fuSignoff, rows: v.fuRows || [] }));
        bus.toast(ok ? 'Opened a new email in Outlook — click the “paste” line and press Ctrl+V to drop in the stories table.'
          : 'Opened a new email in Outlook. (The table could not be copied here — use Copy for email.)', 'info');
        v.fuOpen = false;
      } else {
        // Copy for email: the whole formatted email (header, message, table, sign-off) for pasting into a blank body.
        const ok = await exportKit.copyRich(F.composeHtml(opts), F.composeText(opts));
        bus.toast(ok ? 'Copied — click in your email body and press Ctrl+V to paste it.' : 'The clipboard is not available here.', ok ? 'info' : 'error');
      }
    }
  }

  return followupChain;
});
