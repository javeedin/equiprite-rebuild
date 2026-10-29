define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/projectTaskTree',
  'resources/js/taskDataProvider',
], (ActionChain, Actions, projectTaskTree, taskDataProvider) => {
  'use strict';

  /**
   * Point the Task dropdown at the selected project's CHARGEABLE LEAVES.
   *
   * Mirror of request-detail-page-chains/LoadTaskTreeChain.js — see that file
   * for why the picker is not an SDP, why the provider is assigned BEFORE the
   * rows exist (so the dropdown skeletons in place instead of being disabled
   * shut), and how it degrades. The only difference is where the project id
   * lives: here it is the flow-level request.projectId (the draft being built),
   * there it is a page-level staged assignProjectId.
   *
   * Called by CaptureProjectNameChain after the project changes, and by
   * HydrateDraftChain so a restored draft gets a list without the user having
   * to re-pick the project.
   */
  class LoadTaskTreeChain extends ActionChain {
    async run(context) {
      const { $page, $flow } = context;
      const projectId = $flow.variables.request && $flow.variables.request.projectId;

      $page.variables.taskError = '';

      if (!projectId) {
        // Resolved-empty, not pending: no work in flight to skeleton over.
        $page.variables.tasksDp = taskDataProvider.emptyTaskDataProvider();
        $page.variables.taskTree = {};
        $page.variables.tasksCacheKey = '';
        return;
      }

      // Same project the dropdown already holds — leave its provider alone.
      if ($page.variables.tasksCacheKey === String(projectId)) return;

      $page.variables.tasksCacheKey = '';
      $page.variables.taskTree = {};

      const rowsPromise = Actions.callRest(context, {
        endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05ProjectTasks',
        uriParams: {
          ProjectId: projectId,
          fields: 'TaskId,TaskNumber,TaskName,ParentTaskId',
          limit: 500,
          onlyData: true,
          // Override the openapi default (true) — a COUNT query we never read.
          totalResults: false
        }
      }).then((resp) => {
        if (!resp || !resp.ok || !resp.body) return [];
        const tree = projectTaskTree.buildTaskTree(resp.body);
        $page.variables.taskTree = tree;
        $page.variables.tasksCacheKey = String(projectId);
        return projectTaskTree.leafTasks(resp.body, tree);
      });

      // Hand over the PENDING provider now — not after the await below.
      $page.variables.tasksDp = taskDataProvider.deferredTaskDataProvider(rowsPromise);

      try {
        await rowsPromise;
      } catch (e) {
        console.warn('LoadTaskTreeChain: task list unavailable', e);
      }
    }
  }

  return LoadTaskTreeChain;
});
