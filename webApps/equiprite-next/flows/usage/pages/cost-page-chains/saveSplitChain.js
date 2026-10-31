define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/projectTaskTree',
  'resources/js/costPosting',
  'resources/js/shellBus',
], (ActionChain, Actions, projectTaskTree, costPosting, bus) => {
  'use strict';

  // Save ONE WEEK's project split: New's Post costs saveSplitChain. The split rule first (splitFormError, the same call
  // that enables the button), every task re-checked against the WBS, then ONE PUT replaceLineProjectSplits
  // { weekStartDate, splits } for the line: a whole-set replace scoped to the week, so a double click cannot
  // double-author. Percentages only; the server apportions dollars at post time. A 404 (endpoint not deployed) applies
  // the split on screen only and marks the week splitPersisted false, so Post sends that week whole to the request's
  // project rather than call an endpoint that is not there.
  class saveSplitChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;
      const s = v.split || {};
      // plain copies: they are read again once v.split has been replaced (set)
      const line = Object.assign({}, s.line || {});
      if (line.locked || v.isSavingSplit || v.readOnly) return;
      const slices = (Array.isArray(s.slices) ? s.slices : []).map((x) => Object.assign({}, x));
      const set = (patch) => { v.split = Object.assign({}, v.split, patch); };

      const err = $page.functions.splitFormError(slices, 2, 5);
      if (err) { set({ error: err }); return; }
      for (let i = 0; i < slices.length; i++) {
        const x = slices[i];
        if (projectTaskTree.isSummaryTask({ TaskId: x.taskId, TaskNumber: x.taskNumber }, s.tree)) {
          set({ error: 'Task ' + (x.taskNumber || x.taskId) + ' is a summary task and cannot take cost. Replace that line with a task beneath it.' });
          return;
        }
      }
      if (!line.requestLineId || !line.weekStartISO) {
        set({ error: 'This week has no request line to save against.' });
        return;
      }

      v.isSavingSplit = true;
      set({ error: '' });
      try {
        const resp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/replaceLineProjectSplits',
          uriParams: { id: Number(line.requestLineId) },
          body: {
            weekStartDate: line.weekStartISO + 'T00:00:00Z',
            splits: slices.map((x) => ({
              projectRefId: Number(x.projectRefId),
              projectNumber: String(x.projectNumber || ''),
              projectName: x.projectName || null,
              taskId: Number(x.taskId),
              taskNumber: String(x.taskNumber || ''),
              taskName: x.taskName || null,
              splitPct: Number(x.pct),
            })),
          },
        }).catch((e) => ({ ok: false, error: e }));

        const persisted = !!(resp && resp.ok);
        if (!persisted && (resp && resp.status) !== 404) {
          set({ error: 'Could not save the split' + (resp && resp.status ? ' (HTTP ' + resp.status + ')' : '') + '.' });
          return;
        }
        const stored = slices.map((x) => ({ projectRefId: x.projectRefId, projectNumber: x.projectNumber, projectName: x.projectName,
          taskId: x.taskId, taskNumber: x.taskNumber, taskName: x.taskName, splitPct: Number(x.pct) }));
        const fns = $page.functions;
        const hdr = fns.hdrOf(v.row);
        const rows = (v.rowsAll || []).map((r) => (r.kind === 'week' && r.rowKey === line.rowKey
          ? Object.assign({}, r, { splits: stored, splitCount: stored.length, splitPcts: stored.map((x) => x.splitPct), splitPersisted: persisted })
          : r));
        const next = fns.applySplitDerived(rows, hdr);
        const plan = costPosting.plan(next, hdr, v.row && v.row.rateScheduleId);
        const table = fns.tableRows(next, hdr);
        v.rowsAll = next;
        v.plan = plan;
        v.table = table;
        v.panel = '';
        if (!persisted) console.warn('[saveSplitChain] project-split endpoint not deployed (404): applied on screen only.');
        bus.toast((line.equipmentName || 'This equipment') + ', ' + (line.weekLabel || 'this week') + ': '
          + stored.map((x) => x.splitPct + '% to ' + (x.projectName || x.projectNumber)).join(', ') + '. Other weeks are unaffected.'
          + (persisted ? '' : ' Not saved (the split service is not there), so the week posts whole to the request\'s project.'), persisted ? 'info' : 'warning');
      } finally {
        v.isSavingSplit = false;
      }
    }
  }

  return saveSplitChain;
});
