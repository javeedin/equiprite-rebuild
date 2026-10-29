define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/draftStorage',
], (ActionChain, Actions, draftStorage) => {
  'use strict';

  // "Create request from N lines": the old page's two steps in one, with their rules unchanged.
  //
  //   1 the old AddToCartChain over the ticked lines: each needs its agreement line id (else skipped, "no ID"),
  //     duplicates by agreement line id are dropped; the rate is the line's unitPrice, else its view bill rate,
  //     the unit its priceUom (DAY when blank).
  //   2 the old CreateRequestFromAgreementChain: a line that names only a class gets the first equipment of that
  //     class not already taken (GET /equipment-master?equipmentClassId=&size=5), one cart item per equipment;
  //     then draftStorage is cleared and written with the same keys (CartItemsArray, requestOrigin 'agreement',
  //     fromAgreementId / Number / Customer / CustomerRefId / FusionCustomerId / EffectiveFrom / EffectiveTo /
  //     Notes, agreementLineIdByEquipmentId, agreementRateByEquipmentId) and the tab flag eqr.agreement.active.
  //
  // Then New request opens (request/new-request, the New EquipRite page that replaces project-create-request).
  // NB New request does not read this hand-over yet: until it does, it opens with an empty cart. The change it
  // needs is described in the report of this screen (port HydrateDraftChain's agreement branch).
  class createRequestChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const v = $page.variables;
      if (!$page.functions.canRequest(v.agreementStatus)) return;
      if (v.busy) return;

      // ── 1. old AddToCartChain ───────────────────────────────────────────
      const selectedRows = (v.linesArray || []).filter((l) => (v.selected || {})[l.compositeKey]);
      if (selectedRows.length === 0) {
        await Actions.fireNotificationEvent(context, {
          summary: 'No selection',
          message: 'Check at least one row before adding to cart.',
          displayMode: 'transient',
          type: 'warning'
        });
        return;
      }
      const idMap = v.agreementLineIdByCompositeKey || {};
      const pending = [];
      const seenLineIds = new Set();
      let dupCount = 0;
      let unresolvedCount = 0;
      selectedRows.forEach(line => {
        const idEntry = idMap[line.compositeKey];
        if (!idEntry || idEntry.agreementLineId == null) {
          unresolvedCount++;
          return;
        }
        if (seenLineIds.has(idEntry.agreementLineId)) {
          dupCount++;
          return;
        }
        seenLineIds.add(idEntry.agreementLineId);
        pending.push({
          compositeKey:      line.compositeKey,
          agreementLineId:   idEntry.agreementLineId,
          equipmentMasterId: idEntry.equipmentMasterId,
          equipmentClassId:  idEntry.equipmentClassId,
          equipment_name:    line.equipment_name,
          class_name:        line.class_name,
          subClassName:      line.subClassName,
          quantity:          1,
          billingRate:       idEntry.unitPrice != null ? idEntry.unitPrice : line.bill_rate,
          priceUom:          idEntry.priceUom || line.price_uom || 'DAY'
        });
      });
      if (!pending.length) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Nothing new',
          message: 'Cart: ' + [dupCount ? dupCount + ' already in cart' : null, unresolvedCount ? unresolvedCount + ' skipped (no ID)' : null]
            .filter(Boolean).join(', ') + '.',
          displayMode: 'transient',
          type: 'warning'
        });
        return;
      }

      v.busy = true;
      try {
        // ── 2. old CreateRequestFromAgreementChain ────────────────────────
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
                uriParams: { equipmentClassId: p.equipmentClassId, size: 5 }
              });
              const rows = (listResp.ok && listResp.body && Array.isArray(listResp.body.data))
                ? listResp.body.data : [];
              const pick = rows.find(r => r && r.id != null && !usedMasterIds.has(Number(r.id)));
              if (pick) {
                masterId = Number(pick.id);
                masterName = pick.equipmentName || masterName;
              }
            } catch (e) { /* leave unresolved */ }
          }

          if (masterId == null) {
            console.warn('[createRequestChain] could not resolve master for line', p.agreementLineId);
            continue;
          }
          if (usedMasterIds.has(masterId)) {
            console.warn('[createRequestChain] duplicate master skipped', masterId);
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

        draftStorage.clear();
        draftStorage.save('CartItemsArray', cartItems);
        draftStorage.save('requestOrigin', 'agreement');
        draftStorage.save('fromAgreementId', Number(v.agreementHeaderId));
        draftStorage.save('fromAgreementNumber', v.agreementNumber || '');
        draftStorage.save('fromAgreementCustomer', v.customerName || '');
        draftStorage.save('fromAgreementCustomerRefId', v.customerRefId || null);
        draftStorage.save('fromAgreementFusionCustomerId', v.fusionCustomerId || null);
        draftStorage.save('fromAgreementEffectiveFrom', v.effectiveFrom || '');
        draftStorage.save('fromAgreementEffectiveTo', v.effectiveTo || '');
        draftStorage.save('fromAgreementNotes', v.agreementNotes || '');
        draftStorage.save('agreementLineIdByEquipmentId', agreementLineIdByEquipmentId);
        draftStorage.save('agreementRateByEquipmentId', agreementRateByEquipmentId);
        try { sessionStorage.setItem('eqr.agreement.active', '1'); } catch (e) { /* private mode */ }

        const fns = $application.functions;
        const route = fns.getNavRoute('new-request');
        if (!route) return;
        await Actions.navigateToFlow(context, { flow: route.flow, page: route.page, params: route.params || {}, target: 'parent' });
      } finally {
        try { v.busy = false; } catch (e) { /* page already left */ }
      }
    }
  }

  return createRequestChain;
});
