define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Capture the destination project picked in the Transfer drawer.
   *
   * Exact mirror of AssignProjectSelectedChain: the Project field is an
   * oj-input-search whose `value` two-way-binds the display TEXT, so the id
   * and number only arrive here, off the picked row
   * ($event.detail.itemContext.data). Clears the staged task (it belonged to
   * whichever project was picked before) and reloads the task tree for the
   * new project.
   *
   * ALSO clears/reloads Contract + Ship-To-Site — mirrors
   * CaptureProjectNameChain on project-create-request-page, which resets
   * both and kicks off LoadContractsChain + LoadTaskTreeChain together
   * whenever the project changes. Ship-to-sites are contract-scoped, so
   * they're cleared here too (a new project's contract list invalidates
   * whatever sites the OLD contract had loaded).
   */
  class TransferProjectSelectedChain extends ActionChain {
    async run(context, { data } = {}) {
      const { $page } = context;

      $page.variables.transferProjectId     = data ? (data.ProjectId     || null) : null;
      $page.variables.transferProjectName   = data ? (data.ProjectName   || '')   : '';
      $page.variables.transferProjectNumber = data ? (data.ProjectNumber || '')   : '';

      $page.variables.transferTaskId     = null;
      $page.variables.transferTaskName   = '';
      $page.variables.transferTaskNumber = '';

      $page.variables.transferContractId         = null;
      $page.variables.transferSelectedContractObj = null;
      $page.variables.transferShipToSitesADP.data = [];
      $page.variables.transferShipToSitesLoaded   = false;

      await Promise.all([
        Actions.callChain(context, { chain: 'TransferLoadContractsChain' }),
        Actions.callChain(context, { chain: 'LoadTransferTaskTreeChain' })
      ]);
    }
  }

  return TransferProjectSelectedChain;
});
