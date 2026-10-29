define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Fired by the plain Contract oj-select-single's on-value-item-changed — a REAL,
  // reliably-firing native component event (unlike the bipReportLov fragment's
  // custom valueChanged event, which never reached a host-page listener in this
  // app; see project_contracts_bip_lov.md). Clears the dependent Ship-to-Site
  // state, then reloads the sites for the newly selected contract — this ALSO
  // fixes the earlier A→B gap (re-picking a different contract), which the
  // fragment version could never reliably detect.
  //
  // The contract now drives SITES DIRECTLY. It used to drive a Customer LOV
  // (LoadCustomersChain), and the customer in turn drove the sites; the customer
  // step existed only to supply P_CUSTOMER_ID to the old per-customer sites
  // report. The Delivery Location LOV now lists every customer's sites on the
  // contract, so that middle hop moved into the report's SQL and the chain is
  // one step shorter.
  class CaptureContractChain extends ActionChain {
    async run(context, { data } = {}) {
      const { $page, $flow } = context;

      // A restore is not a change. On a return from the catalog / cart,
      // HydrateDraftChain sets selectedContractId programmatically and this
      // fires too: first with no row while the contract list is still loading,
      // then with the same contract. Treating either as a user pick wiped the
      // saved delivery location every time.
      //   • no row but the picker still holds a value → list still loading; skip.
      //   • same contract as the request already has → refresh, keep location.
      if (!data && $page.variables.selectedContractId != null) { return; }
      const newId   = data ? data.CONTRACT_ID : null;
      const prevId  = $flow.variables.request.contractId;
      const changed = String(prevId == null ? '' : prevId) !== String(newId == null ? '' : newId);

      $page.variables.selectedContractId  = newId;
      $page.variables.selectedContractObj = data || null;
      // Also deep-set onto $flow.variables.request (page vars don't survive a
      // catalog round-trip — request does). HydrateDraftChain reads this back on
      // same-trip return to rehydrate selectedContractId + reload Sites.
      $flow.variables.request.contractId  = data ? data.CONTRACT_ID : null;
      // Contract NUMBER too — submitted as PROJECT_CONTRACT next to
      // PROJECT_CONTRACT_ID, and needed on the flow model because
      // selectedContractObj is a $page variable that resets on page re-entry.
      $flow.variables.request.contractNumber = data ? (data.CONTRACT_NUMBER || '') : '';

      // Unchanged contract (a restore): HydrateDraftChain reloads the sites
      // itself, and the saved location is still valid.
      if (!changed) { return; }

      // A site chosen under the PREVIOUS contract is not necessarily valid under
      // the new one, so drop it rather than leave a stale address in a field the
      // user won't think to re-check.
      $flow.variables.request.location      = '';
      $page.variables.selectedShipToSiteObj = null;
      // Reassign .data to a new array — see LoadContractsChain.js for why
      // `.data.length = 0` throws through VBCS's Actions.assignVariable machinery.
      $page.variables.shipToSitesAdp.data = [];
      // Drop the previous contract's result latch so the placeholder doesn't
      // flash 'No Location Found' from the OLD contract while the new one loads.
      $page.variables.shipToSitesLoaded   = false;

      await Actions.callChain(context, { chain: 'LoadShipToSitesChain' });
    }
  }

  return CaptureContractChain;
});
