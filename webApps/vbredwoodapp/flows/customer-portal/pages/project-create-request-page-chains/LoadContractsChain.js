define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/bipLov',
], (ActionChain, Actions, bipLov) => {
  'use strict';

  // Loads EQP_CONTRACTS_BY_PROJECT_LOV_RP for the current request.projectId and
  // updates $page.variables.contractsAdp.data by REASSIGNING it to a new array
  // (never $page.variables.contractsAdp itself). Bound to a plain oj-select-single
  // directly on the page (no oj-vb-fragment) — this is what lets the Contract
  // field reload silently on project change with no visible flicker, since the
  // component's data-provider reference (contractsAdp) never changes, only the
  // array it points to.
  //
  // NOTE: an EARLIER version mutated .data in place via `.data.length = 0;
  // .data.push(...)`. That threw `RangeError: Invalid array length` through
  // VBCS's Actions.assignVariable machinery — $page.variables.X is a tracked/
  // proxied path, and writing `.length` on a nested array through it is NOT
  // safe here (a different flavor of the same class of bug as deep-mutation
  // not propagating elsewhere in this app). Reassigning the whole .data array
  // (not just its length) is the safe operation.
  class LoadContractsChain extends ActionChain {
    async run(context) {
      const { $page, $flow } = context;
      const projectId = $flow.variables.request.projectId;

      if (!projectId) {
        $page.variables.contractsAdp.data = [];
        return;
      }

      $page.variables.isContractsLoading = true;
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

        $page.variables.contractsAdp.data = items;

        console.log('LoadContractsChain: loaded', items.length, 'contracts for project', projectId);
      } catch (e) {
        console.error('LoadContractsChain error:', e);
        $page.variables.contractsAdp.data = [];
      } finally {
        $page.variables.isContractsLoading = false;
      }
    }
  }

  return LoadContractsChain;
});
