define([
  'vb/action/actionChain',
  'resources/js/prPassThrough',
], (ActionChain, prPassThrough) => {
  'use strict';

  // Opens one dialog or closes it: New's panelChain, panel for panel.
  //   post     what Post will send, before the click (New's review panel): refused with nothing ticked
  //   misc     add a charge to an equipment: the item date defaults to the line's last postable week, the type and
  //            organization to the pair proven accepted by unprocessedProjectCosts, the amount is left empty
  //   exptype  an equipment's expenditure type: seeded with what the line has, never defaulted to Equipment
  //   split    divide one week across projects: a posted or PR week opens read-only; an unsplit week starts with the
  //            request's own project
  // Nothing while posting; only the post review for a role that may only look (it cannot post from it).
  class panelChain extends ActionChain {
    async run(context, { panel, key }) {
      const { $page } = context;
      const v = $page.variables;
      if (v.isPosting) return;
      const rows = v.rowsAll || [];
      v.postError = '';
      if (!panel) {
        v.panel = '';
        return;
      }
      if (v.readOnly) return;
      if (panel === 'post') {
        if (!$page.functions.selection(rows).items) {
          v.postError = 'Tick the weeks or charges to post first.';
          return;
        }
        v.postNote = '';
        v.post = { step: 'ask' };
        v.panel = 'post';
        return;
      }
      if (panel === 'misc') {
        const grp = rows.find((r) => r.kind === 'group' && r.groupKey === key);
        if (!grp) return;
        const weeks = rows.filter((r) => r.kind === 'week' && r.groupKey === key && r.postable && !r.posted);
        const last = weeks.length ? weeks[weeks.length - 1] : null;
        v.misc = {
          line: { groupKey: key, equipmentName: grp.label || 'Equipment', requestLineId: grp.requestLineId != null ? Number(grp.requestLineId) : null },
          draft: {
            expenditureType: 'Equipment',
            expenditureOrg: 'Applications and Services',
            expItemDate: last && last.weekStartISO ? last.weekStartISO : new Date().toISOString().slice(0, 10),
            quantity: 1,
            rawCost: null,
            currency: 'USD',
            comments: '',
          },
          error: '',
        };
        v.panel = 'misc';
      } else if (panel === 'exptype') {
        const grp = rows.find((r) => r.kind === 'group' && r.groupKey === key);
        if (!grp || grp.expenditureTypeLocked) return;
        v.exp = {
          line: {
            groupKey: key,
            equipmentName: grp.label || 'Equipment',
            current: grp.expenditureType || '',
            hasPosted: rows.some((r) => r.kind === 'week' && r.groupKey === key && r.posted),
          },
          choice: grp.expenditureType || null,
          query: '',
          error: '',
        };
        v.panel = 'exptype';
      } else if (panel === 'split') {
        const wk = rows.find((r) => r.kind === 'week' && r.rowKey === key);
        if (!wk) return;
        const locked = prPassThrough.isSplitLocked(wk);
        let slices = (Array.isArray(wk.splits) ? wk.splits : []).map((s) => ({
          projectRefId: s.projectRefId != null ? Number(s.projectRefId) : null,
          projectNumber: s.projectNumber || '',
          projectName: s.projectName || '',
          taskId: s.taskId != null ? Number(s.taskId) : null,
          taskNumber: s.taskNumber || '',
          taskName: s.taskName || '',
          pct: s.splitPct != null ? Number(s.splitPct) : (s.pct != null ? Number(s.pct) : null),
        }));
        const cur = v.row || {};
        if (!slices.length && !locked && cur.ppmProjectNumber) {
          slices = [{
            projectRefId: Number(cur.ppmProjectRefId) || null,
            projectNumber: String(cur.ppmProjectNumber),
            projectName: cur.projectName && cur.projectName !== '—' ? cur.projectName : '',
            taskId: Number(cur.ppmTaskRefId) || null,
            taskNumber: cur.ppmTaskNumber ? String(cur.ppmTaskNumber) : '',
            taskName: cur.taskName && cur.taskName !== '—' ? cur.taskName : '',
            pct: null,
          }];
        }
        v.split = {
          line: {
            groupKey: wk.groupKey, rowKey: key, equipmentName: wk.equipmentName || 'Equipment', weekLabel: $page.functions.weekName(wk) || wk.label || '',
            weekStartISO: wk.weekStartISO || '', weekCost: Number(wk.cost || 0),
            requestLineId: wk.requestLineId != null ? Number(wk.requestLineId) : null,
            locked, lockReason: prPassThrough.splitLockReason(wk), splitCount: Array.isArray(wk.splits) ? wk.splits.length : 0,
          },
          slices,
          error: '',
          query: '',
          results: [],
          searching: false,
          pick: { projectId: null, projectName: '', projectNumber: '', taskId: null, taskName: '', taskNumber: '', pct: null },
          tasks: [],
          taskQuery: '',
          tree: {},
          taskError: '',
        };
        v.panel = 'split';
      }
    }
  }

  return panelChain;
});
