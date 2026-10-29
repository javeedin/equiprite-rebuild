define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/bipLov',
], (ActionChain, Actions, bipLov) => {
  'use strict';

  /**
   * Loads the Contract LOV for the Transfer drawer's destination project.
   * Exact mirror of LoadContractsChain — same BIP report/param, same
   * in-place-mutation-of-.data convention so the component never flickers.
   */
  class TransferLoadContractsChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const projectId = $page.variables.transferProjectId;

      if (!projectId) {
        $page.variables.transferContractsADP.data = [];
        return;
      }

      $page.variables.transferIsContractsLoading = true;
      try {
        const soapBody = bipLov.buildSoapBody(
          '/Custom/EquipRite/EQP_CONTRACTS_BY_PROJECT_LOV_RP.xdo',
          [{ name: 'P_PROJECT_ID', value: projectId }]
        );

        const response = await Actions.callRest(context, {
          endpoint: 'bipService/runBIPReport',
          body: soapBody,
        });

        const items = bipLov.decodeReportRows(
          response.body, 'G_1', 'CONTRACT_ID', 'CONTRACT_NUMBER', 'STATUS'
        );

        $page.variables.transferContractsADP.data = items;

        console.log('[TransferLoadContractsChain] loaded', items.length, 'contracts for project', projectId);
      } catch (e) {
        console.error('[TransferLoadContractsChain] error:', e);
        $page.variables.transferContractsADP.data = [];
      } finally {
        $page.variables.transferIsContractsLoading = false;
      }
    }
  }

  return TransferLoadContractsChain;
});
