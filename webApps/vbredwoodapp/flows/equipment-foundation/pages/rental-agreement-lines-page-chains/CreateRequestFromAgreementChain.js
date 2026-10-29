define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/draftStorage',
], (ActionChain, Actions, draftStorage) => {
  'use strict';

  // Commits the page's in-memory pendingCart into draftStorage and navigates
  // cross-flow to customer-portal/project-create-request. The user fills in
  // project/task/dates/requestor/location there before reaching the catalog
  // (which will have the cart pre-populated) and the cart page.
  //
  // For class-only agreement lines (equipmentMasterId is null), this chain
  // auto-picks the first master in the class at commit time, so the cart
  // always arrives with concrete masters.
  //
  // Wipes existing draftStorage so a previous abandoned session doesn't
  // contaminate this new agreement-driven flow (per user spec: "Replace,
  // not merge. Fresh cart.").
  class CreateRequestFromAgreementChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const pending = $page.variables.pendingCart || [];

      if (pending.length === 0) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Cart is empty',
          message: 'Add at least one agreement line to the cart before creating a request.',
          displayMode: 'transient',
          type: 'warning'
        });
        return;
      }

      const headerId         = $page.variables.agreementHeaderId;
      const agreementNumber  = $page.variables.agreementNumber || '';
      const customerName     = $page.variables.customerName    || '';
      const customerRefId    = $page.variables.customerRefId   || null;
      const fusionCustomerId = $page.variables.fusionCustomerId || null;
      const effectiveFrom    = $page.variables.effectiveFrom   || '';
      const effectiveTo      = $page.variables.effectiveTo     || '';
      const agreementNotes   = $page.variables.agreementNotes  || '';

      // For class-only lines, resolve to a concrete master at commit time.
      const cartItems = [];
      const agreementLineIdByEquipmentId = {};
      const agreementRateByEquipmentId   = {};
      const usedMasterIds = new Set();

      for (const p of pending) {
        let masterId = p.equipmentMasterId;
        let masterName = p.equipment_name;

        if (masterId == null && p.equipmentClassId != null) {
          try {
            const listResp = await Actions.callRest(context, {
              endpoint: 'eqp-v1/getEquipriteV1EquipmentMaster',
              queryParams: { equipmentClassId: p.equipmentClassId, size: 5 }
            });
            const rows = (listResp.ok && listResp.body && Array.isArray(listResp.body.data))
              ? listResp.body.data : [];
            // Skip any master already claimed by an earlier line so two
            // class-only lines don't collapse to the same cart item.
            const pick = rows.find(r => r && r.id != null && !usedMasterIds.has(Number(r.id)));
            if (pick) {
              masterId = Number(pick.id);
              masterName = pick.equipmentName || masterName;
            }
          } catch (e) { /* leave unresolved */ }
        }

        if (masterId == null) {
          console.warn('[CreateReqFromAgreement] could not resolve master for line', p.agreementLineId);
          continue;
        }

        // Cart-level dedup: same master shouldn't appear twice
        if (usedMasterIds.has(masterId)) {
          console.warn('[CreateReqFromAgreement] duplicate master skipped', masterId);
          continue;
        }
        usedMasterIds.add(masterId);

        cartItems.push({
          id:          masterId,
          equipmentId: masterId,
          name:        masterName,
          class:       p.class_name,
          classId:     p.equipmentClassId,
          quantity:    1,
          billingRate: p.billingRate || 0,
          billingUnit: p.priceUom   || 'DAY'
        });
        agreementLineIdByEquipmentId[masterId] = p.agreementLineId;
        // Rate override map so the catalog prices this item at the agreement's
        // negotiated rate (consumed by CatalogInitChain strict mode).
        agreementRateByEquipmentId[masterId] = {
          billingRate: p.billingRate || 0,
          billingUnit: p.priceUom   || 'DAY'
        };
      }

      if (cartItems.length === 0) {
        await Actions.fireNotificationEvent(context, {
          summary: 'No equipment resolved',
          message: 'Could not resolve any concrete equipment for the cart.',
          displayMode: 'transient',
          type: 'error'
        });
        return;
      }

      // Wipe + write fresh draft. Project/task/requestor/location are intentionally
      // blank — user fills them on project-create-request (the next page).
      draftStorage.clear();
      draftStorage.save('CartItemsArray', cartItems);
      draftStorage.save('requestOrigin', 'agreement');
      draftStorage.save('fromAgreementId', Number(headerId));
      draftStorage.save('fromAgreementNumber', agreementNumber);
      draftStorage.save('fromAgreementCustomer', customerName);
      draftStorage.save('fromAgreementCustomerRefId', customerRefId);
      draftStorage.save('fromAgreementFusionCustomerId', fusionCustomerId);
      draftStorage.save('fromAgreementEffectiveFrom', effectiveFrom);
      draftStorage.save('fromAgreementEffectiveTo', effectiveTo);
      draftStorage.save('fromAgreementNotes', agreementNotes);
      draftStorage.save('agreementLineIdByEquipmentId', agreementLineIdByEquipmentId);
      draftStorage.save('agreementRateByEquipmentId', agreementRateByEquipmentId);

      // Tab-scoped "we're in an agreement flow" signal. sessionStorage dies
      // when the tab closes, so a stale localStorage draft from a previous
      // session won't trick the destination into thinking it's an agreement
      // entry. HydrateDraftChain checks this flag, not just draftStorage.
      try { sessionStorage.setItem('eqr.agreement.active', '1'); } catch (e) { /* private mode */ }

      // Cross-flow navigation: customer-portal is a SIBLING of
      // equipment-foundation under main, so target:'parent' is required.
      // See flows/main/pages/equipment-requests-page-chains/navigateToCreateChain.js
      // for the canonical example.
      await Actions.navigateToFlow(context, {
        target: 'parent',
        flow:   'customer-portal',
        page:   'project-create-request'
      });
    }
  }

  return CreateRequestFromAgreementChain;
});
