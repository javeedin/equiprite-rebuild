define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  /**
   * Cancel/close the Transfer drawer, discarding everything staged.
   * Exact mirror of CloseAssignProjectChain.
   */
  class CloseTransferDrawerChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.isTransferDrawerOpen = false;
      $page.variables.transferProjectId     = null;
      $page.variables.transferProjectName   = '';
      $page.variables.transferProjectNumber = '';
      $page.variables.transferTaskId        = null;
      $page.variables.transferTaskName      = '';
      $page.variables.transferTaskNumber    = '';
      $page.variables.transferTaskError     = '';
      $page.variables.transferStartDate     = '';
      $page.variables.transferEndDate       = '';
      $page.variables.transferError         = '';
      $page.variables.transferSaving        = false;

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
      $page.variables.transferCustomerId                  = null;
      $page.variables.transferCustomerName                = '';
      $page.variables.transferRequestorId                 = null;
      $page.variables.transferRequestorName               = '';

      $page.variables.transferContractId          = null;
      $page.variables.transferSelectedContractObj = null;
      if ($page.variables.transferContractsADP) $page.variables.transferContractsADP.data = [];

      $page.variables.transferAgreementId = null;

      $page.variables.transferIsSoftReservation = false;
      $page.variables.transferPlannedHours      = null;

      $page.variables.transferLocationType               = null;
      $page.variables.transferLocation                   = '';
      $page.variables.transferSelectedShipToSiteObj      = null;
      if ($page.variables.transferShipToSitesADP) $page.variables.transferShipToSitesADP.data = [];
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

      if ($page.functions && typeof $page.functions.destroyLocationMap === 'function') {
        $page.functions.destroyLocationMap();
      }
    }
  }

  return CloseTransferDrawerChain;
});
