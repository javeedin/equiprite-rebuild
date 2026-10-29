define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/draftStorage',
], (ActionChain, Actions, draftStorage) => {
  'use strict';

  // Path B — the user picked (or cleared) a rental agreement from the optional
  // dropdown on the create-request page.
  //
  // GOAL: produce the EXACT same agreement context that Path A
  // (rental-agreement-lines -> CreateRequestFromAgreementChain) produces, so the
  // downstream catalog/cart/submit pages don't care which path was used. That
  // context is: draftStorage + $flow vars holding fromAgreement*,
  // CartItemsArray, agreementLineIdByEquipmentId, agreementClassIds, plus an
  // agreementRateByEquipmentId map the catalog uses to override rates.
  //
  // Path B does NOT pre-load the cart. Unlike Path A (where the user explicitly
  // checked lines on the agreement-lines page before navigating), selecting an
  // agreement here only SCOPES and PRICES the catalog: it filters the catalog
  // to the agreement's equipment and applies the agreement's rates. The user
  // then chooses what they actually want from the filtered catalog. So we build
  // the line-id map / rate map / class-id list (which drive catalog filtering &
  // pricing), but leave CartItemsArray empty.
  //
  // On SELECT (agreementId != null):
  //   1. Read the option detail off agreementOptionsArray (number/customer/
  //      effective dates/notes — already loaded, no header re-fetch).
  //   2. Fetch raw lines (getAgreementLines?agreementId) for ids + unitPrice +
  //      priceUom + masterId/classId, and view lines (by agreementNumber) for
  //      display names. Join on lineNumber.
  //   3. For class-only lines (no equipmentMasterId), resolve the first free
  //      master in the class — same as Path A.
  //   4. Build line-id map / rate map / class ids (NOT a cart), persist to
  //      draftStorage + $flow, and flag the agreement session.
  //
  // On CLEAR (agreementId == null): delegate to AgreementClearedChain's logic
  // by wiping all agreement context. (We inline it here to avoid a second
  // chain hop; AgreementClearedChain remains for the banner X-button path.)
  //
  // Dates and notes are intentionally NOT copied onto the request — the
  // agreement's effective window is the agreement's own validity, not the
  // rental window. (Matches the earlier product decision.)
  class AgreementSelectedChain extends ActionChain {
    async run(context, { agreementId } = {}) {
      const { $page, $flow } = context;

      const id = (agreementId != null && agreementId !== '') ? Number(agreementId) : null;

      // ── CLEAR ────────────────────────────────────────────────────────
      if (id == null) {
        this._clearAgreementContext($flow);
        return;
      }

      // Guard: if the dropdown's value is being set PROGRAMMATICALLY to the
      // already-active agreement (LoadAgreementsChain pre-selecting on page
      // entry / same-trip back-navigation), the context is already populated —
      // don't rebuild. A genuine user re-pick of the same id is impossible
      // (the value didn't change), so this is always a programmatic echo.
      // NOTE: we deliberately do NOT also gate on requestOrigin === 'agreement'
      // here — on a forward (Next) then back trip, NavigateToCatalogChain has
      // already flipped requestOrigin to 'project', so that extra condition
      // would miss and trigger a full rebuild that draftStorage.clear()s the
      // cart the user just built. Matching on id alone is the correct test.
      if ($flow.variables.fromAgreementId != null &&
          Number($flow.variables.fromAgreementId) === id) {
        return;
      }

      const options = $page.variables.agreementOptionsArray || [];
      const opt = options.find(function(o) { return Number(o.value) === id; }) || {};
      const agreementNumber = opt.agreementNumber || '';

      // ── Expiry gate ───────────────────────────────────────────────────────
      // Compare today's date (YYYY-MM-DD) against effectiveTo. If today is
      // strictly after the agreement's end date the agreement is expired and
      // cannot be used to raise a new request.
      const effectiveTo = opt.effectiveTo || '';
      if (effectiveTo) {
        const todayStr  = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD"
        const expiryStr = effectiveTo.split('T')[0];              // "YYYY-MM-DD"
        if (todayStr > expiryStr) {
          // Format expiry for the message: "31 Jul 2026"
          const ep = expiryStr.split('-');
          const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
          const expiryDisplay = ep[2] + ' ' + (MONTHS[parseInt(ep[1], 10) - 1] || ep[1]) + ' ' + ep[0];

          await Actions.fireNotificationEvent(context, {
            summary: 'Agreement Expired',
            message: 'Agreement ' + (opt.agreementNumber || String(id)) +
                     ' expired on ' + expiryDisplay +
                     '. Expired agreements cannot be used for new requests.',
            displayMode: 'persist',
            type: 'error'
          });
          // Reset the dropdown — don't allow the value to stay selected.
          $page.variables.selectedAgreementId = null;
          return;
        }
      }

      // ── 1. Fetch raw lines (ids + rate) and view lines (display names) ──
      const [rawResp, viewResp] = await Promise.all([
        Actions.callRest(context, {
          endpoint:  'eqp-v1/getAgreementLines',
          uriParams: { agreementId: id }
        }),
        agreementNumber
          ? Actions.callRest(context, {
              endpoint:  'eqp-v1/getEquipriteV1ViewsRentalAgreementLines',
              uriParams: { agreementNumber: agreementNumber }
            })
          : Promise.resolve({ ok: false })
      ]);

      const rawLines = (rawResp && rawResp.ok && rawResp.body && Array.isArray(rawResp.body.data))
        ? rawResp.body.data : [];
      const viewLines = (viewResp && viewResp.ok && viewResp.body && Array.isArray(viewResp.body.data))
        ? viewResp.body.data : [];

      const viewByLineNumber = new Map();
      viewLines.forEach(function(v) {
        if (v && v.lineNumber != null) viewByLineNumber.set(Number(v.lineNumber), v);
      });

      // ── 2. Build catalog scope/pricing maps, resolving class-only lines ──
      // (No cart is built — Path B only scopes/prices the catalog.)
      const agreementLineIdByEquipmentId = {};
      const agreementRateByEquipmentId   = {};
      const classIdSet = new Set();
      const usedMasterIds = new Set();
      let resolvedLineCount = 0;

      for (const line of rawLines) {
        if (!line || line.id == null) continue;
        const v = viewByLineNumber.get(Number(line.lineNumber)) || null;

        let masterId   = line.equipmentMasterId != null ? Number(line.equipmentMasterId) : null;
        let masterName = v ? (v.equipmentName || '') : '';
        const classId  = line.equipmentClassId != null ? Number(line.equipmentClassId) : null;

        // Class-only line: resolve the first free master in the class.
        if (masterId == null && classId != null) {
          try {
            const listResp = await Actions.callRest(context, {
              endpoint:  'eqp-v1/getEquipriteV1EquipmentMaster',
              uriParams: { equipmentClassId: classId, size: 10 }
            });
            const rows = (listResp.ok && listResp.body && Array.isArray(listResp.body.data))
              ? listResp.body.data : [];
            const pick = rows.find(function(r) { return r && r.id != null && !usedMasterIds.has(Number(r.id)); });
            if (pick) {
              masterId   = Number(pick.id);
              masterName = pick.equipmentName || masterName;
            }
          } catch (e) { /* leave unresolved */ }
        }

        if (masterId == null || usedMasterIds.has(masterId)) continue;
        usedMasterIds.add(masterId);
        if (classId != null) classIdSet.add(classId);

        const rate = line.unitPrice != null ? Number(line.unitPrice) : 0;
        const uom  = line.priceUom || 'DAY';

        agreementLineIdByEquipmentId[masterId] = Number(line.id);
        agreementRateByEquipmentId[masterId]   = { billingRate: rate, billingUnit: uom };
        resolvedLineCount++;
      }

      // ── 3. Persist context — same shape as Path A, but with an EMPTY cart.
      // Path B scopes/prices the catalog; the user fills the cart themselves.
      draftStorage.clear();
      draftStorage.save('CartItemsArray', []);
      draftStorage.save('requestOrigin', 'agreement');
      draftStorage.save('fromAgreementId', id);
      draftStorage.save('fromAgreementNumber', agreementNumber);
      draftStorage.save('fromAgreementCustomer', opt.customerName || '');
      draftStorage.save('fromAgreementCustomerRefId', opt.customerRefId != null ? opt.customerRefId : null);
      draftStorage.save('fromAgreementEffectiveFrom', opt.effectiveFrom || '');
      draftStorage.save('fromAgreementEffectiveTo', opt.effectiveTo || '');
      draftStorage.save('fromAgreementNotes', opt.notes || '');
      draftStorage.save('agreementLineIdByEquipmentId', agreementLineIdByEquipmentId);
      draftStorage.save('agreementRateByEquipmentId', agreementRateByEquipmentId);
      draftStorage.save('agreementClassIds', Array.from(classIdSet));

      try { sessionStorage.setItem('eqr.agreement.active', '1'); } catch (e) { /* private mode */ }

      // Mirror into $flow so the banner + downstream pages see it immediately.
      $flow.variables.fromAgreementId              = id;
      $flow.variables.fromAgreementNumber          = agreementNumber;
      $flow.variables.fromAgreementCustomer        = opt.customerName || '';
      $flow.variables.fromAgreementEffectiveFrom   = opt.effectiveFrom || '';
      $flow.variables.fromAgreementEffectiveTo     = opt.effectiveTo || '';
      $flow.variables.agreementLineIdByEquipmentId = agreementLineIdByEquipmentId;
      $flow.variables.agreementClassIds            = Array.from(classIdSet);
      $flow.variables.CartItemsArray               = [];
      $flow.variables.requestOrigin                = 'agreement';
      $flow.variables.request.customerId           = opt.fusionCustomerId != null ? opt.fusionCustomerId : null;

      await Actions.fireNotificationEvent(context, {
        summary: 'Agreement applied',
        message: (agreementNumber || 'Agreement') + ': the catalog will show only this agreement’s ' +
                 resolvedLineCount + ' equipment item(s), at its negotiated rates. Add what you need from there.',
        displayMode: 'transient',
        type: 'confirmation'
      });
    }

    // Wipe all agreement-driven state back to a fresh standalone request.
    // Kept in sync with ClearAgreementContextChain / AgreementClearedChain.
    _clearAgreementContext($flow) {
      try { sessionStorage.removeItem('eqr.agreement.active'); } catch (e) { /* silent */ }
      draftStorage.clear();
      $flow.variables.fromAgreementId              = null;
      $flow.variables.fromAgreementNumber          = '';
      $flow.variables.fromAgreementCustomer        = '';
      $flow.variables.fromAgreementEffectiveFrom   = '';
      $flow.variables.fromAgreementEffectiveTo     = '';
      $flow.variables.agreementLineIdByEquipmentId = {};
      $flow.variables.agreementClassIds            = [];
      $flow.variables.CartItemsArray               = [];
      $flow.variables.requestOrigin                = '';
      if ($flow.variables.request) $flow.variables.request.customerId = null;
    }
  }

  return AgreementSelectedChain;
});
