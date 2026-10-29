define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/bipLov',
], (ActionChain, Actions, bipLov) => {
  'use strict';

  /**
   * Loads Ship-To-Sites for the Transfer drawer's project+contract. Exact
   * mirror of LoadShipToSitesChain — gated on CONTRACT alone (the report
   * returns sites for every customer on the contract).
   */
  class TransferLoadShipToSitesChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const projectId  = $page.variables.transferProjectId;
      const contractId = $page.variables.transferContractId;

      if (!projectId || !contractId) {
        $page.variables.transferShipToSitesADP.data = [];
        $page.variables.transferShipToSitesLoaded   = false;
        return;
      }

      $page.variables.transferIsShipToSitesLoading = true;
      $page.variables.transferShipToSitesLoaded    = false;
      try {
        const soapBody = bipLov.buildSoapBody(
          '/Custom/EquipRite/EQP_SHIP_TO_SITES_BY_CONTRACT_LOV_RP.xdo',
          [
            { name: 'P_PROJECT_ID',  value: projectId },
            { name: 'P_CONTRACT_ID', value: contractId }
          ]
        );

        const response = await Actions.callRest(context, {
          endpoint: 'bipService/runBIPReport',
          body: soapBody,
        });

        const items = bipLov.decodeReportRows(
          response.body, 'G_1', 'SITE_ADDRESS', 'SITE_ADDRESS', 'CUSTOMER_NAME'
        );

        $page.variables.transferShipToSitesADP.data = items;

        console.log('[TransferLoadShipToSitesChain] loaded', items.length, 'ship-to sites for project', projectId, 'contract', contractId);
      } catch (e) {
        console.error('[TransferLoadShipToSitesChain] error:', e);
        $page.variables.transferShipToSitesADP.data = [];
      } finally {
        $page.variables.transferIsShipToSitesLoading = false;
        $page.variables.transferShipToSitesLoaded = true;
      }
    }
  }

  return TransferLoadShipToSitesChain;
});
