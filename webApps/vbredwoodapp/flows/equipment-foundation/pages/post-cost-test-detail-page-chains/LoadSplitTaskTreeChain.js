define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/projectTaskTree',
  'resources/js/taskDataProvider',
], (ActionChain, Actions, projectTaskTree, taskDataProvider) => {
  'use strict';

  /**
   * Point the split drawer's Task dropdown at the picked project's CHARGEABLE
   * LEAVES. Clone of request-detail-page-chains/LoadTaskTreeChain -- every
   * property below is load-bearing there and kept for the same reasons.
   *
   * NOT AN SDP: "no other row names me as parent" is a property of the whole
   * set, which no Fusion q predicate can express and an SDP (which pages) cannot
   * reason about. So fetch all <=500 rows, classify them, provide the survivors.
   *
   * THE PROVIDER IS ASSIGNED BEFORE THE ROWS EXIST -- that is the trick.
   * deferredTaskDataProvider wraps the in-flight promise, so the component gets
   * a pending provider in the same tick and renders JET's own skeleton when
   * opened; the dropdown stays open and fills in place. Do NOT await before
   * assigning, and do NOT add a `disabled` binding for loading: a disabled
   * oj-select-single closes its own dropdown.
   *
   * FAILS OPEN on classification, not on the fetch: no usable hierarchy signal
   * means no summary ids, so the whole WBS is listed -- the behaviour before
   * summary filtering existed.
   *
   * And note the local mirror is NOT a substitute for this call: EQR_TASK_T holds
   * 100,571 rows with PARENT_TASK_NUMBER NULL on every single one, so it cannot
   * tell a summary task from a chargeable one, and it is incomplete besides
   * (task 1.1.1 is absent from project 10011 entirely). Chargeability has to come
   * from Fusion live.
   */
  class LoadSplitTaskTreeChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const projectId = $page.variables.splitPickProjectId;

      $page.variables.splitTaskError = '';

      if (!projectId) {
        // Resolved-empty, not pending: nothing is in flight, so the dropdown
        // should say so at once rather than skeleton forever.
        $page.variables.splitTasksDp = taskDataProvider.emptyTaskDataProvider();
        $page.variables.splitTaskTree = {};
        $page.variables.splitTasksCacheKey = '';
        return;
      }

      // Same project the dropdown already holds -- leave its provider alone;
      // rebuilding would make a resolved list skeleton again for nothing. One
      // key, not a map: A -> B -> A refetches A, which is cheap and correct.
      if ($page.variables.splitTasksCacheKey === String(projectId)) return;

      $page.variables.splitTasksCacheKey = '';
      $page.variables.splitTaskTree = {};

      const rowsPromise = Actions.callRest(context, {
        endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05ProjectTasks',
        uriParams: {
          ProjectId: projectId,
          // ParentTaskId is the entire point of this call -- see projectTaskTree.js.
          fields: 'TaskId,TaskNumber,TaskName,ParentTaskId',
          // Beyond this the list pages and leaf-detection degrades to listing
          // summary tasks again for the overflow.
          limit: 500,
          onlyData: true,
          // Override the openapi default (true) -- a COUNT query nothing reads.
          totalResults: false
        }
      }).then((resp) => {
        if (!resp || !resp.ok || !resp.body) return [];
        const tree = projectTaskTree.buildTaskTree(resp.body);
        // The selection chain re-checks picks against this, so it has to be in
        // place before a row can be clicked -- which it is, since a row cannot be
        // clicked until these same rows have rendered.
        $page.variables.splitTaskTree = tree;
        $page.variables.splitTasksCacheKey = String(projectId);
        return projectTaskTree.leafTasks(resp.body, tree);
      });

      // Hand over the PENDING provider now -- not after the await below.
      $page.variables.splitTasksDp =
        taskDataProvider.deferredTaskDataProvider(rowsPromise);

      // Awaited only so splitProjectSelectedChain sees a settled state; the
      // dropdown is already live and skeletoning.
      try {
        await rowsPromise;
      } catch (e) {
        console.warn('LoadSplitTaskTreeChain: task list unavailable', e);
      }
    }
  }

  return LoadSplitTaskTreeChain;
});
