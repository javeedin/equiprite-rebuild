define([
  'vb/action/actionChain',
  'resources/js/draftStorage',
], function(ActionChain, draftStorage) {
  'use strict';

  class InitCartChain extends ActionChain {
    async run(context) {
      var $page = context.$page;
      var $flow = context.$flow;
      var $application = context.$application;

      // Hydrate from localStorage if a persisted draft exists (refresh / new tab).
      // Always prefer the saved draft over VBCS default initialization, since
      // request.* defaults would otherwise make the variable look populated and
      // silently swallow user-typed fields like `location`.
      if (draftStorage.hasStoredDraft('request')) {
        $flow.variables.request = draftStorage.load('request');
      }
      if (draftStorage.hasStoredDraft('ActiveRequestDetail')) {
        $flow.variables.ActiveRequestDetail = draftStorage.load('ActiveRequestDetail');
      }
      if (draftStorage.hasStoredDraft('requestOrigin')) {
        $flow.variables.requestOrigin = draftStorage.load('requestOrigin');
      }
      if (draftStorage.hasStoredDraft('CartItemsArray')) {
        $flow.variables.CartItemsArray = draftStorage.load('CartItemsArray');
      }
      // A reopened DRAFT (draftResume.js): Submit / Save as Draft update that
      // request in place instead of creating a new one.
      if (draftStorage.hasStoredDraft('resumeDraft')) {
        $flow.variables.resumeDraft = draftStorage.load('resumeDraft');
      }

      // Is this cart holding a CUSTOMER (external) request?
      //
      // Not the same question as "did you come from the customer page" any
      // more: project-create-request is a unified entry point, so an EXTERNAL
      // request raised there must behave as a customer request here too — the
      // T&C dialog, the customer header, and the button hiding while that
      // dialog is open. The Request Type PICKER decides; requestOrigin is only
      // the fallback for customer-create-req-page, which has no picker.
      //
      // Kept on a PAGE variable because the markup needs it in plain bindings,
      // and because a nested $flow property (request.requestType) does not
      // reliably re-evaluate oj-bind-if — the same reactivity trap the create
      // page hit with requestTypeSel. Set here, after the draft hydration
      // above, so a refresh/resume re-derives it from the restored draft.
      var cartType = String(
        ($flow.variables.request && $flow.variables.request.requestType) || ''
      ).toUpperCase();
      $page.variables.isCustomerRequest = (cartType === 'EXTERNAL' || cartType === 'INTERNAL')
        ? (cartType === 'EXTERNAL')
        : ($flow.variables.requestOrigin === 'customer');
      // Agreement context — must survive cart-page refresh so submit FKs work
      if (draftStorage.hasStoredDraft('fromAgreementId')) {
        $flow.variables.fromAgreementId = draftStorage.load('fromAgreementId');
      }
      if (draftStorage.hasStoredDraft('fromAgreementNumber')) {
        $flow.variables.fromAgreementNumber = draftStorage.load('fromAgreementNumber');
      }
      if (draftStorage.hasStoredDraft('fromAgreementCustomer')) {
        $flow.variables.fromAgreementCustomer = draftStorage.load('fromAgreementCustomer');
      }
      if (draftStorage.hasStoredDraft('agreementLineIdByEquipmentId')) {
        $flow.variables.agreementLineIdByEquipmentId = draftStorage.load('agreementLineIdByEquipmentId');
      }
      if (draftStorage.hasStoredDraft('agreementClassIds')) {
        $flow.variables.agreementClassIds = draftStorage.load('agreementClassIds');
      }

      // HOURS column visibility. Hidden when EITHER:
      //   • the request is customer/EXTERNAL (or the customer flow) — those have
      //     no hours concept at all and the column only ever rendered em-dashes;
      //   • TIMESHEETS_ENABLED is off — the app-wide costing-intent switch. With
      //     it off the app bills on the complete request period (start→end ×
      //     rate) and hours are ignored, so collecting or showing them is
      //     misleading. Mirrors the Planned Hours field on the create page and
      //     the Time Keeper nav section, which hang off the same flag.
      // Resolved HERE because a page module can't reach $application; the
      // boolean is handed to initGridData. isFeatureEnabled fails CLOSED, so
      // hours stay hidden while settings load rather than flashing in.
      // Must stay AFTER isCustomerRequest is derived above.
      var timesheetsOn = $application.functions.isFeatureEnabled(
        $application.variables.featureFlags,
        $application.variables.flagsLoaded,
        'TIMESHEETS_ENABLED'
      );
      $page.variables.showHoursColumn = !$page.variables.isCustomerRequest && timesheetsOn;

      // Hide every amount when this request will be quoted. Same rule and same
      // resolver as the catalog card (see CatalogInitChain) so the two screens
      // never disagree about whether a price is public: with ENABLE_QUOTES
      // covering this origin, the price is settled on the quote by a manager who
      // can still adjust markup, and a figure shown here would anchor the
      // customer on a number the quote may not honour.
      //
      // isCustomerRequest was already derived above and is exactly the
      // EXTERNAL-vs-INTERNAL question isQuotingAllowed needs. Fails CLOSED to
      // false (amounts SHOWN) while settings load — the pre-existing behaviour.
      var _quoteOrigin = $page.variables.isCustomerRequest ? 'EXTERNAL' : 'INTERNAL';
      $page.variables.hideRatesForQuote = !!(
        $application &&
        $application.functions.isQuotingAllowed(
          $application.variables.globalSettings,
          $application.variables.flagsLoaded,
          _quoteOrigin
        )
      );

      // Fusion PPM prices rentals (global flag): its text replaces the rate and
      // the subtotal goes to '—'. Wins over the quote rule above.
      $page.variables.ppmRateText = $application
        ? $application.functions.ppmRateText(
            $application.variables.featureFlags, $application.variables.flagsLoaded)
        : '';

      $page.variables.dataGridProvider = $page.functions.initGridData(
        $flow.variables.CartItemsArray || [],
        $flow.variables.ActiveRequestDetail || {},
        !$page.variables.showHoursColumn,
        $page.variables.hideRatesForQuote,
        $page.variables.ppmRateText
      );
    }
  }

  return InitCartChain;
});
