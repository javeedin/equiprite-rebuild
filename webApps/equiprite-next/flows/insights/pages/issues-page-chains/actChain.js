define(['vb/action/actionChain', 'vb/action/actions', 'resources/js/issuesClient', 'resources/js/codeFixClient', 'resources/js/shellBus', 'resources/js/pagesClient'], (ActionChain, Actions, IC, FX, bus, PC) => {
  'use strict';

  // What the Issues screen does: a new issue (its page, kind, text, screenshots, details; logged, written up by the AI,
  // created in Jira), the write-up and the details saved, analyzed (and again), sent for approval, approved or rejected,
  // applied by the agent, verified, closed with its resolution, reopened; the discussion; a step of the train shown; the
  // list or the table, its order; a screenshot full size; the issue's page in Application pages.
  const today = () => { const d = new Date(); const p2 = (n) => (n < 10 ? '0' : '') + n; return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
  const DET0 = () => ({ severity: '', priority: '', environment: '', foundIn: '', fixVersion: '', customer: '', customerRef: '', reportedBy: '', reporterEmail: '', raisedOn: today(), assignee: '', dueDate: '' });
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
      // after a step moves it on, the train shows where it is now; after a detail or a comment, the same step stays
      const show = async (r, text, stay) => {
        if (r.ok) { if (!stay) v.stageView = -1; await reload(r.body.issue.id); v.result = text ? { ok: !r.body.warning, text: r.body.warning ? text + ' ' + r.body.warning : text } : null; } else { fail(r); if (r.body && r.body.issue) v.issue = r.body.issue; }
      };

      if (act === 'filter') { v.filter = key; return; }
      if (act === 'scope') { v.scope = bus.scope(); if (v.mode === 'new' && !v.dPage) v.dApp = v.scope; return; }
      if (act === 'layout') { v.layout = key === 'table' ? 'table' : 'split'; return; }
      if (act === 'sort') { v.sortKey = key; return; }
      if (act === 'stage' || act === 'go') { const n = Number(key); v.stageView = isNaN(n) ? -1 : n; v.result = null; IC.fillBoxes(v); return; }
      if (act === 'new') { v.mode = 'new'; v.layout = 'split'; v.selId = ''; v.issue = null; v.result = null; v.dPage = ''; v.pickQ = ''; v.dApp = bus.scope() || ''; v.dText = ''; v.dJiraKey = ''; v.images = []; v.dKind = 'bug';
        v.det = DET0(); v.dToJira = !!(v.info && v.info.jira && v.info.jira.connected); return; }
      if (act === 'pick') { v.dPage = key; v.pickQ = ''; return; }
      if (act === 'unpick') { v.dPage = ''; return; }
      if (act === 'images') { const got = FX.takeImages(); const room = Math.max(0, 6 - v.images.length); v.images = v.images.concat(got.slice(0, room).map((x, i) => Object.assign({}, x, { name: /^image\.(png|jpe?g)$/i.test(x.name) || !x.name ? 'Pasted image ' + (v.images.length + i + 1) : x.name }))); return; }
      if (act === 'unimg') { v.images = v.images.filter((x, i) => String(i) !== String(key)); return; }
      if (act === 'viewImg') { v.viewImg = key; setTimeout(() => { try { const d = document.getElementById('isImgDlg'); if (d && !d.open && d.showModal) d.showModal(); } catch (e) { /* no DOM */ } }, 30); return; }
      if (act === 'unviewImg') { try { const d = document.getElementById('isImgDlg'); if (d && d.open) d.close(); } catch (e) { /* closed */ } v.viewImg = ''; return; }
      if (act === 'imgClosed') { v.viewImg = ''; return; }
      if (act === 'openPage' && key) { bus.focus('app-pages', { id: key }); bus.open({ navId: 'app-pages' }); return; }
      const toComposer = () => setTimeout(() => { try { const c = document.getElementById('isComposer'); if (c && c.scrollIntoView) c.scrollIntoView({ behavior: 'smooth', block: 'center' }); const t = document.getElementById('isCText'); if (t) t.focus(); } catch (e) { /* no DOM */ } }, 60);
      if (act === 'emailMode') { v.cKind = 'email'; toComposer(); return; }
      if (act === 'emailInfo') { v.cKind = 'email'; toComposer(); act = 'draft'; }
      if (v.busy) return;
      v.busy = true; v.result = null;
      const x = v.issue;
      // the button pressed shows that it is working (a spinner) until this is done
      let pressed = null;
      try { const a = document.activeElement; pressed = a && a.closest ? a.closest('button') : null; if (pressed) pressed.classList.add('nx-btn--working'); } catch (e) { pressed = null; }
      let watch = null;
      try {
        if (act === 'create') {
          if (!v.dApp) { v.result = { ok: false, text: 'Choose the build first (Old, New, Next, Mobile or Future), then its page.' }; return; }
          if (!v.dPage) { v.result = { ok: false, text: 'Choose the page the issue is on.' }; return; }
          if (!v.dText.trim() && !v.dJiraKey.trim()) { v.result = { ok: false, text: 'Say what is wrong (or give its Jira key).' }; return; }
          v.progress = 'Logging it…';
          const c = await IC.create({ app: v.dApp, page: v.dPage, text: v.dText, kind: v.dKind, jiraKey: v.dJiraKey.trim(), details: v.det || {}, images: v.images.map((i) => ({ name: i.name, mime: i.mime, base64: i.base64 })) });
          if (!c.ok) { fail(c); return; }
          const id = c.body.issue.id;
          v.progress = 'The AI is writing it up…';
          const f = await IC.format(id);
          if (!f.ok) fail(f);
          if (v.dToJira && !c.body.issue.jira) { v.progress = 'Creating it in Jira…'; const j = await IC.toJira(id); if (!j.ok) fail(j); }
          v.images = [];
          v.stageView = -1;
          await reload(id);
          if (!v.result) v.result = { ok: true, text: 'Logged and written up. Check the write-up, then Analyze (the Next step bar below).' };
          return;
        }
        if (act === 'setProject') {
          const r = await IC.setProject(v.project);
          if (!r.ok) { fail(r); return; }
          v.project = r.body.project;
          v.info = Object.assign({}, v.info, { jira: Object.assign({}, v.info.jira, { project: r.body.project }) });
          v.result = { ok: true, text: 'Issues go to the Jira project ' + r.body.project + ' from now on.' };
          return;
        }
        if (!x) return;
        if (act === 'format') { v.progress = 'The AI is writing it up…'; await show(await IC.format(x.id), 'Written up.'); return; }
        if (act === 'save') {
          const e = v.edit || {};
          await show(await IC.update(x.id, { title: e.title, summary: e.summary, steps: String(e.steps || '').split('\n'), expected: e.expected, actual: e.actual, impact: e.impact }), 'Saved.', true);
          return;
        }
        if (act === 'saveDetails') { const r = await IC.details(x.id, v.det || {}); await show(r, r.ok && r.body.unchanged ? 'Nothing changed.' : 'Details saved.', true); return; }
        if (act === 'comment') {
          if (!String(v.cText || '').trim()) { v.result = { ok: false, text: 'Write something first.' }; return; }
          const r = await IC.comment(x.id, { text: v.cText, kind: v.cKind, email: v.cKind === 'response' && v.cEmail });
          const kind = v.cKind;
          if (r.ok) { v.cText = ''; v.cKind = 'comment'; v.cEmail = false; try { const el = document.getElementById('isCText'); if (el) el.value = ''; } catch (e) { /* no DOM */ } }
          await show(r, r.ok ? (kind === 'response' ? 'Response posted.' : 'Posted.') : '', true);
          return;
        }
        if (act === 'jira') { v.progress = 'Creating it in Jira…'; await show(await IC.toJira(x.id), 'Created in Jira.', true); return; }
        if (act === 'draft') {
          v.progress = 'The AI is drafting the email from its questions and the discussion…';
          const r = await IC.draft(x.id, 'info');
          if (!r.ok) { fail(r); return; }
          v.cSubject = r.body.subject; if (!String(v.cTo || '').trim()) v.cTo = r.body.to; v.cText = r.body.body;
          try { const t = document.getElementById('isCText'); if (t) t.value = r.body.body; const sj = document.getElementById('isESubject'); if (sj) sj.value = r.body.subject; const to = document.getElementById('isETo'); if (to) to.value = v.cTo; } catch (e) { /* no DOM */ }
          v.result = { ok: true, text: 'Drafted by ' + (r.body.provider || 'the AI') + ': check it, change what you like, then Send email.' };
          return;
        }
        if (act === 'sendEmail') {
          v.progress = 'Sending the email…';
          const r = await IC.email(x.id, { to: v.cTo, cc: v.cCc, subject: v.cSubject, body: v.cText });
          if (r.ok) { v.cText = ''; v.cKind = 'comment'; try { const t = document.getElementById('isCText'); if (t) t.value = ''; } catch (e) { /* no DOM */ } }
          await show(r, r.ok ? 'Email sent to ' + ((r.body.issue.comments || []).slice(-1)[0] || { email: {} }).email.to + '.' : '', true);
          return;
        }
        if (act === 'capture') {
          v.progress = 'Capturing a screenshot of ' + x.label + '…';
          const c = await PC.capture(x.page, true);
          if (!c.ok) { fail(c, 'Could not capture it here: open the page in Application pages and capture or upload one there.'); return; }
          const ps = await PC.sheet(context.$application.path, x.page);
          if (ps.ok && ps.body.sheet) v.pageSheet = Object.assign({}, ps.body.sheet, { saved: !!ps.body.saved, codeChanged: !!ps.body.codeChanged });
          v.result = { ok: true, text: 'Captured: the AI sees it with the next analysis.' };
          return;
        }
        if (act === 'analyze' || act === 'refine') {
          if (act === 'refine' && !v.refine.trim()) { v.result = { ok: false, text: 'Say what to change (or answer its questions).' }; return; }
          v.progress = 'The AI is reading the page\'s code and the FDD, and deciding where this belongs — a minute or two. Nothing is changed.';
          const r = await IC.analyze(x.id, act === 'refine' ? v.refine.trim() : '');
          if (r.ok) v.refine = '';
          await show(r, r.ok ? 'Analyzed: ' + (r.body.issue.verdictLabel || 'see below') + '.' : '');
          return;
        }
        if (act === 'ask') { v.progress = 'Sending it for approval…'; await show(await IC.ask(x.id, v.emailMe, v.approver), 'Sent for approval.'); return; }
        if (act === 'approve') {
          if (!ask('Approve the change to ' + x.label + ' for ' + x.key + '?\n\nOnce approved, Apply change lets the agent put it on its own branch (fix/' + x.key + '), test it, commit it and push it.')) return;
          await show(await IC.approve(x.id), 'Approved: Apply change is on.');
          return;
        }
        if (act === 'reject') { await show(await IC.reject(x.id, v.reason), 'Rejected.'); v.reason = ''; return; }
        if (act === 'refineFail') {
          // what broke, handed to the AI: it is reopened (the approval no longer stands) and analyzed again with it
          const t = (x.lastRun && x.lastRun.tests) || {};
          const what = (t.unit || []).filter((u) => (u.newFailures || []).length).map((u) => u.file + ': ' + u.newFailures.join('; ')).concat((t.checks || []).filter((c) => !c.ok && !c.already).map((c) => 'check ' + c.name + (c.detail ? ': ' + c.detail : ''))).join('\n');
          if (!ask('Analyze it again with what broke?\n\nIt goes back to be analyzed: the approval no longer stands, and the new proposal is sent for approval again.')) return;
          v.progress = 'Reopening it, and asking the AI again with what broke…';
          const ro = await IC.reopen(x.id);
          if (!ro.ok) { fail(ro); return; }
          const r = await IC.analyze(x.id, 'Applying the change broke this, so it was not committed. Change the fix so these pass (keep what the issue asks):\n' + what);
          await show(r, r.ok ? 'Analyzed again with what broke: check the new proposal, then send it for approval.' : '');
          return;
        }
        if (act === 'apply' || act === 'applyAnyway' || act === 'applyAgreed') {
          const anyway = act === 'applyAnyway';
          const allowOld = act === 'applyAgreed' || (!!v.allowOld && x.app === 'vbredwoodapp');
          if (anyway && !String(v.anyReason || '').trim()) { v.result = { ok: false, text: 'Say why it may go in with the failing test.' }; return; }
          if (!ask(anyway ? 'Apply it although a test fails?\n\n"' + v.anyReason + '" is kept in its history, the commit and the pull request.'
            : allowOld ? 'Apply it, and agree this change to Old EquipRite?\n\nIts files are named in Old EquipRite\'s guard (tests/old-app-unchanged.test.js) with ' + x.key + ' and who approved it, in the same commit — so the decision shows in the review.'
            : 'Let the agent apply the approved change?\n\nIt puts it on a branch of its own (fix/' + x.key + '), runs the tests, commits it with ' + x.key + ' and pushes it, then makes the pull request. Your own code folder is not touched.')) return;
          v.progress = 'The agent is applying it on fix/' + x.key + (anyway ? ' (accepting the failing test)' : allowOld ? ' (agreed for Old EquipRite)' : '') + ': its steps are shown below, as it goes.';
          v.agent = null;
          // its steps, live (the local server keeps them while it works)
          // its log follows the newest line (where a failure is)
          const logEnd = () => setTimeout(() => { try { document.querySelectorAll('.nx-is-aglogtext').forEach((e) => { e.scrollTop = e.scrollHeight; }); } catch (e) { /* no DOM */ } }, 80);
          watch = setInterval(async () => { const p = await IC.progress(x.id); if (watch && p.ok && v.selId === x.id) { v.agent = p.body; logEnd(); } }, 700); // a poll still on its way when it ends is dropped
          const r = await IC.apply(x.id, { anyway: anyway, reason: anyway ? v.anyReason : '', allowOld: allowOld });
          if (r.ok) v.anyReason = '';
          clearInterval(watch); watch = null;
          const fin = await IC.progress(x.id);
          if (fin.ok && v.selId === x.id) { v.agent = fin.body; logEnd(); }
          await show(r, r.ok ? 'Done: on ' + r.body.issue.branch.name + (r.body.issue.branch.pushed ? ', pushed' : '') + '. Review the pull request, then verify the fix.' : '');
          return;
        }
        if (act === 'verifyPass' || act === 'verifyFail') {
          const r = await IC.verify(x.id, { passed: act === 'verifyPass', env: v.vEnv, build: v.vBuild, notes: v.vNotes });
          if (r.ok) v.vNotes = '';
          await show(r, r.ok ? (act === 'verifyPass' ? 'Verified: close it with its resolution.' : 'Back to be fixed: analyze it again with what still goes wrong.') : '');
          return;
        }
        if (act === 'close') {
          const r = await IC.close(x.id, { resolution: v.rRes, rootCause: v.rCause, fixedIn: v.rFixed, note: v.rNotes });
          if (r.ok) v.rNotes = '';
          await show(r, r.ok ? 'Closed as ' + (r.body.issue.resolutionLabel || 'done') + '.' : '');
          return;
        }
        if (act === 'reopen') { await show(await IC.reopen(x.id), 'Reopened.'); }
      } finally {
        if (watch) clearInterval(watch);
        try { if (pressed) pressed.classList.remove('nx-btn--working'); } catch (e) { /* redrawn */ }
        v.busy = false;
        v.progress = '';
      }
    }
  }
  return actChain;
});
