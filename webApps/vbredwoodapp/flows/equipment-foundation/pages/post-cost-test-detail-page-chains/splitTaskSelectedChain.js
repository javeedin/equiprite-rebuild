define([
  'vb/action/actionChain',
  'resources/js/projectTaskTree',
], (ActionChain, projectTaskTree) => {
  'use strict';

  /**
   * Capture the task picked in the split drawer, and REFUSE a summary task.
   *
   * Clone of AssignTaskSelectedChain. The oj-select-single's `value` already
   * binds splitPickTaskId (TaskId is the provider's keyAttributes), but the
   * component never carries TaskName/TaskNumber -- and TASK_NUMBER is what
   * actually posts to PPM as _TASK_ID_Display. taskId is re-asserted here so all
   * three land as one unit.
   *
   * The summary check matters more here than anywhere else on this page: a split
   * multiplies the number of (project, task) pairs one equipment posts against,
   * and a summary task is accepted by the LOV and then rejected at cost import --
   * days later, three systems from the cause, with the money already recorded
   * locally. There is $1,523 stranded on dev today from exactly that
   * (REQ-1786096667530, project 10011, task 1.1.1).
   *
   * oj-select-single has no per-item disabled state, so even when the summary
   * rows are filtered out of the provider this is where the rule is actually
   * enforced. It FAILS OPEN when the tree never loaded (see projectTaskTree.js):
   * better to offer a row the server rejects than to hide a task the user needs.
   * So this is a guard, not a guarantee -- Fusion's import is the real backstop.
   */
  class splitTaskSelectedChain extends ActionChain {
    async run(context, { data } = {}) {
      const { $page } = context;

      if (data && projectTaskTree.isSummaryTask(data, $page.variables.splitTaskTree)) {
        $page.variables.splitPickTaskId     = null;
        $page.variables.splitPickTaskName   = '';
        $page.variables.splitPickTaskNumber = '';
        $page.variables.splitTaskError =
          '"' + (data.TaskNumber || '') + ' ' + (data.TaskName || '')
          + '" is a summary task and cannot take cost. Pick a task beneath it.';
        return;
      }

      $page.variables.splitTaskError      = '';
      $page.variables.splitPickTaskId     = data ? (data.TaskId     || null) : null;
      $page.variables.splitPickTaskName   = data ? (data.TaskName   || '')   : '';
      $page.variables.splitPickTaskNumber = data ? (data.TaskNumber || '')   : '';
    }
  }

  return splitTaskSelectedChain;
});
