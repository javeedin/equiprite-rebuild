define([
  'vb/action/actionChain',
  'resources/js/projectTaskTree',
  'resources/js/taskDataProvider',
], (ActionChain, projectTaskTree, taskDataProvider) => {
  'use strict';

  const MAX_SLICES = 5;

  /*
   * Commit the add-a-slice sub-form into splitSlices, then reset it.
   *
   * The sub-form exists because the drawer holds ONE project search and ONE task
   * provider: N inline pickers would all read the same splitProjectSearchQ and
   * the same splitTasksDp, so typing in slice 2 would refill slice 1's
   * suggestions. See the comment on the drawer markup.
   */
  class addSplitSliceChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const projectRefId  = $page.variables.splitPickProjectId;
      const projectNumber = $page.variables.splitPickProjectNumber;
      const taskId        = $page.variables.splitPickTaskId;
      const pctRaw        = $page.variables.splitPickPct;

      $page.variables.splitFormError = '';

      if (!projectRefId || !projectNumber) {
        $page.variables.splitFormError = 'Pick a project from the list before adding it.';
        return;
      }
      if (!taskId) {
        $page.variables.splitFormError = 'Pick a task. PPM can only take cost on a '
          + 'lowest-level task, so a project on its own cannot be posted to.';
        return;
      }
      if (pctRaw == null || !(Number(pctRaw) > 0)) {
        $page.variables.splitFormError = 'Enter a percentage greater than zero for this project.';
        return;
      }

      const slices = Array.isArray($page.variables.splitSlices)
        ? $page.variables.splitSlices.slice()
        : [];

      if (slices.length >= MAX_SLICES) {
        $page.variables.splitFormError = 'A split can cover at most ' + MAX_SLICES
          + ' projects. Remove one before adding another.';
        return;
      }

      // (projectRefId, taskId) is the ledger's slice identity: it is what the
      // deterministic REVERSAL_REF is built from and what the unique index keys
      // on, so two slices sharing it would collide on insert -- and Fusion would
      // net them into one line anyway.
      const dup = slices.some(function (s) {
        return String(s.projectRefId) === String(projectRefId)
            && String(s.taskId) === String(taskId);
      });
      if (dup) {
        $page.variables.splitFormError = 'Project ' + projectNumber + ' / task '
          + ($page.variables.splitPickTaskNumber || taskId)
          + ' is already in this split. Change its percentage instead.';
        return;
      }

      // Belt and braces. splitTaskSelectedChain already refuses a summary task at
      // the pick, but the value can be set by any other route, and this is the
      // last point before it becomes a committed slice.
      const picked = { TaskId: taskId, TaskNumber: $page.variables.splitPickTaskNumber };
      if (projectTaskTree.isSummaryTask(picked, $page.variables.splitTaskTree)) {
        $page.variables.splitFormError = 'That is a summary task and cannot take cost. '
          + 'Pick a task beneath it.';
        return;
      }

      // REASSIGN the whole array -- VBCS will not see a push/splice in place.
      $page.variables.splitSlices = slices.concat([{
        projectRefId:  Number(projectRefId),
        projectNumber: String(projectNumber),
        projectName:   $page.variables.splitPickProjectName || '',
        taskId:        Number(taskId),
        taskNumber:    $page.variables.splitPickTaskNumber || '',
        taskName:      $page.variables.splitPickTaskName || '',
        pct:           Number(pctRaw)
      }]);

      // Clear the sub-form so the next slice starts clean and the just-added
      // project cannot be added twice by a second click on Add.
      $page.variables.splitPickProjectId     = null;
      $page.variables.splitPickProjectName   = '';
      $page.variables.splitPickProjectNumber = '';
      $page.variables.splitPickTaskId        = null;
      $page.variables.splitPickTaskName      = '';
      $page.variables.splitPickTaskNumber    = '';
      $page.variables.splitPickPct           = null;
      $page.variables.splitTaskError         = '';
      $page.variables.splitTasksDp      = taskDataProvider.emptyTaskDataProvider();
      $page.variables.splitTaskTree     = {};
      $page.variables.splitTasksCacheKey = '';
    }
  }

  return addSplitSliceChain;
});
