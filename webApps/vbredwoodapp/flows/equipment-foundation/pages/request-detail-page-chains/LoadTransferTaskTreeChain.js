define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/projectTaskTree',
  'resources/js/taskDataProvider',
], (ActionChain, Actions, projectTaskTree, taskDataProvider) => {
  'use strict';

  /**
   * Point the Transfer drawer's Task dropdown at the staged destination
   * project's CHARGEABLE LEAVES. Exact mirror of LoadTaskTreeChain, scoped to
   * transfer* variables — see that file for the full rationale (deferred
   * provider handed over pending, summary-task filtering, cache-by-project).
   */
  class LoadTransferTaskTreeChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const projectId = $page.variables.transferProjectId;

      $page.variables.transferTaskError = '';

      if (!projectId) {
        $page.variables.transferTasksDp = taskDataProvider.emptyTaskDataProvider();
        $page.variables.transferTaskTree = {};
        $page.variables.transferTasksCacheKey = '';
        return;
      }

      if ($page.variables.transferTasksCacheKey === String(projectId)) return;

      $page.variables.transferTasksCacheKey = '';
      $page.variables.transferTaskTree = {};

      const rowsPromise = Actions.callRest(context, {
        endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05ProjectTasks',
        uriParams: {
          ProjectId: projectId,
          fields: 'TaskId,TaskNumber,TaskName,ParentTaskId',
          limit: 500,
          onlyData: true,
          totalResults: false
        }
      }).then((resp) => {
        if (!resp || !resp.ok || !resp.body) return [];
        const tree = projectTaskTree.buildTaskTree(resp.body);
        $page.variables.transferTaskTree = tree;
        $page.variables.transferTasksCacheKey = String(projectId);
        return projectTaskTree.leafTasks(resp.body, tree);
      });

      $page.variables.transferTasksDp =
        taskDataProvider.deferredTaskDataProvider(rowsPromise);

      try {
        await rowsPromise;
      } catch (e) {
        console.warn('LoadTransferTaskTreeChain: task list unavailable', e);
      }
    }
  }

  return LoadTransferTaskTreeChain;
});
