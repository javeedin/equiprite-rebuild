define([
  'vb/action/actionChain',
  'resources/js/projectTaskTree',
], (ActionChain, projectTaskTree) => {
  'use strict';

  /**
   * Capture the task picked in the Assign Project drawer.
   *
   * Mirrors customer-portal TaskSelectedChain. The Task oj-select-single's
   * `value` already two-way-binds assignTaskId (TaskId is the SDP's
   * keyAttributes), but the component's value never carries TaskName/TaskNumber
   * — and those are the denormalized columns AssignProjectChain writes to
   * EQR_EQUIPMENT_REQUEST alongside the id. Fired from on-oj-value-action with
   * the picked row in $event.detail.itemContext.data.
   *
   * taskId is re-asserted here so all three land as one unit.
   *
   * ALSO rejects a summary (non-chargeable) task. The dropdown greys those rows,
   * but oj-select-single has no per-item disabled state — a greyed row is still
   * clickable — so this is where the rule is actually enforced. Rejecting at the
   * pick keeps the failure next to the cause: the alternative is a request that
   * looks fine until the OIC cost post hands PPM a summary taskNumber and the
   * import rejects the line, weeks later and three systems away.
   */
  class AssignTaskSelectedChain extends ActionChain {
    async run(context, { data } = {}) {
      const { $page } = context;

      // Fails open when the tree never loaded — see LoadTaskTreeChain.
      if (data && projectTaskTree.isSummaryTask(data, $page.variables.assignTaskTree)) {
        $page.variables.assignTaskId     = null;
        $page.variables.assignTaskName   = '';
        $page.variables.assignTaskNumber = '';
        $page.variables.assignTaskError  =
          '"' + (data.TaskNumber || '') + ' ' + (data.TaskName || '') +
          '" is a summary task and cannot take cost. Pick a task beneath it.';
        return;
      }

      $page.variables.assignTaskError  = '';
      $page.variables.assignTaskId     = data ? (data.TaskId     || null) : null;
      $page.variables.assignTaskName   = data ? (data.TaskName   || '')   : '';
      $page.variables.assignTaskNumber = data ? (data.TaskNumber || '')   : '';
    }
  }

  return AssignTaskSelectedChain;
});
