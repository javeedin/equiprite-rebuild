define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/projectTaskTree',
], (ActionChain, Actions, projectTaskTree) => {
  'use strict';

  // Building a week's project split in the split dialog: New's Post costs splitChain, action for action.
  //   search    Fusion projectsLOV with q "ProjectName LIKE '*text*'" (server-side: the pod holds thousands of projects),
  //             from 2 characters; a slower, older answer is dropped
  //   project   the project's tasks from Fusion (with ParentTaskId), classified by projectTaskTree, and only the
  //             CHARGEABLE LEAVES offered
  //   task      a summary task is refused (PPM rejects it at cost import, days later)
  //   add       project, task and a percentage; at most 5 slices; no repeated project + task
  //   remove, slicePct, evenly (basis points)
  // Saving and clearing are saveSplitChain and clearSplitChain. A native input stops following its bound value once
  // typed in, so the percentages written here (evenly, a new slice) are put into the inputs too.
  const MAX_SLICES = 5;
  const EMPTY_PICK = { projectId: null, projectName: '', projectNumber: '', taskId: null, taskName: '', taskNumber: '', pct: null };

  function showPcts(slices, clearPick) {
    const pcts = slices.map((x) => (x.pct == null ? '' : String(x.pct)));
    // after the dialog has drawn the new slices
    setTimeout(() => {
      try {
        if (typeof document === 'undefined' || !document.querySelectorAll) return;
        document.querySelectorAll('.nx-pp-pct[data-index]').forEach((el) => {
          const i = Number(el.dataset.index);
          if (i < pcts.length) el.value = pcts[i];
        });
        if (clearPick) document.querySelectorAll('.nx-pp-pickpct').forEach((el) => { el.value = ''; });
      } catch (e) { /* the dialog was closed */ }
    }, 0);
  }

  class splitChain extends ActionChain {
    async run(context, { action, value, index }) {
      const { $page } = context;
      const v = $page.variables;
      const s = Object.assign({}, v.split || {});
      if (!s.line || s.line.locked || v.readOnly) return;
      const set = (patch) => { v.split = Object.assign({}, v.split, patch); };
      // plain copies: they are read again once v.split has been replaced
      const slices = (Array.isArray(s.slices) ? s.slices : []).map((x) => ({ projectRefId: x.projectRefId, projectNumber: x.projectNumber,
        projectName: x.projectName, taskId: x.taskId, taskNumber: x.taskNumber, taskName: x.taskName, pct: x.pct }));

      if (action === 'search') {
        const q = value == null ? '' : String(value).trim();
        set({ query: q, error: '' });
        if (q.length < 2) {
          set({ results: [], searching: false });
          return;
        }
        set({ searching: true });
        let items = [];
        try {
          const res = await Actions.callRest(context, {
            endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05ProjectsLOV',
            uriParams: { q: "ProjectName LIKE '*" + q.replace(/'/g, "''") + "*'", fields: 'ProjectId,ProjectNumber,ProjectName', limit: 25 },
          });
          items = res && res.ok && res.body && Array.isArray(res.body.items) ? res.body.items : [];
        } catch (e) {
          console.warn('[splitChain] project search failed', e && e.message);
        }
        if (v.split && v.split.query === q) set({ results: items.slice(0, 25), searching: false });
        return;
      }

      if (action === 'project') {
        const hit = (s.results || [])[Number(index)];
        if (!hit) return;
        // a plain copy: the picked result is read again after v.split is replaced
        const p = { ProjectId: hit.ProjectId, ProjectName: hit.ProjectName, ProjectNumber: hit.ProjectNumber };
        set({ pick: Object.assign({}, EMPTY_PICK, { projectId: p.ProjectId || null, projectName: p.ProjectName || '', projectNumber: p.ProjectNumber || '' }),
          results: [], query: '', tasks: [], taskQuery: '', tree: {}, taskError: '' });
        let rows = [];
        let tree = {};
        try {
          const res = await Actions.callRest(context, {
            endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05ProjectTasks',
            uriParams: { ProjectId: p.ProjectId, fields: 'TaskId,TaskNumber,TaskName,ParentTaskId', limit: 500, onlyData: true, totalResults: false },
          });
          if (res && res.ok && res.body) {
            tree = projectTaskTree.buildTaskTree(res.body);
            rows = projectTaskTree.leafTasks(res.body, tree);
          }
        } catch (e) {
          console.warn('[splitChain] task list unavailable', e && e.message);
        }
        if (v.split && v.split.pick && v.split.pick.projectId === p.ProjectId) set({ tasks: rows, tree });
        return;
      }

      if (action === 'taskQuery') {
        set({ taskQuery: value == null ? '' : String(value) });
        return;
      }

      if (action === 'task') {
        const t = $page.functions.taskMatches(s.tasks, s.taskQuery)[Number(index)];
        if (!t) return;
        if (projectTaskTree.isSummaryTask(t, s.tree)) {
          set({ pick: Object.assign({}, s.pick, { taskId: null, taskName: '', taskNumber: '' }),
            taskError: '"' + (t.TaskNumber || '') + ' ' + (t.TaskName || '') + '" is a summary task and cannot take cost. Pick a task beneath it.' });
          return;
        }
        set({ pick: Object.assign({}, s.pick, { taskId: t.TaskId || null, taskName: t.TaskName || '', taskNumber: t.TaskNumber || '' }), taskError: '' });
        return;
      }

      if (action === 'pickPct') {
        set({ pick: Object.assign({}, s.pick, { pct: value === '' || value == null ? null : Number(value) }) });
        return;
      }

      if (action === 'add') {
        const pick = s.pick || EMPTY_PICK;
        let err = '';
        if (!pick.projectId || !pick.projectNumber) err = 'Pick a project from the list before adding it.';
        else if (!pick.taskId) err = 'Pick a task. PPM can only take cost on a lowest-level task, so a project on its own cannot be posted to.';
        else if (pick.pct == null || !(Number(pick.pct) > 0)) err = 'Enter a percentage greater than zero for this project.';
        else if (slices.length >= MAX_SLICES) err = 'A split can cover at most ' + MAX_SLICES + ' projects. Remove one before adding another.';
        else if (slices.some((x) => String(x.projectRefId) === String(pick.projectId) && String(x.taskId) === String(pick.taskId))) {
          err = 'Project ' + pick.projectNumber + ' / task ' + (pick.taskNumber || pick.taskId) + ' is already in this split. Change its percentage instead.';
        } else if (projectTaskTree.isSummaryTask({ TaskId: pick.taskId, TaskNumber: pick.taskNumber }, s.tree)) {
          err = 'That is a summary task and cannot take cost. Pick a task beneath it.';
        }
        if (err) {
          set({ error: err });
          return;
        }
        const next = slices.concat([{ projectRefId: Number(pick.projectId), projectNumber: String(pick.projectNumber), projectName: pick.projectName || '',
          taskId: Number(pick.taskId), taskNumber: pick.taskNumber || '', taskName: pick.taskName || '', pct: Number(pick.pct) }]);
        set({ slices: next, pick: Object.assign({}, EMPTY_PICK), tasks: [], taskQuery: '', tree: {}, taskError: '', error: '' });
        showPcts(next, true);
        return;
      }

      if (action === 'remove') {
        const i = Number(index);
        if (!(i >= 0 && i < slices.length)) return;
        const next = slices.filter((x, j) => j !== i);
        set({ slices: next, error: '' });
        showPcts(next);
        return;
      }

      if (action === 'slicePct') {
        const i = Number(index);
        if (!(i >= 0 && i < slices.length)) return;
        const pct = value === '' || value == null ? null : Number(value);
        set({ slices: slices.map((x, j) => (j === i ? Object.assign({}, x, { pct }) : x)), error: '' });
        return;
      }

      if (action === 'evenly') {
        const next = $page.functions.splitEvenly(slices);
        set({ slices: next, error: '' });
        showPcts(next);
      }
    }
  }

  return splitChain;
});
