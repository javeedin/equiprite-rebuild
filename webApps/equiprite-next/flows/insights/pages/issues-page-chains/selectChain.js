define(['vb/action/actionChain', 'resources/js/issuesClient'], (ActionChain, IC) => {
  'use strict';

  // An issue picked: it, its fix (analysis, change, tests), its write-up and details to edit, the verify and close forms
  // set from it. Another issue: the train shows where it is; the same one again (after a save): the same step stays.
  const DEFAULT_RES = (x) => {
    if (['in-review', 'verified'].indexOf(x.status) !== -1) return x.kind === 'bug' ? 'fixed' : 'done';
    const c = x.verdict && x.verdict.code;
    return c === 'as-designed' ? 'as-designed' : c === 'out-of-scope' ? 'out-of-scope' : c === 'fix-elsewhere' ? 'moved' : c === 'needs-info' ? 'cannot-reproduce' : 'wont-fix';
  };
  class selectChain extends ActionChain {
    async run(context, { id }) {
      const v = context.$page.variables;
      if (!id) return;
      const same = v.selId === id && v.mode === 'view';
      const was = same && v.issue && v.issue.id === id ? v.issue.status : '';
      v.selId = id; v.mode = 'view'; v.layout = 'split'; v.result = same ? v.result : null;
      if (!same) { v.stageView = -1; v.refine = ''; v.reason = ''; v.cText = ''; v.cKind = 'comment'; v.cEmail = false; v.vNotes = ''; v.rNotes = ''; }
      const r = await IC.get(id);
      if (v.selId !== id) return;
      if (!r.ok) { v.issue = null; v.result = { ok: false, text: (r.body && r.body.error) || 'Could not read this issue.' }; return; }
      const x = r.body.issue;
      v.issue = x;
      const f = x.formatted || {};
      const d = x.details || {};
      v.edit = { title: f.title || x.title || '', summary: f.summary || '', steps: (f.steps || []).join('\n'), expected: f.expected || '', actual: f.actual || '', impact: f.impact || '' };
      v.det = { kind: x.kind || 'bug', severity: d.severity || '', priority: d.priority || '', environment: d.environment || '', foundIn: d.foundIn || '', fixVersion: d.fixVersion || '', customer: d.customer || '',
        customerRef: d.customerRef || '', reportedBy: d.reportedBy || x.by || '', reporterEmail: d.reporterEmail || '', raisedOn: d.raisedOn || '', assignee: d.assignee || '', dueDate: d.dueDate || '' };
      v.emailMe = !!(v.info && v.info.mail && v.info.mail.signedIn);
      if (!same || !v.approver) v.approver = (v.info && v.info.mail && v.info.mail.account) || '';
      v.project = (v.info && v.info.jira && v.info.jira.project) || '';
      // the verify and close forms start from where it is: set again when another issue is picked or it moved on
      if (!same || was !== x.status) {
        v.vEnv = d.environment && d.environment !== 'PROD' ? d.environment : 'SIT';
        v.vBuild = d.fixVersion || '';
        v.rRes = DEFAULT_RES(x);
        v.rCause = '';
        v.rFixed = d.fixVersion || (x.verification && x.verification.build) || '';
      }
      IC.fillBoxes(v);
    }
  }
  return selectChain;
});
