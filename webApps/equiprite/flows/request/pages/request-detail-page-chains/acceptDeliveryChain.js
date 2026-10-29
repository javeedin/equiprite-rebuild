define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestLineBody',
  'resources/js/currentUser'
], (ActionChain, Actions, lineBody, cu) => {
  'use strict';

  const SOURCE_STATE = 'SHIP_TO_SITE';

  // SHIP_TO_SITE forks by what the line IS, not by what the user clicked:
  //   rental     -> DEPLOYED   (then the return path, ending CLOSED)
  //   consumable -> DELIVERED  (then CONSUMED on the material issue)
  // Requirements call: "ship to site, it will go to deployed or it can go to
  // delivered". consumableFlag is resolved server-side off the SUBCLASS.
  const targetFor = (line) =>
    (line && line.consumableFlag === 'Y') ? 'DELIVERED' : 'DEPLOYED';

  // Two different questions, two different sets - and CONSUMED is in both on purpose.
  //   CLOSE: every line finished        -> the request is over
  //   ON_SITE: every line has landed    -> the request is Deployed
  // A consumables-only request closes outright; on a mixed request the consumable is
  // finished but the rental is still out, so CONSUMED must not block the Deployed
  // rollup either.
  const CLOSE_TERMINAL_STATES = ['CLOSED', 'REJECTED', 'CONSUMED'];
  const ON_SITE_STATES        = ['DEPLOYED', 'DELIVERED', 'CONSUMED'];

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
      // by hand.
      //
      // PER-SUBCLASS since V312. This used to read one global feature flag
      // (AUTO_CONSUME_ON_RECEIPT), so every consumable in the system got the same
      // answer; that flag is retired (row deactivated, toggle removed from the
      // config page) and the decision now lives on the subclass, which means ONE
      // accept can produce different outcomes per line.
      //
      // autoConsumeFlag is resolved server-side off the SUBCLASS and arrives on the
      // line - exactly like consumableFlag, and for the same reason: never infer
      // either from className, which is a taxonomy accident.
      //
      // Still fails closed, now for free rather than by an explicit latch: if the
      // field is absent (backend not yet deployed, stale response) `undefined ===
      // 'Y'` is false, so the line waits at DELIVERED for a manual issue and nothing
      // is double-charged. Do NOT "improve" this by defaulting it to 'Y'.
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
        // partial DELIVERED_QUANTITY yet (this chain stamps it = quantity), so the
        // fallback is today's behaviour exactly. Mirrors the manual path's own
        // denominator choice in submitTransactionChain.
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

      // Resolve each line's final state first, so the PATCH bodies below are a pure
      // write. A consumable that could not be auto-consumed degrades to DELIVERED.
      let autoConsumed = 0;
      let autoConsumeFailed = 0;
      const plans = [];
      for (const l of eligible) {
        const target = targetFor(l);
        const qty = Number(l.quantity);
        const body = { lineStatus: target };

        if (target === 'DELIVERED') {
          // DELIVERED_QUANTITY is the denominator the CONSUMED trigger divides by
          // ("if the entire delivered quantity is consumed, you are done") and
          // nothing else populates it.
          if (Number.isFinite(qty) && qty > 0) body.deliveredQuantity = qty;

          if (autoConsumeFor(l)) {
            const consumed = await autoConsumeLine(l);
            if (consumed != null) {
              body.lineStatus = 'CONSUMED';
              body.consumedQuantity = consumed;
              autoConsumed++;
            } else {
              autoConsumeFailed++;
            }
          }
        }
        plans.push({ line: l, body: body });
      }

      // ONE batch PATCH for every line (PATCH .../lines/batch: one transaction,
      // all or nothing), replacing a Promise.all of per-line PATCHes that the
      // browser queued six at a time (368 lines took 8.6 s; the batch ~0.7 s).
      // Each line carries its own body (lineStatus, deliveredQuantity and, for
      // auto-consumed lines, consumedQuantity).
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
      const updated = eligible.length;

      // Header rollup, computed locally from getAllLines() (the full, uncapped line
      // set loaded by initChain) merged with this call's own patch results —
      // deliberately NOT a re-fetch, because an immediate re-fetch right after the
      // PATCH races backend read-after-write visibility and can see stale
      // (pre-PATCH) lineStatus, silently skipping the rollup.
      const statusById = {};
      plans.forEach(p => { statusById[p.line.lineId] = p.body.lineStatus; });
      const allLines = $page.functions.getAllLines() || [];
      const effective = (l) => statusById[l.lineId] || l.lineStatus;

      // Close wins over deploy: a request whose every line has finished is over, even
      // though CONSUMED also counts as on-site for the mixed case below.
      const allClosed = allLines.length > 0 &&
        allLines.every(l => CLOSE_TERMINAL_STATES.indexOf(effective(l)) !== -1);
      const allOnSite = allLines.length > 0 &&
        allLines.every(l => ON_SITE_STATES.indexOf(effective(l)) !== -1);

      let headerTarget = null;
      if (allClosed)      headerTarget = 'CLOSED';
      else if (allOnSite) headerTarget = 'DEPLOYED';

      let headerSet = null;
      if (headerTarget) {
        const headerPatch = await Actions.callRest(context, {
          endpoint: 'eqp-v1/patchEquipmentRequest',
          uriParams: { id: numericId },
          body: { status: headerTarget }
        }).catch(e => ({ ok: false, error: e }));
        if (headerPatch.ok) {
          headerSet = headerTarget;
        } else {
          console.warn('[acceptDeliveryChain] header', headerTarget, 'PATCH failed:', headerPatch.status);
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
      if (skipped > 0)  message += ' ' + skipped + ' skipped (wrong state).';
      if (headerSet === 'CLOSED')   message += ' Request has been closed.';
      if (headerSet === 'DEPLOYED') message += ' Request has been marked Deployed.';

      const summary = headerSet === 'CLOSED'
        ? 'Delivery Accepted — Request Closed'
        : (headerSet === 'DEPLOYED' ? 'Delivery Accepted — Request Deployed' : 'Delivery Accepted');

      await Actions.fireNotificationEvent(context, {
        summary: summary,
        message: message,
        displayMode: 'persist',
        type: autoConsumeFailed > 0 ? 'warning' : 'info'
      });

      // ── Refresh in place — no browser reload ────────────────────────────
      // This used to be `window.location.reload()`. initChain does a single
      // enriched fetch (views/request-detail-lines) that rebuilds BOTH the
      // header formData (including status, which the accept may just have
      // flipped to DEPLOYED/CLOSED) and the grid, reassigning every variable
      // wholesale rather than appending — so re-running it is equivalent to
      // reloading, minus the white flash and the re-fetch of the whole app.
      //
      // The selection state has to be cleared alongside it, and that is
      // probably why the blunt reload was reached for: the accepted rows are
      // no longer SHIP_TO_SITE, so leaving selectionState behind would keep
      // the Accept button live against lines that have already moved on.
      // page-module _selectedRows is reset by initGridData() itself; these two
      // page variables are not, so they are cleared here:
      //   selectionState — drives the header buttons' :disabled bindings
      //   selectionTick  — forces the row checkbox :checked bindings to
      //                    re-evaluate, otherwise rows stay visually ticked
      await Actions.callChain(context, {
        chain: 'initChain',
        params: {
          requestId:        $page.variables.requestId,
          requestNumericId: numericId
        }
      });

      $page.variables.selectionState = {
        count: 0, sharedStatus: '', isMixed: false, wasMixed: false,
        allSelected: false,
        allDeployed: false, allReturnable: false, allShipToSite: false
      };
      $page.variables.selectionTick = ($page.variables.selectionTick || 0) + 1;
    }
  }

  return acceptDeliveryChain;
});
