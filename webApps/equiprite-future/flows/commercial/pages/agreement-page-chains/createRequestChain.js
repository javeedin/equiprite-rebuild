define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/agreementRules',
  'resources/js/draftStorage',
  'resources/js/shellBus',
], (ActionChain, Actions, A, draftStorage, bus) => {
  'use strict';

  // "Create request from N lines": New EquipRite's createRequestChain (the old Add to cart + Create Request), with its
  // rules unchanged:
  //   0 only from an ACTIVE agreement, and not twice at once
  //   1 the old AddToCartChain over the ticked lines (agreementRules.pendingLines): each needs its agreement line id
  //     (else skipped, "no ID"), duplicates by agreement line id are dropped; the rate is the line's unitPrice, else
  //     its view bill rate, the unit its priceUom (DAY when blank)
  //   2 the old CreateRequestFromAgreementChain: a line that names only a class gets the first equipment of that class
  //     not already taken (GET /equipment-master?equipmentClassId=&size=5), one cart item per equipment; then
  //     draftStorage is cleared and written with the same keys (CartItemsArray, requestOrigin 'agreement',
  //     fromAgreementId / Number / Customer / CustomerRefId / FusionCustomerId / EffectiveFrom / EffectiveTo / Notes,
  //     agreementLineIdByEquipmentId, agreementRateByEquipmentId) and the tab flag eqr.agreement.active
  //     (agreementRules.writeHandoff).
  // Then a New request tab of its own opens (record 'agreement-request'), which reads the hand-off once.
  class createRequestChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;
      if (!A.canRequest(v.agreementStatus)) return;
      if (v.busy) return;

      // ── 1. old AddToCartChain ───────────────────────────────────────
      const step = A.pendingLines(v.linesArray, v.selected, v.idMap);
      if (step.selected === 0) {
        this.say(v, 'Tick at least one line to request.', 'warning');
        return;
      }
      const pending = step.pending;
      if (!pending.length) {
        this.say(v, 'Nothing to request: ' + [step.dupCount ? step.dupCount + ' already in the request' : null,
          step.unresolvedCount ? step.unresolvedCount + ' skipped (no agreement line id)' : null].filter(Boolean).join(', ') + '.', 'warning');
        return;
      }

      v.busy = true;
      try {
        // ── 2. old CreateRequestFromAgreementChain ──────────────────────
        const cartItems = [];
        const agreementLineIdByEquipmentId = {};
        const agreementRateByEquipmentId = {};
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
              const rows = (listResp && listResp.ok && listResp.body && Array.isArray(listResp.body.data))
                ? listResp.body.data : [];
              const pick = rows.find((r) => r && r.id != null && !usedMasterIds.has(Number(r.id)));
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

          const c = A.cartItem(p, masterId, masterName);
          cartItems.push(c.item);
          agreementLineIdByEquipmentId[masterId] = p.agreementLineId;
          agreementRateByEquipmentId[masterId] = c.rate;
        }

        if (cartItems.length === 0) {
          this.say(v, 'No equipment could be found for the ticked lines, so no request was started.', 'error');
          return;
        }

        A.writeHandoff(draftStorage, window.sessionStorage, {
          headerId: v.agreementHeaderId,
          number: v.agreementNumber,
          customerName: v.customerName,
          customerRefId: v.customerRefId,
          fusionCustomerId: v.fusionCustomerId,
          effectiveFrom: v.effectiveFrom,
          effectiveTo: v.effectiveTo,
          notes: v.agreementNotes
        }, cartItems, agreementLineIdByEquipmentId, agreementRateByEquipmentId);

        v.selected = {};
        this.say(v, cartItems.length + (cartItems.length === 1 ? ' line went' : ' lines went') + ' to New request at this agreement\'s rates. '
          + 'Add the project, dates and delivery there.', 'info');
        // A New request tab of its own reads the hand-off (one already open keeps what is in it).
        bus.open({ record: 'agreement-request', params: { agreement: v.agreementNumber || String(v.agreementHeaderId || ''), at: Date.now() } });
      } finally {
        try { v.busy = false; } catch (e) { /* tab already closed */ }
      }
    }

    say(v, message, tone) {
      v.note = message;
      v.noteTone = tone;
      bus.toast(message, tone);
    }
  }

  return createRequestChain;
});
