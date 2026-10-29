define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Capture the project picked in the split drawer's add-a-slice sub-form.
   *
   * Clone of AssignProjectSelectedChain. The Project field is an oj-input-search
   * whose `value` two-way-binds the display TEXT only, so the id and number
   * arrive ONLY here, off the picked row ($event.detail.itemContext.data).
   * Without this we would have a name on screen and no ProjectId to save.
   *
   * Changing the project clears the staged task: the previous task belongs to the
   * OLD project and is not in the new LOV. VB does not clear it, and the provider
   * does not reload on its own -- splitTasksDp is a plain provider with no
   * ProjectId binding to cascade off -- so LoadSplitTaskTreeChain is what
   * replaces it.
   *
   * NOT DONE HERE, and worth knowing: nothing validates that the picked project
   * belongs to the business unit this cost will post under. Fusion posting
   * hardcodes BusinessUnit to the literal 'US1 Business Unit' (there is no BU
   * column anywhere in EQP_P_FUSION_POST_QUEUE, and PROJECT_BU_NAME is NULL on
   * all 408 requests), so a project outside that BU would post under the wrong
   * one and fail at cost import days later. projectsLOV does not return
   * BusinessUnitId so the list cannot be pre-filtered; the fix is a
   * ProjectLOV/...ProjectsById call here on pick, which returns BusinessUnitId,
   * TransactionControlFlag and OwningOrganizationId together. Deferred, not
   * forgotten -- see MD/Post Cost/project-split/UNDERSTANDING_AND_OPEN_QUESTIONS.md
   */
  class splitProjectSelectedChain extends ActionChain {
    async run(context, { data } = {}) {
      const { $page } = context;

      $page.variables.splitPickProjectId     = data ? (data.ProjectId     || null) : null;
      $page.variables.splitPickProjectName   = data ? (data.ProjectName   || '')   : '';
      $page.variables.splitPickProjectNumber = data ? (data.ProjectNumber || '')   : '';

      // Clear the dependent task pick -- see above.
      $page.variables.splitPickTaskId     = null;
      $page.variables.splitPickTaskName   = '';
      $page.variables.splitPickTaskNumber = '';
      $page.variables.splitTaskError      = '';

      // Reclassify the new project's WBS. The tree is per-project, so leaving the
      // old one in place could let a summary task of the NEW project through
      // because it happened not to be a parent in the old one. Awaited so the
      // dropdown never renders against a stale tree.
      await Actions.callChain(context, { chain: 'LoadSplitTaskTreeChain' });
    }
  }

  return splitProjectSelectedChain;
});
