define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Record a material issue (inventory consumption): the old request detail's submitTransactionChain, Material Issue
  // path, call for call:
  //   1 POST createInventoryConsumption {equipmentRequestId, requestLineId, itemNumber, quantityConsumed, uomCode,
  //     invOrgId, consumptionType USAGE, transactionDate (required: the column is NOT NULL), notes}. A failure stops
  //     here and keeps the form, so nothing is lost and it can be retried
  //   2 GET getInventoryConsumptions?requestId and PATCH patchRequestLine {consumedQuantity} from the full set (never
  //     added to a stale value), with lineStatus CONSUMED once a consumable's delivered quantity is used up
  //   3 when that was the last open line, PATCH patchEquipmentRequest {status: CLOSED}
  // Steps 2 and 3 are non-fatal, as before: Post Cost reads the consumption rows, not the counter.
  class submitConsumptionChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      if (v.isSubmitting || v.readOnly) return;
      // Copies: the page variables are live, and the form is reset below before the message is written.
      const req = Object.assign({}, v.current || {});
      const form = Object.assign({}, v.issue || {});
      const problems = fns.issueProblems(req && req.id, form, v.units);
      if (problems.length) {
        v.formError = 'Fix the following, then submit again: ' + problems.join(', ') + '.';
        return;
      }
      const requestId = Number(req.id);
      const lineId = Number(form.lineId);
      const unit = (v.units || []).find((u) => u.value === String(form.itemNumber || '').trim()) || null;
      const line = (v.lines || []).find((l) => Number(l.lineId) === lineId) || null;
      v.isSubmitting = true;
      v.formError = '';
      v.note = '';
      try {
        let created;
        try {
          created = await Actions.callRest(context, {
            endpoint: 'eqp-v1/createInventoryConsumption',
            body: fns.consumptionBody(requestId, form, unit, new Date().toISOString()),
          });
        } catch (e) {
          created = null;
        }
        if (!created || !created.ok) {
          const detail = (created && created.body && (created.body.detail || created.body.errors)) || '';
          v.formError = 'The consumption could not be saved' + (detail ? ': ' + detail : '.') + ' Nothing was changed — you can retry.';
          return;
        }

        let fullyConsumed = false;
        let rows = null;
        try {
          const all = await Actions.callRest(context, { endpoint: 'eqp-v1/getInventoryConsumptions', uriParams: { requestId } });
          rows = all && all.ok && all.body && Array.isArray(all.body.data) ? all.body.data : null;
          if (rows) {
            const state = fns.consumedState(rows, line);
            fullyConsumed = state.fullyConsumed;
            if (state.total > 0) {
              await Actions.callRest(context, {
                endpoint: 'eqp-v1/patchRequestLine',
                uriParams: { requestId, id: lineId },
                body: fullyConsumed ? { consumedQuantity: state.total, lineStatus: 'CONSUMED' } : { consumedQuantity: state.total },
              });
            }
          }
        } catch (e) {
          console.warn('[submitConsumptionChain] consumed quantity not synced (non-fatal)', e);
        }

        let requestClosed = false;
        if (fullyConsumed && fns.allTerminal(v.lines, lineId)) {
          try {
            const h = await Actions.callRest(context, { endpoint: 'eqp-v1/patchEquipmentRequest', uriParams: { id: requestId }, body: { status: 'CLOSED' } });
            requestClosed = !!(h && h.ok);
          } catch (e) {
            console.warn('[submitConsumptionChain] header close failed', e);
          }
        }

        if (rows) v.consumptions = rows;
        v.issue = Object.assign({}, form, { quantity: null });
        v.note = form.quantity + ' × ' + form.itemNumber + ' recorded against ' + (line ? line.equipmentName : 'the line') + '. '
          + (fullyConsumed ? 'The full delivered quantity is now used, so the line is marked Consumed. ' : '')
          + (requestClosed ? 'That was the last open line, so the request is now Closed. ' : '')
          + 'Post costs shows it as posted. The Fusion stock issue is not sent from EquipRite yet.';
        await Actions.fireNotificationEvent(context, { summary: 'Material issue recorded', message: v.note, type: 'confirmation', displayMode: 'transient' });
      } finally {
        v.isSubmitting = false;
      }
    }
  }

  return submitConsumptionChain;
});
