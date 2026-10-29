define([
  'vb/action/actionChain',
  'resources/js/projectTaskTree',
], (ActionChain, projectTaskTree) => {
  'use strict';

  /**
   * Capture the destination task picked in the Transfer drawer. Exact mirror
   * of AssignTaskSelectedChain — rejects a summary (non-chargeable) task
   * against transferTaskTree, since a summary task cannot take cost in PPM
   * any more at the destination than it could at the source.
   */
  class TransferTaskSelectedChain extends ActionChain {
    async run(context, { data } = {}) {
      const { $page } = context;

      if (data && projectTaskTree.isSummaryTask(data, $page.variables.transferTaskTree)) {
        $page.variables.transferTaskId     = null;
        $page.variables.transferTaskName   = '';
        $page.variables.transferTaskNumber = '';
        $page.variables.transferTaskError  =
          '"' + (data.TaskNumber || '') + ' ' + (data.TaskName || '') +
          '" is a summary task and cannot take cost. Pick a task beneath it.';
        return;
      }

      $page.variables.transferTaskError  = '';
      $page.variables.transferTaskId     = data ? (data.TaskId     || null) : null;
      $page.variables.transferTaskName   = data ? (data.TaskName   || '')   : '';
      $page.variables.transferTaskNumber = data ? (data.TaskNumber || '')   : '';
    }
  }

  return TransferTaskSelectedChain;
});
