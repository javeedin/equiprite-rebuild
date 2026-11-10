define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/followup',
  'resources/js/shellBus',
], (ActionChain, exportKit, F, bus) => {
  'use strict';

  // Copy to follow-up on Jira stories: opens a dialog that drafts the email in simple English (a greeting that names the
  // assignees, a body picked from a few templates, then the items shown as a table), to copy for an email or open a new
  // mail in Outlook (the table rides the clipboard to paste in). Covers the items currently shown (the current filter).
  const KIND = 'stories';

  function openMailto(href) {
    const a = document.createElement('a');
    a.href = href; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(() => a.remove(), 0);
  }

  class followupChain extends ActionChain {
    async run(context, { act, key, field, value }) {
      const v = context.$page.variables;

      if (act === 'open') {
        const picked = JSON.parse(JSON.stringify(v.shown || []));
        if (!picked.length) { bus.toast('There are no items to copy.', 'error'); return; }
        v.fuTitle = 'Follow-up — Jira stories';
        v.fuSubtitle = [v.jql, v.fLabel].filter(Boolean).join(' · ');
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

      const opts = { title: v.fuTitle, subtitle: v.fuSubtitle, when: v.fuWhen, message: v.fuMessage, signoff: v.fuSignoff, rows: v.fuRows || [], kind: KIND };
      const ok = await exportKit.copyRich(F.composeHtml(opts), F.composeText(opts));
      if (act === 'outlook') {
        openMailto(F.mailtoHref({ to: v.fuTo, subject: v.fuSubject, message: v.fuMessage, signoff: v.fuSignoff }));
        bus.toast(ok ? 'Opened a new email in Outlook — click in the body and press Ctrl+V to paste the stories table.'
          : 'Opened a new email in Outlook. (The table could not be copied here — copy it from the preview.)', 'info');
        v.fuOpen = false;
      } else {
        bus.toast(ok ? 'Copied — click in your email body and press Ctrl+V to paste it.' : 'The clipboard is not available here.', ok ? 'info' : 'error');
      }
    }
  }

  return followupChain;
});
