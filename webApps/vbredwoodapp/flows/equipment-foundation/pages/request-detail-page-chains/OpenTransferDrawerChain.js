define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Open the "Transfer to Another Site" drawer for the single selected line.
   *
   * transferEnabled (request-detail-page.js) already restricts the click to
   * exactly one selected DEPLOYED line, but this chain re-derives the line
   * from $page.variables.linesArray + getSelectedRowIndexes() rather than
   * trusting a value stashed earlier — same "never trust stale client state"
   * rule AssignProjectChain applies before its PATCH.
   *
   * Stages the source line's identity/equipment/qty/rate onto transfer* page
   * variables (read-only context shown in the drawer header) and resets the
   * destination-side fields (project/task/dates) to blank, so a previous
   * transfer's picks never leak into the next one.
   */
  class OpenTransferDrawerChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const lines = $page.variables.linesArray || [];
      const selectedIdx = ($page.functions && typeof $page.functions.getSelectedRowIndexes === 'function')
        ? ($page.functions.getSelectedRowIndexes() || [])
        : [];

      if (selectedIdx.length !== 1) {
        console.warn('[OpenTransferDrawerChain] expected exactly one selected line, got', selectedIdx.length);
        return;
      }

      const line = lines[selectedIdx[0]];
      if (!line || String(line.line_status || '').toUpperCase() !== 'DEPLOYED') {
        console.warn('[OpenTransferDrawerChain] selected line is not DEPLOYED — refusing to open');
        return;
      }

      // ── Stage source-line context (read-only in the drawer) ─────────────
      $page.variables.transferSourceLineId       = line.line_id;
      $page.variables.transferSourceLineNo       = line.line_no;
      $page.variables.transferEquipmentMasterId  = line.equipment_master_id;
      $page.variables.transferEquipmentName      = line.equipment_name || '';
      $page.variables.transferQuantity           = line.qty || 1;
      $page.variables.transferBillRate           = line.bill_rate_raw != null ? line.bill_rate_raw : null;
      $page.variables.transferPriceUom           = line.price_uom || '';
      $page.variables.transferSourceRequestId    = $page.variables.requestId;
      $page.variables.transferSourceRequestNumber = $page.variables.requestNumber ||
        ($page.variables.formData && $page.variables.formData.request_number) || '';

      // ── Reset destination-side fields ────────────────────────────────────
      $page.variables.transferProjectId     = null;
      $page.variables.transferProjectName   = '';
      $page.variables.transferProjectNumber = '';
      $page.variables.transferTaskId        = null;
      $page.variables.transferTaskName      = '';
      $page.variables.transferTaskNumber    = '';
      $page.variables.transferTaskError     = '';
      $page.variables.transferTaskTree      = {};
      $page.variables.transferTasksCacheKey = '';
      $page.variables.transferProjectSearchQ = "ProjectName LIKE '*'";
      $page.variables.transferError         = '';
      $page.variables.transferSaving        = false;

      // ── Reset the new-request-details fields — same "never leak a
      // previous transfer's picks" rule. ──────────────────────────────────
      $page.variables.transferMode                    = 'new';
      $page.variables.transferIsExistingMode          = false;
      $page.variables.transferExistingRequestSearch   = '';
      $page.variables.transferExistingRequestSearchQ  = '';
      $page.variables.transferSelectedExistingRequest = null;
      $page.variables.transferExistingRequestError    = '';

      $page.variables.transferCustomerType                = 'INTERNAL';
      $page.variables.transferInternalCustomerId          = null;
      $page.variables.transferSelectedInternalCustomerObj = null;
      $page.variables.transferFusionCustomerId            = null;
      $page.variables.transferInternalCustomerSearchQ     = "Customer LIKE '*'";
      $page.variables.transferCustomerId                  = null;
      $page.variables.transferCustomerName                = '';
      $page.variables.transferRequestorId                 = null;
      $page.variables.transferRequestorName               = '';

      $page.variables.transferContractId          = null;
      $page.variables.transferSelectedContractObj = null;
      $page.variables.transferContractsADP.data   = [];

      $page.variables.transferAgreementId = null;
      $page.variables.transferFilteredAgreementsArray = $page.variables.transferAgreementOptionsArray || [];

      $page.variables.transferIsSoftReservation = false;
      $page.variables.transferPlannedHours      = null;

      $page.variables.transferLocationType               = null;
      $page.variables.transferLocation                   = '';
      $page.variables.transferSelectedShipToSiteObj      = null;
      $page.variables.transferShipToSitesADP.data        = [];
      $page.variables.transferShipToSitesLoaded          = false;
      $page.variables.transferSelectedInvOrgLocationId   = null;
      $page.variables.transferSelectedInvOrgLocationItem = null;
      $page.variables.transferIsLocationDrawerOpen = false;
      $page.variables.transferLocationSearchText   = '';
      $page.variables.transferAddr1      = '';
      $page.variables.transferAddr2      = '';
      $page.variables.transferCity       = '';
      $page.variables.transferCounty     = '';
      $page.variables.transferAddrState  = '';
      $page.variables.transferPostalCode = '';
      $page.variables.transferCountry    = '';
      $page.variables.transferPickedLat  = null;
      $page.variables.transferPickedLng  = null;

      $page.variables.transferNotes = '';

      // Default the new window to start the day after the source line ends
      // (the equipment is expected back-in-service at Site B immediately),
      // leaving the end date blank for the manager to fill in — there is no
      // safe default for how long Site B needs it.
      const srcEnd = line.line_end_date_raw ? String(line.line_end_date_raw) : '';
      if (srcEnd) {
        const d = new Date(srcEnd + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + 1);
        $page.variables.transferStartDate = d.toISOString().substring(0, 10);
      } else {
        $page.variables.transferStartDate = '';
      }
      $page.variables.transferEndDate = '';

      // Agreements are feature-flag gated and cheap to (re)fetch — loaded
      // once per drawer open rather than on every keystroke elsewhere.
      if (!($page.variables.transferAgreementOptionsArray || []).length) {
        await Actions.callChain(context, { chain: 'TransferLoadAgreementsChain' });
        $page.variables.transferFilteredAgreementsArray = $page.variables.transferAgreementOptionsArray || [];
      }

      $page.variables.isTransferDrawerOpen = true;
    }
  }

  return OpenTransferDrawerChain;
});
