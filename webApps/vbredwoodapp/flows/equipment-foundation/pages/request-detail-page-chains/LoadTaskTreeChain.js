define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/projectTaskTree',
  'resources/js/taskDataProvider',
], (ActionChain, Actions, projectTaskTree, taskDataProvider) => {
  'use strict';

  /**
   * Point the Task dropdown at the staged project's CHARGEABLE LEAVES.
   *
   * Called by AssignProjectSelectedChain after the project changes, and by the
   * drawer-open path so an already-assigned request gets a list too.
   *
   * WHY THE PICKER IS NOT AN SDP: showing leaves only means filtering on "no
   * other row names me as parent", a property of the whole set. An SDP hands
   * its rows straight to the component and pages them, so a page can neither
   * post-process nor reason about the full list. This chain fetches all ≤500
   * rows, classifies them (projectTaskTree) and provides the survivors.
   *
   * THE PROVIDER IS ASSIGNED BEFORE THE ROWS EXIST. That is the whole trick:
   * taskDataProvider wraps the in-flight promise, so the component gets a
   * pending provider in the same tick the project changes and renders its own
   * loading skeleton when opened — the dropdown stays open and fills in place.
   * The earlier version awaited the fetch and disabled the field meanwhile,
   * which closed the dropdown out from under anyone who had opened it and
   * forced them to open it again. Do not reintroduce a `disabled` binding for
   * loading, and do not await before assigning.
   *
   * FAILS OPEN ON CLASSIFICATION, not on the fetch. If the rows arrive but
   * carry no usable hierarchy signal, buildTaskTree yields no summary ids,
   * leafTasks returns everything, and the dropdown lists the whole WBS — the
   * behaviour before summary filtering existed. Better to show a row the save
   * chain will reject than to hide a task the user needs. A FAILED fetch
   * resolves the provider to an empty list (see taskDataProvider) — the same
   * empty dropdown the SDP produced when its own fetch failed.
   *
   * ALSO: totalResults is explicitly false (the openapi default is true, which
   * costs a COUNT query per fetch that nothing reads), and an unchanged project
   * is skipped entirely rather than refetched.
   */
  class LoadTaskTreeChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const projectId = $page.variables.assignProjectId;

      $page.variables.assignTaskError = '';

      if (!projectId) {
        // Resolved-empty, not pending: there is no work in flight, so the
        // dropdown should say so at once rather than skeleton forever.
        $page.variables.assignTasksDp = taskDataProvider.emptyTaskDataProvider();
        $page.variables.assignTaskTree = {};
        $page.variables.assignTasksCacheKey = '';
        return;
      }

      // Same project the dropdown already holds — leave its provider alone.
      // Reassigning would rebuild it and make a resolved list skeleton again
      // for no reason. Tasks do not change mid-session, and the key dies with
      // the page. One key, not a map: switching A → B → A still refetches A.
      if ($page.variables.assignTasksCacheKey === String(projectId)) return;

      $page.variables.assignTasksCacheKey = '';
      $page.variables.assignTaskTree = {};

      const rowsPromise = Actions.callRest(context, {
        endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05ProjectTasks',
        uriParams: {
          ProjectId: projectId,
          // ParentTaskId is the whole point of this call — see projectTaskTree.js.
          fields: 'TaskId,TaskNumber,TaskName,ParentTaskId',
          // Beyond this the list pages and leaf-detection degrades to
          // listing summary tasks again for the overflow.
          limit: 500,
          onlyData: true,
          // Override the openapi default (true) — a COUNT query we never read.
          totalResults: false
        }
      }).then((resp) => {
        if (!resp || !resp.ok || !resp.body) return [];
        const tree = projectTaskTree.buildTaskTree(resp.body);
        // The selection chains re-check picks against this, so it has to be in
        // place by the time a row can be clicked — which it is, since a row
        // cannot be clicked until these same rows have rendered.
        $page.variables.assignTaskTree = tree;
        $page.variables.assignTasksCacheKey = String(projectId);
        return projectTaskTree.leafTasks(resp.body, tree);
      });

      // Hand over the PENDING provider now — not after the await below.
      $page.variables.assignTasksDp =
        taskDataProvider.deferredTaskDataProvider(rowsPromise);

      // Awaited only so a caller that sequences work after this chain sees a
      // settled state. The dropdown is already live and skeletoning; nothing
      // the user can see is waiting on this.
      try {
        await rowsPromise;
      } catch (e) {
        console.warn('LoadTaskTreeChain: task list unavailable', e);
      }
    }
  }

  return LoadTaskTreeChain;
});
