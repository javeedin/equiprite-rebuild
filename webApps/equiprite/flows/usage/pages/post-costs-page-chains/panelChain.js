define([
  'vb/action/actionChain',
  'resources/js/prPassThrough',
], (ActionChain, prPassThrough) => {
  'use strict';

  // Opens one side panel (the old drawers) or closes it.
  //   misc     add a charge to an equipment       old openMiscDrawerChain: the item date defaults to the line's
  //                                                last postable week, the type and organization to the pair proven
  //                                                accepted by unprocessedProjectCosts, the amount is left empty
  //   exptype  an equipment's expenditure type    old openExpTypeDrawerChain: seeded with what the line has, never
  //                                                defaulted to Equipment (that would turn "unset" into a choice)
  //   split    divide one week across projects    old openSplitDrawerChain: a posted or PR week opens read-only;
  //                                                an unsplit week starts with the request's own project
  //   review   what Post will send, before the click
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
      if (panel === 'review') {
        if (!$page.functions.selection(rows).items) {
          v.postError = 'Tick the weeks or charges to post first.';
          return;
        }
        v.postSuccess = '';
        v.panel = 'review';
        return;
      }
      if (v.readOnly) return;
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
        const cur = v.current || {};
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
            groupKey: wk.groupKey, rowKey: key, equipmentName: wk.equipmentName || 'Equipment', weekLabel: wk.label || '',
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
