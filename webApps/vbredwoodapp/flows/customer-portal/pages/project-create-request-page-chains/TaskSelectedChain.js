define([
  'vb/action/actionChain',
  'resources/js/projectTaskTree',
], (ActionChain, projectTaskTree) => {
  'use strict';

  // Fired by the Task oj-select-single's on-oj-value-action, with the picked
  // row from $event.detail.itemContext.data (NOT .value, which is the scalar
  // key). value="{{ request.taskId }}" already two-way-binds the id; this chain
  // exists for TaskName/TaskNumber, which the component's value never carries
  // and which NavigateToCatalogChain/the submit payload both need. taskId is
  // re-asserted here too so the three stay written as one unit.
  //
  // ALSO rejects a summary (non-chargeable) task — see the fuller note on
  // request-detail-page-chains/AssignTaskSelectedChain.js. The dropdown greys
  // those rows, but oj-select-single has no per-item disabled state, so the
  // rule is enforced here.
  class TaskSelectedChain extends ActionChain {
    async run(context, { data } = {}) {
      const { $page, $flow } = context;

      // Fails open when the tree never loaded — see LoadTaskTreeChain.
      if (data && projectTaskTree.isSummaryTask(data, $page.variables.taskTree)) {
        $page.variables.selectedTaskName   = '';
        $flow.variables.request.taskId     = null;
        $flow.variables.request.taskName   = '';
        $flow.variables.request.taskNumber = '';
        $page.variables.taskError =
          '"' + (data.TaskNumber || '') + ' ' + (data.TaskName || '') +
          '" is a summary task and cannot take cost. Pick a task beneath it.';
        return;
      }

      const id     = data ? (data.TaskId     || null) : null;
      const name   = data ? (data.TaskName   || '') : '';
      const number = data ? (data.TaskNumber || '') : '';

      $page.variables.taskError          = '';
      $page.variables.selectedTaskName   = name;
      $flow.variables.request.taskId     = id;
      $flow.variables.request.taskName   = name;
      $flow.variables.request.taskNumber = number;
    }
  }

  return TaskSelectedChain;
});
