define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/bipLov',
], (ActionChain, Actions, bipLov) => {
  'use strict';

  // Loads EQP_SHIP_TO_SITES_BY_CONTRACT_LOV_RP for the current project+contract
  // and updates $page.variables.shipToSitesAdp.data by REASSIGNING it to a new
  // array (never shipToSitesAdp itself) — same pattern/rationale as
  // LoadContractsChain.
  //
  // CONTRACT-SCOPED, not customer-scoped. This used to call
  // EQP_SHIP_TO_SITES_BY_CUSTOMER_LOV_RP with P_PROJECT_ID + P_CUSTOMER_ID,
  // which forced the user through a Customer picker whose only real job was to
  // supply that second parameter. The Delivery Location LOV now shows the sites
  // of EVERY customer on the chosen contract, so the customer hop is gone from
  // the UI — it lives inside the report's SQL instead (see
  // docs/sql/EQP_SHIP_TO_SITES_BY_CONTRACT_LOV_RP.sql). One SOAP call, same as
  // before; the alternative considered was fanning out one call per customer,
  // which was rejected as N+1 with partial-failure and dedupe problems.
  //
  // P_PROJECT_ID is still passed and is NOT redundant: a contract can span
  // several projects, and it scopes the ship-to sites to the contract lines
  // linked to THIS project.
  class LoadShipToSitesChain extends ActionChain {
    async run(context) {
      const { $page, $flow } = context;
      const projectId  = $flow.variables.request.projectId;
      const contractId = $page.variables.selectedContractId;

      // No contract yet → not a "no locations" result, just nothing asked for.
      // shipToSitesLoaded stays false so the field shows 'Choose a Contract'
      // rather than 'No Location Found'.
      if (!projectId || !contractId) {
        $page.variables.shipToSitesAdp.data = [];
        $page.variables.shipToSitesLoaded   = false;
        return;
      }

      $page.variables.isShipToSitesLoading = true;
      // Clear the latch for the duration of the call: while it's false the
      // placeholder can't claim 'No Location Found' about a stale empty list.
      $page.variables.shipToSitesLoaded    = false;
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

        // idField = SITE_ADDRESS (not a numeric id): the selected row's .id IS the
        // address string, so binding the oj-select-single's value straight to
        // request.location (see page HTML) needs no extra mapping step — same
        // trick used by the bipReportLov fragment instance this replaces.
        //
        // CUSTOMER_NAME rides along as label2 (the same secondary-line idiom the
        // Contract LOV uses). The list now merges the sites of every customer on
        // the contract, so the dropdown shows who each address belongs to —
        // without it two customers' sites can read identically.
        const items = bipLov.decodeReportRows(
          response.body, 'G_1', 'SITE_ADDRESS', 'SITE_ADDRESS', 'CUSTOMER_NAME'
        );

        $page.variables.shipToSitesAdp.data = items;

        console.log('LoadShipToSitesChain: loaded', items.length, 'ship-to sites for project', projectId, 'contract', contractId);
      } catch (e) {
        console.error('LoadShipToSitesChain error:', e);
        $page.variables.shipToSitesAdp.data = [];
      } finally {
        $page.variables.isShipToSitesLoading = false;
        // Set in `finally`, so it flips on the error path too: a failed report
        // leaves the user with no locations either way, and 'No Location Found'
        // is a truer thing to show than a '— Select Ship-To Site —' prompt for
        // a list that will never fill. The console.error above is what
        // distinguishes the two cases for a developer.
        $page.variables.shipToSitesLoaded = true;
      }
    }
  }

  return LoadShipToSitesChain;
});
