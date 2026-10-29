define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Populates the optional "Rental Agreement" dropdown on the create-request
  // page (Path B — selecting an agreement directly when raising a request).
  //
  // The agreement header carries only customerRefId (not the customer name),
  // so we fetch getCustomerRefs and join id -> name to build a readable label
  // like "AGR-2026-012 — Cianbro Corporation (ACTIVE)".
  //
  // STATUS FILTER: getAgreementHeaders has no status query param, so we filter
  // client-side. Only ACTIVE (approved) agreements are selectable when raising
  // a request — a request must release against an approved blanket contract,
  // not a draft. Agreements are activated via the Approve button on the
  // rental-agreement-lines page (approveAgreementChain PATCHes status=ACTIVE).
  //
  // The selectable value is the agreement's numeric header id (so the
  // AgreementSelectedChain can fetch raw lines by agreementId). We stash the
  // full header detail alongside each option in agreementOptionsArray so the
  // selection handler doesn't need a second header round-trip.
  const SELECTABLE_STATUSES = ['ACTIVE'];

  class LoadAgreementsChain extends ActionChain {
    async run(context) {
      // $flow is needed below for the Path A pre-selection (fromAgreementId).
      // Omitting it threw a ReferenceError at the pre-select block, which
      // aborted the chain before selectedAgreementId was set — leaving the
      // Rental Agreement dropdown blank even though the banner rendered.
      const { $page, $flow, $application } = context;

      // AGREEMENTS feature gate: if the flag is off (or flags not yet loaded —
      // fail closed), do not load any agreements. Leaves the dropdown empty; the
      // selector itself is hidden on the page. Prevents agreement context from
      // ever being established when the feature is disabled.
      const flags = ($application && $application.variables.featureFlags) || {};
      const flagsLoaded = $application && $application.variables.flagsLoaded === true;
      if (!flagsLoaded || flags.AGREEMENTS_ENABLED !== 'true') {
        $page.variables.agreementOptionsArray = [];
        return;
      }

      const [headersResp, customersResp] = await Promise.all([
        Actions.callRest(context, {
          endpoint:  'eqp-v1/getAgreementHeaders',
          uriParams: { pageSize: 500 }
        }),
        Actions.callRest(context, {
          endpoint: 'eqp-v1/getCustomerRefs'
        })
      ]);

      const headers = (headersResp && headersResp.ok && headersResp.body && Array.isArray(headersResp.body.data))
        ? headersResp.body.data : [];

      const customerNameById = new Map();
      const custRows = (customersResp && customersResp.ok && customersResp.body && Array.isArray(customersResp.body.data))
        ? customersResp.body.data : [];
      custRows.forEach(function(c) {
        if (c && c.id != null) customerNameById.set(Number(c.id), c.customerName || String(c.id));
      });

      const options = headers
        .filter(function(h) {
          return h && h.id != null &&
                 SELECTABLE_STATUSES.indexOf((h.status || '').toUpperCase()) !== -1;
        })
        .map(function(h) {
          const custName = h.customerRefId != null
            ? (customerNameById.get(Number(h.customerRefId)) || ('Customer ' + h.customerRefId))
            : 'Customer';
          return {
            value:        Number(h.id),
            label:        (h.agreementNumber || ('Agreement ' + h.id)) + ' — ' + custName,
            // Full detail carried on the option so AgreementSelectedChain can
            // build the agreement context without re-fetching the header.
            agreementNumber:  h.agreementNumber || '',
            customerName:     custName,
            customerRefId:    h.customerRefId    != null ? Number(h.customerRefId)    : null,
            fusionCustomerId: h.fusionCustomerId != null ? Number(h.fusionCustomerId) : null,
            effectiveFrom:    h.effectiveFrom || '',
            effectiveTo:      h.effectiveTo   || '',
            notes:            h.notes || ''
          };
        })
        .sort(function(a, b) { return String(b.agreementNumber).localeCompare(String(a.agreementNumber)); });

      $page.variables.agreementOptionsArray  = options;
      $page.variables.filteredAgreementsArray = options;
      console.log('[load-agreements] options:', options.length);

      // Path A pre-selection: if we arrived from the agreement-lines page,
      // HydrateDraftChain (which runs before this on vbEnter) has already set
      // $flow.variables.fromAgreementId. Reflect it in the dropdown so the
      // field shows the agreement that's driving this request. The select
      // handler is guarded against rebuilding context for the already-active
      // agreement, so this won't re-fetch. If the active agreement isn't in
      // the option list (e.g. a status not in SELECTABLE_STATUSES), inject a
      // synthetic option so the value still renders rather than going blank.
      const activeId = $flow.variables.fromAgreementId != null
        ? Number($flow.variables.fromAgreementId) : null;
      if (activeId != null) {
        const present = options.some(function(o) { return Number(o.value) === activeId; });
        if (!present) {
          options.unshift({
            value:            activeId,
            label:            ($flow.variables.fromAgreementNumber || ('Agreement ' + activeId)) +
                              ' — ' + ($flow.variables.fromAgreementCustomer || 'Customer'),
            agreementNumber:  $flow.variables.fromAgreementNumber || '',
            customerName:     $flow.variables.fromAgreementCustomer || '',
            customerRefId:    null,
            fusionCustomerId: null,
            effectiveFrom:    $flow.variables.fromAgreementEffectiveFrom || '',
            effectiveTo:      $flow.variables.fromAgreementEffectiveTo || '',
            notes:            ''
          });
          $page.variables.agreementOptionsArray  = options;
          $page.variables.filteredAgreementsArray = options;
        }
        // Set the dropdown value AFTER the options array is in place. An
        // oj-select-single backed by an ArrayDataProvider will silently drop a
        // value that isn't yet in its data set, so on a same-trip return (where
        // we just reassigned agreementOptionsArray this same tick) setting the
        // value synchronously can race the data-provider refresh and the field
        // renders blank — even though the banner (driven by $flow.fromAgreementId)
        // shows. Deferring the value assignment to a microtask lets the ADP
        // settle on the new options first, so the value sticks.
        await new Promise(function(resolve) { setTimeout(resolve, 0); });
        $page.variables.selectedAgreementId = activeId;
      }
    }
  }

  return LoadAgreementsChain;
});
