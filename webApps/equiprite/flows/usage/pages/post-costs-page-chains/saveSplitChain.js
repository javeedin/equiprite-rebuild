define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/projectTaskTree',
], (ActionChain, Actions, projectTaskTree) => {
  'use strict';

  // Save ONE WEEK's project split: the old saveSplitChain. The split rule first (post-costs-page.js
  // splitFormError, the same call that enables the button), every task re-checked against the WBS, then ONE
  // PUT replaceLineProjectSplits {weekStartDate, splits} for the line: a whole-set replace scoped to the week, so a
  // double click cannot double-author. Percentages only; the server apportions dollars at post time.
  // A 404 (endpoint not deployed) applies the split on screen only and marks the week splitPersisted false, so
  // Post sends that week whole to the request's project rather than call an endpoint that is not there.
  class saveSplitChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;
      const s = v.split || {};
      const line = s.line || {};
      if (line.locked || v.isSavingSplit || v.readOnly) return;
      const slices = Array.isArray(s.slices) ? s.slices : [];
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
        const rows = (v.rowsAll || []).map((r) => (r.kind === 'week' && r.rowKey === line.rowKey
          ? Object.assign({}, r, { splits: stored, splitCount: stored.length, splitPcts: stored.map((x) => x.splitPct), splitPersisted: persisted })
          : r));
        v.rowsAll = $page.functions.applySplitDerived(rows, $page.functions.hdrOf(v.current));
        v.panel = '';
        if (!persisted) console.warn('[saveSplitChain] project-split endpoint not deployed (404): applied on screen only.');
        await Actions.fireNotificationEvent(context, {
          summary: 'Split applied',
          message: (line.equipmentName || 'This equipment') + ', ' + (line.weekLabel || 'this week') + ': '
            + stored.map((x) => x.splitPct + '% to ' + (x.projectName || x.projectNumber)).join(', ') + '. Other weeks are unaffected.',
          type: 'confirmation',
        });
      } finally {
        v.isSavingSplit = false;
      }
    }
  }

  return saveSplitChain;
});
