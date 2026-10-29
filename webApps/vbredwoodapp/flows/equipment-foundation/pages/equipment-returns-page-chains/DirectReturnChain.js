define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/returnLeg',
  'resources/js/currentUser',
], (ActionChain, Actions, rl, cu) => {
  'use strict';

  /**
   * DIRECT RETURN — return equipment that came back without prior notice.
   *
   * The units were chosen in the Direct Return dialog, which found them by
   * scanning or searching rather than by opening a request. This chain takes
   * that selection and runs the SAME inbound-Transfer-Order sequence
   * request-detail's processReturn runs — via resources/js/returnLeg, so there
   * is one implementation, not two.
   *
   * What is new here is only the way in. The return itself is normal:
   * inbound TO -> RETURN_IN_PROCESS, and the line then travels the usual path
   * to SHIPPED_TO_YARD and Accept on this very page.
   *
   * ── PER REQUEST, THEN PER ROUTE ────────────────────────────────────────────
   * A Direct Return selection can span several requests — the operator has a
   * pile of equipment, not a purchase order. Each request is planned, reserved
   * and recorded independently, and within a request each (source|dest) route
   * gets its own Transfer Order.
   *
   * ── F&M RETURNS WITH NO TRANSFER ORDER ─────────────────────────────────────
   * An F&M line (fulfilmentClass F_AND_M: the item OR either yard is not
   * transactable) never went out on a Transfer Order, so its return is the
   * status flip alone — /returns/record, exactly as request-detail does it.
   * Sending it to /returns/plan instead blocks it as "no yard", because there is
   * no outbound movement to reverse. Lines the plan itself lists in
   * fAndMLineIds are treated the same way.
   */

  async function notify(context, payload) {
    try {
      await Actions.fireNotificationEvent(context, payload);
    } catch (e) {
      console.warn('[DirectReturnChain] toast failed — continuing:', e);
    }
  }

  // Deterministic key over the INTENT: same request + same lines + same route
  // => same key. No clock, so a double-click collapses to one Transfer Order
  // instead of two. Mirrors buildIdempotencyKey in request-detail's ActionChain.
  function buildKey(requestId, lineIds, routeKey, attempt) {
    var ids = (lineIds || []).map(Number).filter(function (n) { return isFinite(n); })
      .sort(function (a, b) { return a - b; }).join(',');
    var canonical = ['v1', String(requestId), ids, 'INBOUND', String(routeKey || '')].join('|')
      + (Number(attempt) > 0 ? '|a' + Number(attempt) : '');
    var fnv = function (str, seed) {
      var h = seed >>> 0;
      for (var i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return ('00000000' + h.toString(16)).slice(-8);
    };
    return fnv(canonical, 0x811c9dc5) + fnv(canonical, 0x9dc5811c);
  }

  class DirectReturnChain extends ActionChain {
    /**
     * @param {Object} params
     *   rows {Array} selected rows from the dialog, shaped by
     *                resources/js/directReturn.mapRow
     */
    async run(context, params) {
      const { $page } = context;
      const rows = (params && params.rows) || [];
      if (!rows.length) return;

      const headers = cu.auditHeaders(context);
      const nowIso  = new Date().toISOString();

      // Group by request — the return runs per request.
      const byRequest = new Map();
      rows.forEach(r => {
        const k = Number(r.requestId);
        if (!byRequest.has(k)) {
          byRequest.set(k, { requestId: k, requestNumber: r.requestNumber,
                             lineIds: [], fmLineIds: [] });
        }
        const g = byRequest.get(k);
        // Two units on the SAME line are two rows but one line to return.
        const isFm = String(r.fulfilmentClass || '').toUpperCase() === 'F_AND_M';
        const into = isFm ? g.fmLineIds : g.lineIds;
        if (into.indexOf(Number(r.lineId)) === -1) into.push(Number(r.lineId));
      });

      let tosCreated   = 0;
      let linesDone    = 0;
      let fmDone       = 0;
      let replayed     = 0;
      let rejected     = 0;
      const failures   = [];
      const blocked    = [];

      for (const g of byRequest.values()) {
        // ── 1. Reset any FAILED prior return first ────────────────────────
        // A line whose earlier inbound TO failed sits at RETURN_IN_PROCESS,
        // which is not returnable — it must go back to DEPLOYED before it can
        // be retried. Server-told via to_needs_reset; a line whose return
        // actually succeeded is ALSO RETURN_IN_PROCESS and must NOT be reset,
        // which is why this is never inferred from status.
        const needsReset = rows
          .filter(r => Number(r.requestId) === g.requestId && r.to_needs_reset === true)
          .map(r => Number(r.lineId));
        if (needsReset.length) {
          const rs = await rl.resetFailedReturn(context, Actions, g.requestId, needsReset, headers);
          if (!rs.ok) {
            // 409 = an inbound TO succeeded, the equipment is genuinely in
            // transit. That message is written to be read — surface it whole.
            failures.push(g.requestNumber + ' — ' +
              (rs.message || ('could not reset the failed return (HTTP ' + rs.status + ')')));
            continue;
          }
        }

        // ── 2. Plan (S&T lines only) ──────────────────────────────────────
        const plan = g.lineIds.length
          ? await rl.planReturn(context, Actions, g.requestId, g.lineIds)
          : { ok: true, routes: [], blocks: [], fAndMLineIds: [] };
        if (!plan.ok) {
          failures.push(g.requestNumber + ' — could not resolve return routes');
        }

        // ── 2b. F&M — no Transfer Order, the status flip is the whole return ──
        // The rows' own class, plus any line the server lists as F&M.
        const fmIds = g.fmLineIds.slice();
        (plan.fAndMLineIds || []).forEach(id => {
          if (fmIds.indexOf(Number(id)) === -1) fmIds.push(Number(id));
        });
        if (fmIds.length) {
          const fmRec = await rl.recordReturn(context, Actions, g.requestId, fmIds, headers);
          if (fmRec.ok) {
            fmDone    += fmRec.linesPromoted;
            linesDone += fmRec.linesPromoted;
          } else {
            failures.push(g.requestNumber + ' — fixed-asset return could not be recorded');
          }
        }
        if (!plan.ok) continue;
        // NO block-all on the return leg: a blocked line is named and skipped,
        // the resolvable ones still travel. Refusing the whole return because
        // one line lost its yard stamp would strand equipment on site.
        (plan.blocks || []).forEach(b => blocked.push(
          'Line ' + (b.lineNumber != null ? b.lineNumber : '?') +
          ' (' + (b.equipmentName || '?') + ')'));

        if (!plan.routes.length) continue;

        const baseBatch = rl.baseBatchFor(g.requestNumber || g.requestId);
        const recordable = [];

        // ── 3. One inbound TO per (source|dest) route ─────────────────────
        for (const route of plan.routes) {
          const routeKey    = route.sourceOrgCode + '|' + route.destOrgCode;
          const batchNumber = baseBatch + '-' + route.destOrgCode;
          const items = (route.lines || []).map(pl => ({
            lineId:     pl.requestLineId,
            itemNumber: pl.itemNumber,
            qty:        pl.qty,
            srcCode:    route.sourceOrgCode,
            destCode:   route.destOrgCode
          }));
          if (!items.length) continue;

          const lineIds = items.map(i => Number(i.lineId));
          const key = buildKey(g.requestId, lineIds, routeKey, 0);

          const resv = await rl.reserveRoute(
            context, Actions, g.requestId, lineIds, batchNumber, key, headers);
          if (resv.replayed) {
            // This exact intent was already recorded — the TO exists from the
            // first fire. Success, not failure: create nothing.
            replayed++;
            continue;
          }
          if (!resv.proceed) {
            rejected += (resv.rejected || []).length;
            continue;
          }

          let oic;
          try {
            oic = await Actions.callRest(context, {
              endpoint: 'ics/createSupplyRequest',
              body:     rl.buildOicBody(g.requestId, batchNumber, items, nowIso)
            });
          } catch (e) {
            console.error('[DirectReturnChain] OIC failed for ' + routeKey + ':', e);
            failures.push(routeKey.replace('|', ' → ') + ' — network error');
            await rl.releaseRoute(context, Actions, g.requestId, batchNumber, headers);
            continue;
          }
          if (!oic || !oic.ok) {
            const msg = (oic && oic.body && oic.body.message) || ('HTTP ' + (oic && oic.status));
            failures.push(routeKey.replace('|', ' → ') + ' — ' + msg);
            await rl.releaseRoute(context, Actions, g.requestId, batchNumber, headers);
            continue;
          }

          tosCreated++;
          lineIds.forEach(id => { if (recordable.indexOf(id) === -1) recordable.push(id); });
        }

        // ── 4. Record — one transaction for this request's returned lines ──
        if (recordable.length) {
          const rec = await rl.recordReturn(context, Actions, g.requestId, recordable, headers);
          if (rec.ok) linesDone += rec.linesPromoted;
          else failures.push(g.requestNumber + ' — Transfer Order created but status not updated');
        }
      }

      // ── 5. Report ───────────────────────────────────────────────────────
      const blockedSuffix = blocked.length
        ? ' ' + blocked.length + ' line' + (blocked.length === 1 ? '' : 's') +
          ' skipped — could not determine where the equipment came from: ' +
          blocked.slice(0, 3).join('; ') + (blocked.length > 3 ? ' …' : '') + '.'
        : '';
      const replaySuffix = replayed
        ? ' ' + replayed + ' already requested (duplicate ignored).' : '';
      const rejectSuffix = rejected
        ? ' ' + rejected + ' line' + (rejected === 1 ? '' : 's') +
          ' skipped — another user is returning them.' : '';

      const fmSuffix = fmDone
        ? ' ' + fmDone + ' fixed-asset line' + (fmDone === 1 ? '' : 's') +
          ' returned without a Transfer Order.' : '';

      if (!tosCreated && fmDone && !failures.length) {
        await notify(context, {
          summary:     'Return Recorded',
          message:     fmDone + ' fixed-asset line' + (fmDone === 1 ? '' : 's') +
                       ' returned — no Transfer Order needed.' +
                       blockedSuffix + replaySuffix + rejectSuffix,
          type:        blocked.length ? 'warning' : 'confirmation',
          displayMode: blocked.length ? 'persist' : 'transient'
        });
      } else if (tosCreated && !failures.length) {
        await notify(context, {
          summary:     tosCreated === 1 ? 'Return Requested' : 'Returns Requested',
          message:     tosCreated + ' return Transfer Order' + (tosCreated === 1 ? '' : 's') +
                       ' requested for ' + (linesDone - fmDone) + ' line' + ((linesDone - fmDone) === 1 ? '' : 's') + '.' +
                       fmSuffix + blockedSuffix + replaySuffix + rejectSuffix,
          type:        blocked.length ? 'warning' : 'confirmation',
          displayMode: blocked.length ? 'persist' : 'transient'
        });
      } else if ((tosCreated || fmDone) && failures.length) {
        await notify(context, {
          summary:     'Partially Returned',
          message:     tosCreated + ' Transfer Order' + (tosCreated === 1 ? '' : 's') + ' requested; ' +
                       failures.length + ' failed — ' +
                       failures.slice(0, 3).join('; ') + (failures.length > 3 ? ' …' : '') + '.' +
                       fmSuffix + blockedSuffix + replaySuffix + rejectSuffix,
          type:        'warning',
          displayMode: 'persist'
        });
      } else if (replayed && !failures.length) {
        await notify(context, {
          summary:     'Already Requested',
          message:     'These returns were already requested — nothing further was created. ' +
                       'Refresh to see them.' + blockedSuffix,
          type:        'info',
          displayMode: 'transient'
        });
      } else {
        await notify(context, {
          summary:     'Return Failed',
          message:     (failures.length
                         ? 'No returns were created — ' + failures.slice(0, 3).join('; ') +
                           (failures.length > 3 ? ' …' : '') + '.'
                         : 'No returns were created.') + blockedSuffix + rejectSuffix,
          type:        'error',
          displayMode: 'persist'
        });
      }

      // Close the dialog and clear its state so the next scan starts clean.
      // Imperative close, matching how it opens - oj-dialog has no bindable
      // `opened` property.
      // Release the camera if the viewfinder was still up when the operator
      // submitted - this path closes the dialog itself, so it must do the
      // teardown CloseDirectReturnChain would otherwise have done.
      try {
        await Actions.callChain(context, { chain: 'CloseScannerChain' });
      } catch (e) {
        console.warn('[DirectReturnChain] scanner teardown failed:', e);
      }

      const dlg = document.getElementById('directReturnDialog');
      if (dlg && typeof dlg.close === 'function') dlg.close();
      $page.variables.directReturnOpen    = false;
      $page.variables.directReturnRows    = [];
      $page.variables.directReturnSelected = [];
      $page.variables.directReturnQuery   = '';

      // Refresh the queue — a returned line changes which rows qualify.
      try {
        await Actions.callChain(context, { chain: 'InitPickingQueueChain' });
      } catch (e) {
        console.warn('[DirectReturnChain] queue refresh failed:', e);
      }
    }
  }

  return DirectReturnChain;
});
