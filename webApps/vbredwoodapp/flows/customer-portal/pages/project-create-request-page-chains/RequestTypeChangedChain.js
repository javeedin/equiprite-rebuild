define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Request Type changed — mirror the picker onto the flow model, clear any
   * now-inapplicable state, and load the External party LOVs.
   *
   * WHY A MIRROR AT ALL: the picker binds to the PAGE variable requestTypeSel,
   * not straight to $flow.variables.request.requestType, because writing a
   * nested property of a $flow OBJECT variable does not re-evaluate the
   * oj-bind-if tests that show/hide the Internal vs External fields — the flow
   * variable's own reference never changes, so the binding dependency never
   * fires. (Same reason the Location Type picker on this page keeps its value
   * on a page scalar and mirrors into $flow.) The flow copy is still the
   * authoritative one: it is what survives the catalog round-trip, what
   * NavigateToCatalogChain snapshots, and what SubmitRequestChain posts.
   *
   * Ordering matters here: the mirror is written FIRST so anything downstream
   * that reads request.requestType in the same turn sees the new value.
   */
  class RequestTypeChangedChain extends ActionChain {
    async run(context, params) {
      const { $page, $flow, $application } = context;

      const raw  = (params && params.requestType) != null ? params.requestType : $page.variables.requestTypeSel;
      const type = String(raw || '').toUpperCase();
      const prev = String($flow.variables.request.requestType || '').toUpperCase();

      // Mirror onto the flow model — the value that actually gets posted.
      $flow.variables.request.requestType = type;

      // A PROGRAMMATIC call (SeedCustomerTypeChain forcing the type) arrives
      // with params.requestType and no picker write behind it, so the page
      // scalar every field tests was never set — the locked Customer Type box
      // rendered empty. Write it back so screen and posted value agree.
      if (params && params.requestType != null && $page.variables.requestTypeSel !== type) {
        $page.variables.requestTypeSel = type;
      }
      $page.variables.lockedTypeArray = type
        ? [{ value: type, label: $application.functions.customerTypeLabel(type) }]
        : [];

      // NO-OP WHEN THE TYPE DID NOT ACTUALLY CHANGE.
      //
      // oj-select-single fires on-value-changed for PROGRAMMATIC writes as well
      // as user picks, and HydrateDraftChain re-seeds $page.variables
      // .requestTypeSel from the saved request on every same-trip return from
      // the catalog. That re-seed used to fall straight through into the clear
      // blocks below and wipe fields that had survived the round-trip perfectly
      // — Requestor Contact was the visible casualty (its id is cleared by the
      // INTERNAL branch), and on the external side the party selection went the
      // same way.
      //
      // Everything below is "the user switched type, so drop what no longer
      // applies" — none of it is wanted when the value is merely being restored
      // to what it already was. Comparing against the PREVIOUS mirror value is
      // the reliable test: on a genuine user switch the two differ; on a re-seed
      // they match. (The mirror is assigned above first, so the flow model is
      // still correct either way.)
      if (prev === type) {
        // The External LOVs still need loading on a restore — they are page
        // arrays that reset on re-entry and would otherwise leave the two
        // external pickers blank. HydrateDraftChain calls this chain for that,
        // so keep serving it, just without the destructive part.
        if (type === 'EXTERNAL') {
          await Actions.callChain(context, { chain: 'LoadExternalPartyLovsChain' });
        }
        return;
      }

      if (type === 'EXTERNAL') {
        // NOTE: the Contract selection is deliberately NOT cleared here any
        // more. Contract is part of the EXTERNAL layout too now, so it survives
        // the switch — wiping it would discard a still-valid, still-visible
        // choice (and take the Delivery Location list down with it).

        // The internal Requestor Contact and the external Customer Contact
        // share request.requestorId (they are mutually exclusive on screen and
        // SubmitRequestChain routes the one id to the right column by mode).
        // Clear it on a switch so an EQR_USER id can't be submitted as an
        // EQR_CUSTOMER_PORTAL_USER id, which would point at an unrelated row in
        // the other table rather than failing loudly.
        $flow.variables.request.requestorId   = null;
        $flow.variables.request.requestorName = '';

        // The Internal Customer picker is replaced by External Customer here, so
        // drop its selection — id, mirrored display name, and the page object
        // the field renders from. Without this an internal Fusion customer would
        // survive on the request behind a field that is no longer on screen.
        $flow.variables.request.customerId    = null;
        $flow.variables.request.customerName  = '';
        $page.variables.selectedCustomerObj   = null;

        // Location Type is hidden on an external request, but BOTH Delivery
        // Location variants are gated on it — leaving it unset would render
        // NEITHER, stranding a required field with no control to fill it. Pin
        // the free-text + map mode, which is what customer-create-req-page uses.
        // Mirrored onto the flow model as well (same pairing the picker's own
        // handler does) so a catalog round-trip rehydrates it.
        $page.variables.locationType         = 'DELIVERY_LOCATION';
        $flow.variables.request.locationType = 'DELIVERY_LOCATION';

        // Soft Reservation is hidden too. Force it off rather than leaving a
        // stale true behind an invisible toggle — it relaxes the required-field
        // set in NavigateToCatalogChain, so a leftover true would silently let
        // an external request through without a contact, location, or task.
        $flow.variables.request.isSoftReservation = false;

        // Planned Hours is hidden on an external request (hours are a
        // project-side timesheet input). Clear any value typed while the type
        // was Internal, so a number the user can no longer see doesn't ride
        // along on the submitted request and seed timesheet defaults for a
        // customer request that has no timesheet path.
        $flow.variables.request.hours = null;

        // Rental Agreement is part of the EXTERNAL layout now too, so any
        // agreement already chosen is kept rather than dropped — the field
        // stays on screen to show it.

        // Project + Task are only offered on an external request when
        // EXTERNAL_PROJECT_ASSIGN_ENABLED is on (the same flag that gates the
        // Assign Project drawer on request-detail-page). With it off the
        // pickers are removed from the DOM, so clear anything the user had
        // already chosen while the type was Internal — otherwise a project the
        // flag is meant to withhold would still ride along on the submitted
        // request, set by a route that is supposed to be closed.
        // isFeatureEnabled fails closed, matching the binding's own test.
        const canAssignProject = $application.functions.isFeatureEnabled(
          $application.variables.featureFlags,
          $application.variables.flagsLoaded,
          'EXTERNAL_PROJECT_ASSIGN_ENABLED'
        );
        if (!canAssignProject) {
          $flow.variables.request.projectId     = null;
          $flow.variables.request.projectName   = '';
          $flow.variables.request.projectNumber = '';
          // The business unit belongs to the project being cleared — leaving it
          // behind would submit the old project's BU on a request that no
          // longer has a project at all.
          $flow.variables.request.projectBuId   = null;
          $flow.variables.request.projectBuName = '';
          $flow.variables.request.taskId        = null;
          $flow.variables.request.taskName      = '';
          $flow.variables.request.taskNumber    = '';
          // Contract shares the same gate (its LOV is keyed on the project), so
          // it disappears with them — clear it too, or a contract picked while
          // the type was Internal would ride along invisibly on the submitted
          // request. The site list hangs off the contract, so that goes as well.
          $page.variables.selectedContractId    = null;
          $page.variables.selectedContractObj   = null;
          $flow.variables.request.contractId    = null;
          $flow.variables.request.contractNumber = '';
          $flow.variables.request.location      = '';
          $page.variables.selectedShipToSiteObj = null;
          $page.variables.shipToSitesAdp.data   = [];
          $page.variables.shipToSitesLoaded     = false;
        }

        await Actions.callChain(context, { chain: 'LoadExternalPartyLovsChain' });
        return;
      }

      // Back to INTERNAL — drop the external party selection for the mirror
      // reason: request.requestorId now feeds the EQR_USER picker.
      $flow.variables.request.customerRefId   = null;
      $flow.variables.request.customerRefName = '';
      $flow.variables.request.requestorId     = null;
      $flow.variables.request.requestorName   = '';

      // The INTERNAL requestor is the signed-in user, not a pick — re-seed it
      // straight away so the locked field is never left blank.
      await Actions.callChain(context, { chain: 'SeedRequestorChain' });
    }
  }

  return RequestTypeChangedChain;
});
