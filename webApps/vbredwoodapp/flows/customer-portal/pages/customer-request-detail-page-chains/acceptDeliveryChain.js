define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestLineBody',
  'resources/js/currentUser'
], (ActionChain, Actions, lineBody, cu) => {
  'use strict';

  // Customer accepts delivery on the selected lines: SHIP_TO_SITE → DEPLOYED.
  // Mirrors the project-mode acceptDeliveryChain but stays inside the customer
  // module — same `patchRequestLine` endpoint, same lineStatus vocabulary
  // (memory project_request_line_status_cascade.md).
  const SOURCE_STATE = 'SHIP_TO_SITE';

  // SHIP_TO_SITE forks by what the line IS: a rental goes DEPLOYED (then the return
  // path), a consumable goes DELIVERED (then CONSUMED on the material issue).
  // consumableFlag is resolved server-side off the SUBCLASS.
  const targetFor = (line) =>
    (line && line.consumableFlag === 'Y') ? 'DELIVERED' : 'DEPLOYED';

  // All three count as "on site" for the header rollup. CONSUMED must be included:
  // on a mixed request a consumable may already have been auto-consumed - either by
  // the EM on the project page or by this chain's own auto-consume block
  // below - and if that line did not count, the rollup would never fire when the
  // remaining rental is accepted. (No close rollup here on purpose - a customer accept only
  // ever produces DELIVERED/DEPLOYED, neither of which is terminal, so an all-
  // terminal state is unreachable from this chain.)
  const ON_SITE_STATES = ['DEPLOYED', 'DELIVERED', 'CONSUMED'];

  // Stamp DELIVERED_QUANTITY as a consumable goes on site: it is the denominator the
  // CONSUMED trigger divides by, and nothing else populates it.
  const bodyFor = (line) => {
    const target = targetFor(line);
    const body = { lineStatus: target };
    if (target === 'DELIVERED') {
      const q = Number(line && line.quantity);
      if (Number.isFinite(q) && q > 0) body.deliveredQuantity = q;
    }
    return body;
  };

  class acceptDeliveryChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const numericId = $page.variables.requestNumericId;

      if (!numericId) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Error',
          message: 'Request ID not available. Please reload the page.',
          displayMode: 'transient',
          type: 'error'
        });
        return;
      }

      const selected = $page.functions.getSelectedLines() || [];
      const pool = selected.length > 0 ? selected : ($page.functions.getAllLines() || []);
      const eligible = pool.filter(l => l.lineStatus === SOURCE_STATE);
      const skipped = pool.length - eligible.length;

      if (eligible.length === 0) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Nothing to Accept',
          message: 'No selected line is in Shipping to Site state.',
          displayMode: 'transient',
          type: 'warning'
        });
        return;
      }

      // AUTO-CONSUME: issue the material transaction for a consumable the
      // moment its delivery is accepted, instead of waiting for someone to record it
      // by hand. Ported from the project-mode copy — this chain shipped without it,
      // so with the flag ON a consumable accepted HERE stopped at DELIVERED while the
      // identical line accepted on the project page went to CONSUMED (line 1000001598
      // vs 1000001595/1000001602, all on 2026-08-05).
      //
      // PER-SUBCLASS since V312. This used to read one global feature flag
      // (AUTO_CONSUME_ON_RECEIPT), so every consumable got the same answer; that flag
      // is retired and the decision now lives on the subclass, so ONE accept can
      // produce different outcomes per line. autoConsumeFlag is resolved server-side
      // off the SUBCLASS and arrives on the line, exactly like consumableFlag.
      //
      // Still fails closed for free: an absent field means `undefined === 'Y'` is
      // false, so the line waits at DELIVERED for a manual issue. Do NOT default it
      // to 'Y'. Kept identical to the project-mode copy - see the drift note above.
      const autoConsumeFor = (line) => !!line && line.autoConsumeFlag === 'Y';

      // transactionDate is REQUIRED on the consumption POST even though the column
      // defaults to SYSTIMESTAMP - the entity maps it, so JPA sends an explicit NULL
      // and the insert fails with a bare "Data integrity violation" naming no field.
      const txnDate = new Date().toISOString().slice(0, 10) + 'T00:00:00Z';

      // Try to auto-consume ONE consumable line. Returns the quantity consumed, or
      // null if it could not be done - in which case the caller falls back to
      // DELIVERED so the accept still succeeds and the line can be issued by hand.
      const autoConsumeLine = async (line) => {
        // Consume what ARRIVED, not what was asked for: "if the entire delivered
        // quantity is consumed, you are done". They differ on a partial delivery —
        // request 50, deliver 30, and issuing 50 would auto-consume stock that is
        // not on site. Falls back to the requested quantity because nothing writes a
        // partial DELIVERED_QUANTITY yet (bodyFor stamps it = quantity), so the
        // fallback is today's behaviour exactly. Kept identical to the project-mode
        // copy — these two chains have drifted before.
        const delivered = Number(line.deliveredQuantity);
        const requested = Number(line.quantity);
        const qty = (Number.isFinite(delivered) && delivered > 0) ? delivered : requested;
        if (!Number.isFinite(qty) || qty <= 0) return null;

        // The request line carries no inventory item reference; the item/lot/serial
        // number lives on its physical units.
        let unit = null;
        try {
          const units = await Actions.callRest(context, {
            endpoint: 'eqp-v1/getEquipriteV1ViewsLineDetailUnits',
            uriParams: { requestId: numericId, lineId: Number(line.lineId) }
          });
          const rows = (units && units.ok && units.body && Array.isArray(units.body.data))
            ? units.body.data : [];
          unit = rows[0] || null;
        } catch (e) {
          console.warn('[acceptDeliveryChain] unit lookup failed for line', line.lineId, e);
        }

        // ITEM_NUMBER is NOT NULL and there is no other source for it.
        if (!unit || !unit.unitNumber) {
          console.warn('[acceptDeliveryChain] no unit/item number for line', line.lineId,
                       '- leaving at DELIVERED for a manual issue');
          return null;
        }

        try {
          const created = await Actions.callRest(context, {
            endpoint: 'eqp-v1/createInventoryConsumption',
            body: {
              equipmentRequestId: Number(numericId),
              requestLineId:      Number(line.lineId),
              itemNumber:         String(unit.unitNumber),
              quantityConsumed:   qty,
              uomCode:            unit.uomCode || 'EA',
              invOrgId:           unit.invOrgId != null ? Number(unit.invOrgId) : null,
              consumptionType:    'USAGE',
              transactionDate:    txnDate,
              notes:              'Auto-issued on delivery acceptance (subclass AUTO_CONSUME_FLAG)'
            }
          });
          if (!created || !created.ok) {
            console.warn('[acceptDeliveryChain] consumption POST failed for line',
                         line.lineId, created && created.status);
            return null;
          }
        } catch (e) {
          console.warn('[acceptDeliveryChain] consumption POST threw for line', line.lineId, e);
          return null;
        }
        return qty;
      };

      // Resolve each line's final state FIRST, so the PATCHes below stay a pure write.
      // Sequential because each consumable may fire a consumption POST; the PATCHes
      // themselves still go in parallel, as before. A consumable that could not be
      // auto-consumed degrades to DELIVERED.
      let autoConsumed = 0;
      let autoConsumeFailed = 0;
      const plans = [];
      for (const l of eligible) {
        const body = bodyFor(l);
        if (autoConsumeFor(l) && body.lineStatus === 'DELIVERED') {
          const consumed = await autoConsumeLine(l);
          if (consumed != null) {
            body.lineStatus = 'CONSUMED';
            body.consumedQuantity = consumed;
            autoConsumed++;
          } else {
            autoConsumeFailed++;
          }
        }
        plans.push({ line: l, body: body });
      }

      // ONE batch PATCH for every line (PATCH .../lines/batch: one transaction,
      // all or nothing), replacing a Promise.all of per-line PATCHes that the
      // browser queued six at a time (368 lines took 8.6 s; the batch ~0.7 s).
      const batch = await lineBody.updateLines(context, Actions, {
        requestId: numericId,
        headers:   cu.auditHeaders(context),
        updates:   plans.map(p => Object.assign({ id: Number(p.line.lineId) }, p.body)),
        labels:    plans.map(p => p.line.equipmentName)
      });
      if (!batch.ok) {
        // All or nothing: no line changed, so there is nothing to roll up.
        await Actions.fireNotificationEvent(context, {
          summary: 'Accept failed',
          message: batch.message + ' No line was changed.'
            + (autoConsumed > 0 ? ' ' + autoConsumed + ' consumption record(s) were already created for auto-issued consumables; check them before retrying.' : ''),
          displayMode: 'persist',
          type: 'error'
        });
        return;
      }
      const updated  = eligible.length;

      // Header deployed rollup: only when EVERY line on the request is now
      // DEPLOYED. Computed locally from getAllLines() (the full, uncapped
      // line set loaded by initChain) merged with this call's own patch
      // results — deliberately NOT a re-fetch, because an immediate re-fetch
      // right after the PATCH races backend read-after-write visibility and
      // can see stale (pre-PATCH) lineStatus, silently skipping the rollup.
      const succeededIds = new Set(eligible.map(l => l.lineId));
      const allLines = $page.functions.getAllLines() || [];
      const allDeployed = allLines.length > 0 &&
        allLines.every(l => succeededIds.has(l.lineId) || ON_SITE_STATES.indexOf(l.lineStatus) !== -1);

      let headerDeployed = false;
      if (allDeployed) {
        const headerPatch = await Actions.callRest(context, {
          endpoint:  'eqp-v1/patchEquipmentRequest',
          uriParams: { id: numericId },
          body:      { status: 'DEPLOYED' }
        }).catch(e => ({ ok: false, error: e }));
        if (headerPatch.ok) {
          headerDeployed = true;
        } else {
          console.warn('[acceptDeliveryChain] header DEPLOYED PATCH failed:', headerPatch.status);
        }
      }

      let message = updated + ' line(s) accepted.';
      if (autoConsumed > 0) {
        message += ' ' + autoConsumed + ' consumable(s) auto-issued and marked Consumed.';
      }
      if (autoConsumeFailed > 0) {
        message += ' ' + autoConsumeFailed + ' consumable(s) could not be auto-issued '
                 + '(no item number found) — record the material issue manually.';
      }
      if (skipped  > 0) message += ' ' + skipped + ' skipped (wrong state).';
      if (headerDeployed) message += ' Request has been marked Deployed.';

      await Actions.fireNotificationEvent(context, {
        summary:     headerDeployed ? 'Delivery Accepted — Request Deployed' : 'Delivery Accepted',
        message:     message,
        displayMode: 'persist',
        type:        autoConsumeFailed > 0 ? 'warning' : 'info'
      });

      setTimeout(() => { window.location.reload(); }, 100);
    }
  }

  return acceptDeliveryChain;
});
