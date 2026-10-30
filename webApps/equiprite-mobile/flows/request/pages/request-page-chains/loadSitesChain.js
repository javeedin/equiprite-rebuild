define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/bipLov',
], (ActionChain, Actions, bipLov) => {
  'use strict';

  // Ship-to sites of the chosen contract on this project (BIP EQP_SHIP_TO_SITES_BY_CONTRACT_LOV_RP, as the old
  // LoadShipToSitesChain and New EquipRite's loadSitesChain). The site's address is its id, so picking one sets the
  // delivery location directly; CUSTOMER_NAME (label2) says whose site it is.
  class loadSitesChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const form = $page.variables.form || {};
      if (!form.projectId || form.contractId == null || form.contractId === '') {
        $page.variables.siteOptions = [];
        $page.variables.sitesLoaded = false;
        return;
      }
      $page.variables.sitesLoading = true;
      $page.variables.sitesLoaded = false;
      try {
        const res = await Actions.callRest(context, {
          endpoint: 'bipService/runBIPReport',
          body: bipLov.buildSoapBody('/Custom/EquipRite/EQP_SHIP_TO_SITES_BY_CONTRACT_LOV_RP.xdo', [
            { name: 'P_PROJECT_ID', value: form.projectId },
            { name: 'P_CONTRACT_ID', value: form.contractId },
          ]),
        });
        $page.variables.siteOptions = bipLov.decodeReportRows(res && res.body, 'G_1', 'SITE_ADDRESS', 'SITE_ADDRESS', 'CUSTOMER_NAME');
      } catch (e) {
        console.error('[loadSitesChain]', e);
        $page.variables.siteOptions = [];
      } finally {
        $page.variables.sitesLoading = false;
        $page.variables.sitesLoaded = true;
      }
    }
  }

  return loadSitesChain;
});
