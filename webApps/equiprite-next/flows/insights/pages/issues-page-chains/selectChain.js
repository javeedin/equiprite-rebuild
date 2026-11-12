define(['vb/action/actionChain', 'resources/js/issuesClient'], (ActionChain, IC) => {
  'use strict';

  // An issue picked: it, its fix (analysis, change, tests), and its write-up to edit.
  class selectChain extends ActionChain {
    async run(context, { id }) {
      const v = context.$page.variables;
      if (!id) return;
      v.selId = id; v.mode = 'view'; v.result = null; v.refine = ''; v.reason = '';
      const r = await IC.get(id);
      if (v.selId !== id) return;
      if (!r.ok) { v.issue = null; v.result = { ok: false, text: (r.body && r.body.error) || 'Could not read this issue.' }; return; }
      const x = r.body.issue;
      v.issue = x;
      const f = x.formatted || {};
      v.edit = { title: f.title || x.title || '', summary: f.summary || '', steps: (f.steps || []).join('\n'), expected: f.expected || '', actual: f.actual || '', impact: f.impact || '' };
      v.emailMe = !!(v.info && v.info.mail && v.info.mail.signedIn);
      // a <textarea> shows its text, not a value attribute: the write-up put into its boxes once they are drawn
      const fill = () => {
        try {
          Array.prototype.forEach.call(document.querySelectorAll('#isWriteup textarea[data-field], #isWriteup input[data-field]'), (el) => {
            const k = el.getAttribute('data-field');
            if (Object.prototype.hasOwnProperty.call(v.edit, k) && document.activeElement !== el) el.value = v.edit[k];
          });
          const r = document.getElementById('isRefine'); if (r && document.activeElement !== r) r.value = v.refine || '';
        } catch (e) { /* no DOM */ }
      };
      [0, 60, 250].forEach((ms) => setTimeout(fill, ms));
    }
  }
  return selectChain;
});
