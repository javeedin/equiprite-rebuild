define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/draftStorage',
  'resources/js/requestModel',
  'resources/js/draftResume',
], (ActionChain, Actions, draftStorage, requestModel, draftResume) => {
  'use strict';

  // Tab-scoped flag set by CreateRequestFromAgreementChain just before the
  // cross-flow navigate. sessionStorage is per-tab and dies when the tab
  // closes, so stale localStorage from an abandoned previous session won't
  // be misread as a fresh handoff.
  function isAgreementSessionActive() {
    try { return sessionStorage.getItem('eqr.agreement.active') === '1'; }
    catch (e) { return false; }
  }
  function clearAgreementSession() {
    try { sessionStorage.removeItem('eqr.agreement.active'); }
    catch (e) { /* private mode — silent */ }
  }

  // Entering the create-request form has three cases:
  //   (a) Agreement-driven entry — sessionStorage flag set by
  //       CreateRequestFromAgreementChain just before cross-flow navigate.
  //       Hydrate $flow vars from draftStorage and show the banner.
  //   (b) Same-trip return from catalog/cart — keep all state so the user
  //       sees the values they typed. The catalog's back-button chains
  //       (goToParentChain, DiscardAndGoBackChain) set
  //       $flow.variables.isReturningToCreate = true right before navigating
  //       here. This chain consumes the flag (clears it) on read so any
  //       SUBSEQUENT entry (e.g. user abandons, then re-enters from the
  //       dashboard) is correctly treated as fresh.
  //   (c) Fresh entry from any other path — wipe draftStorage AND the
  //       sessionStorage flag.
  //
  // requestOrigin alone is NOT a reliable signal: it persists in $flow vars
  // until the flow exits, so a "Create Request" button click after an
  // abandoned attempt would still see requestOrigin === 'project' and would
  // wrongly preserve old data. The explicit flag avoids that trap.
  class HydrateDraftChain extends ActionChain {
    async run(context) {
      const { $page, $flow, $application } = context;

      // AGREEMENTS feature gate: only rehydrate agreement handoff context when the
      // feature is enabled (fail closed while flags load). Prevents a stale session
      // flag / stored draft from re-establishing agreement context when off.
      const _flags = ($application && $application.variables.featureFlags) || {};
      const _agreementsOn = $application && $application.variables.flagsLoaded === true
        && _flags.AGREEMENTS_ENABLED === 'true';

      // (d) — checked FIRST — Reopened DRAFT (Edit Draft on the request detail page). The draft
      // was staged in draftStorage by draftResume.prepare(); copy it into the
      // flow and then treat this exactly like a same-trip return (b), which
      // already rebuilds every page-scoped picker from $flow.variables.request.
      const isDraftResume = draftResume.takeResumeFlag();
      if (isDraftResume) {
        draftResume.hydrateFlow($flow);
        $flow.variables.isReturningToCreate = true;
      }

      // (a) Agreement handoff — tab-scoped session flag is the signal
      if (!isDraftResume && _agreementsOn && isAgreementSessionActive() && draftStorage.hasStoredDraft('fromAgreementId')) {
        const fromAgreementId        = draftStorage.load('fromAgreementId');
        const fromAgreementNumber    = draftStorage.load('fromAgreementNumber')   || '';
        const fromAgreementCustomer  = draftStorage.load('fromAgreementCustomer') || '';
        const customerRefId          = draftStorage.load('fromAgreementCustomerRefId');
        const effectiveFrom          = draftStorage.load('fromAgreementEffectiveFrom') || '';
        const effectiveTo            = draftStorage.load('fromAgreementEffectiveTo')   || '';
        const cartItems              = draftStorage.load('CartItemsArray')             || [];
        const lineIdMap              = draftStorage.load('agreementLineIdByEquipmentId') || {};

        $flow.variables.fromAgreementId               = fromAgreementId;
        $flow.variables.fromAgreementNumber           = fromAgreementNumber;
        $flow.variables.fromAgreementCustomer         = fromAgreementCustomer;
        // Keep the agreement's effective window in the fromAgreement* vars (used
        // by the banner / scoping), but do NOT prefill it as the request's rental
        // dates. The agreement effective window is the contract validity period,
        // not a rental window — the user picks the actual start/end on this page.
        $flow.variables.fromAgreementEffectiveFrom    = effectiveFrom;
        $flow.variables.fromAgreementEffectiveTo      = effectiveTo;
        $flow.variables.agreementLineIdByEquipmentId  = lineIdMap;
        $flow.variables.CartItemsArray                = cartItems;
        $flow.variables.requestOrigin                 = 'agreement';
        $flow.variables.ActiveRequestDetail           = {};
        // Prefill ONLY the customer (an agreement is bound to one customer).
        // Dates and notes are request-specific — the user fills them here.
        $flow.variables.request = requestModel.defaultRequest({
          customerId: customerRefId != null ? Number(customerRefId) : null
        });
        return;
      }

      // (b) Same-trip return — preserve state. Always consume the flag so
      // a fresh entry next time re-wipes.
      const isSameTripReturn = $flow.variables.isReturningToCreate === true;
      $flow.variables.isReturningToCreate = false;

      if (isSameTripReturn) {
        // $flow.variables.request survives the round-trip (flow-scoped), but the
        // Contract/Customer/Ship-to-Site LOVs' UI state lives on $page.variables,
        // which resets to its JSON defaults on every page re-entry. Rehydrate the
        // page-scoped selection vars from request, then re-run the load chains so
        // each dropdown's option list is populated again (an empty ADP would show
        // the saved selectedContractId/customerId as a value with no matching row).
        const req = $flow.variables.request || {};

        // Save the location string BEFORE setting locationType. The locationType
        // handler now ignores programmatic changes (updatedFrom !== 'internal'),
        // which is what actually stops it opening the drawer and clearing
        // request.location here: it fires AFTER this chain, so the restore below
        // ran too early to undo it. The restore is kept as a backstop.
        const savedLocation = req.location || '';

        $page.variables.selectedContractId = req.contractId != null ? req.contractId : null;
        $page.variables.locationType       = req.locationType || null;
        // Re-seed the Request Type picker's PAGE mirror. The authoritative value
        // lives on req.requestType, but every oj-bind-if on this page tests the
        // page scalar (a nested $flow property doesn't re-trigger them), so
        // without this a resumed draft would render the Internal layout even
        // when the saved request is External.
        $page.variables.requestTypeSel     = req.requestType || '';

        // Internal Customer display text. The field is an oj-select-single whose
        // value-item binds to selectedCustomerObj (a PAGE variable, reset on
        // re-entry); its report provider only knows rows fetched this visit, so
        // it can't resolve its own label from an id — rebuild the object from
        // the id+name pair carried on the request.
        // Shaped with BOTH key spellings the binding accepts (Customer /
        // PartyName) so it renders whichever the original row used.
        if (req.customerId != null && req.customerName) {
          $page.variables.selectedCustomerObj = {
            CustomerId: req.customerId,
            Customer:   req.customerName,
            PartyName:  req.customerName
          };
        }

        // Backstop: make sure the drawer is shut and the location intact.
        $page.variables.isLocationDrawerOpen = false;
        if (savedLocation) {
          $flow.variables.request.location = savedLocation;
        }

        // EXTERNAL party LOVs. Both are page-level arrays that default to []
        // and were previously loaded ONLY by RequestTypeChangedChain — i.e. on
        // user interaction, which never happens on a same-trip return. The ids
        // (request.customerRefId / request.requestorId) survive on the flow
        // model, but an oj-select-single resolves its display text from its data
        // list: with an empty list both pickers rendered BLANK even though the
        // values were intact. Reload them so the saved selection shows.
        if (String(req.requestType || '').toUpperCase() === 'EXTERNAL') {
          await Actions.callChain(context, { chain: 'LoadExternalPartyLovsChain' });
        }

        if (req.projectId) {
          // Concurrent: two independent Fusion round-trips on the same project.
          // The task list is loaded here because a hydrated draft never fires
          // CaptureProjectNameChain — without it the Task dropdown would open
          // empty on a draft that already has a project.
          await Promise.all([
            Actions.callChain(context, { chain: 'LoadContractsChain' }),
            Actions.callChain(context, { chain: 'LoadTaskTreeChain' })
          ]);
          // The Contract oj-select-single's value="{{ }}" binds selectedContractId
          // directly (no display-object needed) — its own data list resolves the
          // label, same as before. selectedContractObj itself isn't shown anywhere,
          // so it's left null here; only its id matters for reportParameters/gating.
        }
        // Ship-to sites are CONTRACT-scoped now (project + contract), so the
        // customer is no longer part of rehydrating them. The old code reloaded
        // the contract's customer list here purely to rebuild the display text
        // of the contract-scoped Customer picker — that picker is gone, and the
        // surviving Internal Customer field is the Fusion search, whose text is
        // rebuilt from selectedCustomerObj (restored with the rest of the page
        // state) rather than from a reloaded list.
        if (req.projectId && req.contractId) {
          await Actions.callChain(context, { chain: 'LoadShipToSitesChain' });
          // Ship-to-Site's value is bound straight to request.location (the
          // address text itself — see CaptureShipToSiteChain), so no object
          // reconstruction is needed there; the string already survived.
        }

        // Sent back from the cart's Complete Request Details popup: a soft
        // reservation must fill these before it can be submitted. Shown once,
        // after the pickers above have reloaded, then cleared.
        const toComplete = $flow.variables.completeForSubmitFields || [];
        if (toComplete.length > 0) {
          $flow.variables.completeForSubmitFields = [];
          await Actions.fireNotificationEvent(context, {
            summary: 'Complete the request to submit it',
            message: 'Please fill in: ' + toComplete.join(', ') + '. Then click Next to return to your cart.',
            type: 'warning',
            displayMode: 'persist'
          });
        }
        return;
      }

      // (c) Fresh entry — wipe everything including any stale agreement context
      clearAgreementSession();
      draftStorage.clear();

      $flow.variables.CartItemsArray = [];
      $flow.variables.ActiveRequestDetail = {};
      $flow.variables.requestOrigin = '';
      $flow.variables.resumeDraft = null;
      $flow.variables.fromAgreementId = null;
      $flow.variables.fromAgreementNumber = '';
      $flow.variables.fromAgreementCustomer = '';
      $flow.variables.fromAgreementEffectiveFrom = '';
      $flow.variables.fromAgreementEffectiveTo = '';
      $flow.variables.agreementLineIdByEquipmentId = {};
      $flow.variables.agreementClassIds = [];
      $flow.variables.request = requestModel.defaultRequest();
    }
  }

  return HydrateDraftChain;
});
