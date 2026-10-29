define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/projectBusinessUnit',
], (ActionChain, Actions, projectBusinessUnit) => {
  'use strict';

  /**
   * Capture the project picked in the Assign Project drawer.
   *
   * Mirrors customer-portal CaptureProjectNameChain: the Project field is an
   * oj-input-search whose `value` two-way-binds the display TEXT, so the id and
   * number only ever arrive here, off the picked row
   * ($event.detail.itemContext.data). Without this chain we would have a name on
   * screen and no ProjectId to PATCH.
   *
   * Switching projects also clears the staged task: the previously picked task
   * belongs to the OLD project and is no longer in the LOV. VB does not clear it
   * for us, so without this the select would keep rendering a stale label and
   * Save would PATCH a task from a different project onto the request.
   *
   * The list itself does not reload on its own either — assignTasksDp is a plain
   * provider with no assignProjectId binding to react to (the SDP it replaced
   * re-fetched off its ProjectId path parameter). LoadTaskTreeChain below is
   * what replaces it.
   */
  class AssignProjectSelectedChain extends ActionChain {
    async run(context, { data } = {}) {
      const { $page } = context;

      const projectId = data ? (data.ProjectId || null) : null;

      $page.variables.assignProjectId     = projectId;
      $page.variables.assignProjectName   = data ? (data.ProjectName   || '')   : '';
      $page.variables.assignProjectNumber = data ? (data.ProjectNumber || '')   : '';

      // The project's Fusion BUSINESS UNIT. Cleared with the project for the
      // same reason the task is: it belongs to the project being replaced, and
      // an old BU on a new project would post cost against the wrong one.
      //
      // It is not on the picked row — assignProjectsSDP requests only
      // ProjectId,ProjectNumber,ProjectName, and projectsLOV has no
      // BusinessUnit attribute to request — so it takes its own call against
      // projects/{ProjectId}. See resources/js/projectBusinessUnit.js.
      $page.variables.assignProjectBuId   = null;
      $page.variables.assignProjectBuName = '';

      // Clear the dependent task selection — see above.
      $page.variables.assignTaskId     = null;
      $page.variables.assignTaskName   = '';
      $page.variables.assignTaskNumber = '';

      // Reclassify the new project's WBS. The tree is per-project, so leaving
      // the old one in place would grey out the wrong rows in the new list —
      // and, worse, could let a summary task of the new project through
      // because it happened not to be a parent in the old one. Awaited so the
      // dropdown never renders against a stale tree.
      //
      // The business-unit lookup rides alongside it: an independent Fusion
      // round-trip on the same project id, with its own try/catch inside the
      // helper, so it can neither fail the pick nor delay the tree.
      const [, bu] = await Promise.all([
        Actions.callChain(context, { chain: 'LoadTaskTreeChain' }),
        projectBusinessUnit.fetchForProject(context, Actions, projectId)
      ]);

      // Only apply it if this pick is still the current one — two quick picks
      // can otherwise resolve out of order and stamp the first project's BU
      // onto the second.
      if (bu && $page.variables.assignProjectId === projectId) {
        $page.variables.assignProjectBuId   = bu.id;
        $page.variables.assignProjectBuName = bu.name;
      }
    }
  }

  return AssignProjectSelectedChain;
});
