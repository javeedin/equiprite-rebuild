define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class submitTransactionChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const isMaterialIssue = $page.variables.activeTransactionTab !== '16a';

      // ── Expense tab (16a) is still capture-only ─────────────────────────────
      // There is no expense endpoint in this app; the Fusion expense call was
      // never registered. Keep the honest "captured, not sent" message rather
      // than implying a PPM posting happened.
      if (!isMaterialIssue) {
        $page.variables.isTransactionDrawerOpen = false;
        await Actions.fireNotificationEvent(context, {
          summary: 'Captured (not yet sent)',
          message: 'Expense details captured. This form does not post to Fusion yet — the expense integration is not wired.',
          type: 'warning',
        });
        return;
      }

      // ── Material Issue (16b) — this one DOES persist ─────────────────────────
      const td        = $page.variables.transactionData || {};
      const requestId = Number($page.variables.requestNumericId);
      const lineId    = td.request_line_id != null ? Number(td.request_line_id) : null;
      const itemNo    = (td.oracle_item_number || '').toString().trim();
      const qty       = Number(td.quantity_issued);

      // requestLineId is NOT optional in practice even though the column is
      // nullable: EQP_P_POST_COST_DETAILS (V245) flips a consumable to POSTED via
      // `EXISTS (... ic.REQUEST_LINE_ID = rl.EQR_REQUEST_LINE_ID)`. A consumption
      // saved without it is orphaned — the row exists but the line sits at
      // "In progress" forever, with no error to explain why.
      const problems = [];
      if (!requestId)          problems.push('the request id is missing');
      if (!lineId)             problems.push('no request line is selected');
      if (!itemNo)             problems.push('the item / lot / serial number is empty');
      if (!(qty > 0))          problems.push('quantity consumed must be greater than zero');

      // The SELECTED unit - used for both the on-hand guard and the org id below.
      // Deliberately not materialIssueLine.onhandQty, which is seeded from the line's
      // FIRST unit and is wrong as soon as the user picks a different item/lot/serial.
      const unit = ($page.variables.materialIssueUnitsArray || [])
        .find(u => u && u.value === itemNo) || null;

      // On-hand guard. Only blocks when a real number is known; a null on-hand must
      // not stop an entry.
      if (qty > 0 && itemNo) {
        const onHand = unit ? Number(unit.availableToReserve) : NaN;
        if (Number.isFinite(onHand) && qty > onHand) {
          problems.push('quantity consumed (' + qty + ') exceeds the ' + onHand
                      + ' on hand for ' + itemNo);
        }
      }

      if (problems.length) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Cannot record the material issue',
          message: 'Fix the following, then submit again: ' + problems.join(', ') + '.',
          type: 'error',
        });
        return;
      }

      // The consumption table has no subinventory column, and EquipRite holds
      // subinventory nowhere else, so keep it in NOTES rather than dropping what
      // the user typed. It moves to its own field when the Fusion call is wired.
      const sub   = (td.subinventory_code || '').toString().trim();
      const notes = sub ? ('Subinventory: ' + sub) : null;

      // transactionDate is REQUIRED even though the column defaults to SYSTIMESTAMP:
      // the entity maps it, so JPA sends an explicit NULL and the NOT NULL constraint
      // rejects the insert with a bare "Data integrity violation" that names no field.
      // Verified against the live endpoint - omitting it is a guaranteed 400.
      // Computed here rather than in a binding: `new Date()` in a VBCS expression has
      // no precedent anywhere in this app.
      const txnDate = new Date().toISOString().slice(0, 10) + 'T00:00:00Z';

      let created;
      try {
        created = await Actions.callRest(context, {
          endpoint: 'eqp-v1/createInventoryConsumption',
          body: {
            equipmentRequestId: requestId,
            requestLineId:      lineId,
            itemNumber:         itemNo,
            quantityConsumed:   qty,
            uomCode:            (td.unit_of_measure || 'EA').toString().trim(),
            // The drawer only shows the org NAME; the consumption row stores the id.
            // Kept in step with the auto-consume path on acceptDeliveryChain.
            invOrgId:           (unit && unit.invOrgId != null) ? Number(unit.invOrgId) : null,
            consumptionType:    'USAGE',   // CHK_IC_CONS_TYPE: USAGE/WASTE/RETURN/ADJUSTMENT
            transactionDate:    txnDate,
            notes:              notes,
          },
        });
      } catch (e) {
        console.error('[submitTransactionChain] consumption POST threw', e);
        created = null;
      }

      if (!created || !created.ok) {
        const detail = (created && created.body && (created.body.detail || created.body.errors)) || '';
        console.warn('[submitTransactionChain] consumption POST failed',
                     created && created.status, detail);
        await Actions.fireNotificationEvent(context, {
          summary: 'Material issue not recorded',
          message: 'The consumption could not be saved' + (detail ? (': ' + detail) : '.')
                 + ' Nothing was changed — you can retry.',
          type: 'error',
        });
        return;   // leave the drawer open so the entry is not lost
      }

      // ── Keep the line's own counter in sync, and close it out when fully used ──
      // The consumption row is the source of truth for Post Cost; CONSUMED_QUANTITY
      // is a convenience mirror. Re-derive it from the full set rather than adding
      // to a stale value, so repeat issues stay correct and a retry cannot double-count.
      let fullyConsumed = false;
      try {
        const all = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getInventoryConsumptions',
          uriParams: { requestId: requestId },
        });
        const rows = (all && all.ok && all.body && Array.isArray(all.body.data)) ? all.body.data : null;
        if (rows) {
          const total = rows
            .filter(r => Number(r.requestLineId) === lineId)
            .reduce((s, r) => s + Number(r.quantityConsumed || 0), 0);

          if (total > 0) {
            const line = ($page.variables.requestLinesArray || [])
              .find(l => l && Number(l.value) === lineId) || {};

            // The line is done when the whole DELIVERED quantity is used, not the
            // requested one: "if the entire delivered quantity is consumed, you are
            // done". They differ on a partial delivery - request 50, deliver 30,
            // consume 30 finishes the line.
            //
            // deliveredQuantity is only stamped by acceptDelivery going forward, so it
            // is null on every line that went on site before that shipped. Fall back to
            // the requested quantity there, otherwise those lines could never reach
            // CONSUMED at all.
            const delivered = Number(line.deliveredQuantity);
            const requested = Number(line.quantity);
            const denominator = Number.isFinite(delivered) && delivered > 0
              ? delivered
              : (Number.isFinite(requested) && requested > 0 ? requested : null);

            // Only a consumable takes this path; a rental is never "consumed".
            fullyConsumed = line.consumableFlag === 'Y'
                         && denominator != null
                         && total >= denominator;

            await Actions.callRest(context, {
              endpoint: 'eqp-v1/patchRequestLine',
              uriParams: { requestId: requestId, id: lineId },
              body: fullyConsumed
                ? { consumedQuantity: total, lineStatus: 'CONSUMED' }
                : { consumedQuantity: total },
            });
          }
        }
      } catch (e) {
        // Non-fatal: Post Cost reads the consumption rows, not this column or the status.
        console.warn('[submitTransactionChain] consumedQuantity/status sync failed', e);
      }

      // Close the request when this consumption was the last thing outstanding.
      // A CONSUMED line is terminal - it is the consumable's equivalent of CLOSED,
      // since nothing comes back. Mirrors the rollup in acceptDeliveryChain and the
      // return chains, and is evaluated locally against the line set already loaded
      // rather than re-fetching (an immediate re-read races the PATCH).
      let requestClosed = false;
      if (fullyConsumed) {
        try {
          const CLOSE_TERMINAL_STATES = ['CLOSED', 'REJECTED', 'CONSUMED'];
          const allLines = ($page.functions.getAllLines && $page.functions.getAllLines()) || [];
          const allTerminal = allLines.length > 0 && allLines.every(l =>
            Number(l.lineId) === lineId
              ? true                                   // this line just became CONSUMED
              : CLOSE_TERMINAL_STATES.indexOf(l.lineStatus) !== -1);

          if (allTerminal) {
            const headerPatch = await Actions.callRest(context, {
              endpoint: 'eqp-v1/patchEquipmentRequest',
              uriParams: { id: requestId },
              body: { status: 'CLOSED' },
            });
            requestClosed = !!(headerPatch && headerPatch.ok);
            if (!requestClosed) {
              console.warn('[submitTransactionChain] header CLOSED PATCH failed',
                           headerPatch && headerPatch.status);
            }
          }
        } catch (e) {
          console.warn('[submitTransactionChain] header close rollup failed', e);
        }
      }

      $page.variables.isTransactionDrawerOpen = false;

      await Actions.fireNotificationEvent(context, {
        summary: 'Material issue recorded',
        message: qty + ' x ' + itemNo + ' recorded against this line. Post Cost now shows it as Posted. '
               + (fullyConsumed
                    ? 'The full delivered quantity is now used, so the line is marked Consumed. '
                    : '')
               + (requestClosed ? 'That was the last open line, so the request is now Closed. ' : '')
               + 'Note: this does not yet issue the stock in Fusion — that integration is not wired.',
        type: 'confirmation',
      });
    }
  }

  return submitTransactionChain;
});
