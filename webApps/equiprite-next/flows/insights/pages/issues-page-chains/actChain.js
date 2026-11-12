define(['vb/action/actionChain', 'vb/action/actions', 'resources/js/issuesClient', 'resources/js/codeFixClient', 'resources/js/shellBus'], (ActionChain, Actions, IC, FX, bus) => {
  'use strict';

  // What the Issues screen does: a new issue (its page, kind, text, screenshots; logged, written up by the AI, created in
  // Jira), the write-up saved, analyzed (and again), sent for approval, approved or rejected, applied by the agent,
  // closed, reopened; a filter; a screenshot full size; the issue's page in Application pages.
  class actChain extends ActionChain {
    async run(context, { act, key }) {
      const v = context.$page.variables;
      if (!act) return;
      const ask = (t) => (typeof window === 'undefined' || !window.confirm ? true : window.confirm(t));
      const fail = (r, t) => { v.result = { ok: false, text: (r && r.body && r.body.error) || t || 'It did not work.' }; };
      const reload = async (id) => {
        const l = await IC.list('', 'all');
        v.issues = (l.body && l.body.issues) || v.issues;
        v.counts = (l.body && l.body.counts) || v.counts;
        if (id) await Actions.callChain(context, { chain: 'selectChain', params: { id: id } });
      };
      const show = async (r, text) => { if (r.ok) { await reload(r.body.issue.id); v.result = text ? { ok: true, text: text } : null; } else { fail(r); if (r.body && r.body.issue) v.issue = r.body.issue; } };

      if (act === 'filter') { v.filter = key; return; }
      if (act === 'new') { v.mode = 'new'; v.selId = ''; v.issue = null; v.result = null; v.dPage = ''; v.pickQ = ''; v.dText = ''; v.dJiraKey = ''; v.images = []; v.dKind = 'bug';
        v.dToJira = !!(v.info && v.info.jira && v.info.jira.connected); return; }
      if (act === 'pick') { v.dPage = key; v.pickQ = ''; return; }
      if (act === 'unpick') { v.dPage = ''; return; }
      if (act === 'images') { const got = FX.takeImages(); const room = Math.max(0, 6 - v.images.length); v.images = v.images.concat(got.slice(0, room).map((x, i) => Object.assign({}, x, { name: /^image\.(png|jpe?g)$/i.test(x.name) || !x.name ? 'Pasted image ' + (v.images.length + i + 1) : x.name }))); return; }
      if (act === 'unimg') { v.images = v.images.filter((x, i) => String(i) !== String(key)); return; }
      if (act === 'viewImg') { v.viewImg = key; setTimeout(() => { try { const d = document.getElementById('isImgDlg'); if (d && !d.open && d.showModal) d.showModal(); } catch (e) { /* no DOM */ } }, 30); return; }
      if (act === 'unviewImg') { try { const d = document.getElementById('isImgDlg'); if (d && d.open) d.close(); } catch (e) { /* closed */ } v.viewImg = ''; return; }
      if (act === 'imgClosed') { v.viewImg = ''; return; }
      if (act === 'openPage' && key) { bus.focus('app-pages', { id: key }); bus.open({ navId: 'app-pages' }); return; }
      if (v.busy) return;
      v.busy = true; v.result = null;
      const x = v.issue;
      try {
        if (act === 'create') {
          if (!v.dPage) { v.result = { ok: false, text: 'Choose the page the issue is on.' }; return; }
          if (!v.dText.trim() && !v.dJiraKey.trim()) { v.result = { ok: false, text: 'Say what is wrong (or give its Jira key).' }; return; }
          v.progress = 'Logging it…';
          const c = await IC.create({ page: v.dPage, text: v.dText, kind: v.dKind, jiraKey: v.dJiraKey.trim(), images: v.images.map((i) => ({ name: i.name, mime: i.mime, base64: i.base64 })) });
          if (!c.ok) { fail(c); return; }
          const id = c.body.issue.id;
          v.progress = 'The AI is writing it up…';
          const f = await IC.format(id);
          if (!f.ok) fail(f);
          if (v.dToJira && !c.body.issue.jira) { v.progress = 'Creating it in Jira…'; const j = await IC.toJira(id); if (!j.ok) fail(j); }
          v.images = [];
          await reload(id);
          if (!v.result) v.result = { ok: true, text: 'Logged and written up. Check the write-up, then Analyze.' };
          return;
        }
        if (!x) return;
        if (act === 'format') { v.progress = 'The AI is writing it up…'; await show(await IC.format(x.id), 'Written up.'); return; }
        if (act === 'save') {
          const e = v.edit || {};
          await show(await IC.update(x.id, { title: e.title, summary: e.summary, steps: String(e.steps || '').split('\n'), expected: e.expected, actual: e.actual, impact: e.impact }), 'Saved.');
          return;
        }
        if (act === 'jira') { v.progress = 'Creating it in Jira…'; await show(await IC.toJira(x.id), 'Created in Jira.'); return; }
        if (act === 'analyze' || act === 'refine') {
          if (act === 'refine' && !v.refine.trim()) { v.result = { ok: false, text: 'Say what to change (or answer its questions).' }; return; }
          v.progress = 'The AI is reading the page\'s code and the FDD, and deciding where this belongs — a minute or two. Nothing is changed.';
          const r = await IC.analyze(x.id, act === 'refine' ? v.refine.trim() : '');
          if (r.ok) v.refine = '';
          await show(r, r.ok ? 'Analyzed: ' + (r.body.issue.verdictLabel || 'see below') + '.' : '');
          return;
        }
        if (act === 'ask') { v.progress = 'Sending it for approval…'; await show(await IC.ask(x.id, v.emailMe), 'Sent for approval.'); return; }
        if (act === 'approve') {
          if (!ask('Approve the change to ' + x.label + ' for ' + x.key + '?\n\nOnce approved, Apply change lets the agent put it on its own branch (fix/' + x.key + '), test it, commit it and push it.')) return;
          await show(await IC.approve(x.id), 'Approved: Apply change is on.');
          return;
        }
        if (act === 'reject') { await show(await IC.reject(x.id, v.reason), 'Rejected.'); v.reason = ''; return; }
        if (act === 'apply') {
          if (!ask('Let the agent apply the approved change?\n\nIt puts it on a branch of its own (fix/' + x.key + '), runs the tests, commits it with ' + x.key + ' and pushes it, then makes the pull request. Your own code folder is not touched.')) return;
          v.progress = 'The agent is applying it on fix/' + x.key + ': the related tests before and after, the commit, the push…';
          const r = await IC.apply(x.id);
          await show(r, r.ok ? 'Done: on ' + r.body.issue.branch.name + (r.body.issue.branch.pushed ? ', pushed' : '') + '. Open the pull request below.' : '');
          return;
        }
        if (act === 'close') { await show(await IC.close(x.id, v.reason), 'Closed.'); v.reason = ''; return; }
        if (act === 'reopen') { await show(await IC.reopen(x.id), 'Reopened.'); }
      } finally {
        v.busy = false;
        v.progress = '';
      }
    }
  }
  return actChain;
});
