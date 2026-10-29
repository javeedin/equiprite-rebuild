define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/currentUser',
], (ActionChain, Actions, cu) => {
  'use strict';

  // Transfer. No old chain to carry over (Old EquipRite has no transfer screen); the sequence follows the old
  // confirm's guard (request-detail ActionChain: plan -> reserve -> work -> release on failure) with the transfer
  // endpoints of services/eqp-v1:
  //   1 POST requests/{dest}/transfer-orders/plan     read-only: the destination site, and blocks (no quote,
  //                                                   no item number) that stop the move
  //   2 POST requests/{dest}/transfer-orders/reserve  the destination lines' OUTBOUND leg, deterministic key: a
  //                                                   repeat fire answers replayed (success, create nothing);
  //                                                   lines held by a concurrent confirm stop it. An outage of the
  //                                                   reserve does not block (the old confirm's rule).
  //   3 POST transfer-orders                          INTER_PROJECT, PENDING, source site -> destination site
  //   4 POST transfer-order-lines                     one per unit, on the destination line it fills
  //   5 POST transfer-history                         one per unit, so both requests show it
  // A failure in 3 or 4 releases the reservation (and cancels a half-built order), so nothing is left half done.
  // The Fusion inter-org transfer (INT-18) has no call in services/: the transfer is recorded PENDING and the
  // source and destination line statuses are left as they are until it completes.
  async function call(context, opts) {
    try {
      const res = await Actions.callRest(context, opts);
      return res || { ok: false, status: 0 };
    } catch (e) {
      console.error('[createTransferChain] ' + opts.endpoint + ' threw', e);
      return { ok: false, status: 0, body: { message: String((e && e.message) || e) } };
    }
  }
  const http = (res) => (res && res.status ? 'HTTP ' + res.status : 'no answer');
  const rows = (res) => {
    const b = res && res.ok ? res.body : null;
    return Array.isArray(b) ? b : ((b && Array.isArray(b.data)) ? b.data : []);
  };

  class createTransferChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      // Checked and set before any await, so a double click cannot start two transfers.
      if ($page.variables.isSaving) {
        return;
      }
      $page.variables.isSaving = true;
      try {
        await this.transfer(context);
      } catch (e) {
        console.error('[createTransferChain] unexpected error', e);
        $page.variables.saveError = 'The transfer was interrupted (' + ((e && e.message) || e) + '). Check Recent transfers before trying again.';
      } finally {
        try { $page.variables.isSaving = false; } catch (e2) { /* page already left */ }
      }
    }

    async release(context, destId, batchNumber) {
      // Best effort, never throws: the transfer has already failed, and a failed clean-up must not hide that.
      // No X-User-Id: the endpoint does not declare it (same as the old confirm's releaseReservation).
      await call(context, {
        endpoint: 'eqp-v1/releaseReservation',
        uriParams: { requestId: Number(destId) },
        body: { batchNumber },
      });
    }

    async transfer(context) {
      const { $page, $application } = context;
      const v = $page.variables;
      const fns = $page.functions;
      const vars = $application.variables;
      const source = fns.findRequest(v.sourceRows, v.sourceId);
      const dest = fns.findRequest(v.destRows, v.destId);
      const state = {
        switchedOff: fns.switchedOff(vars.featureFlags, vars.flagsLoaded),
        source, dest,
        sourceLines: v.sourceLines, destLines: v.destLines, selected: v.selected,
        date: v.date, timesheets: v.timesheets, history: v.sourceHistory, sites: v.sites,
      };
      v.saveError = '';
      const problems = fns.problems(state);
      if (problems.length) {
        v.saveError = problems.join(' ');
        return;
      }
      const units = fns.selectedLines(v.sourceLines, v.selected);
      const { pairs } = fns.pair(units, v.destLines);
      const intent = fns.intent(source, dest, pairs, v.attempt);
      const destIds = intent.lineIds;
      const headers = cu.auditHeaders(context);

      // 1 plan
      const plan = await call(context, {
        endpoint: 'eqp-v1/planConfirm',
        uriParams: { requestId: Number(dest.id) },
        body: { lineIds: destIds, fallbackYardOrgId: null },
      });
      if (!plan.ok) {
        v.saveError = 'The destination site of ' + dest.number + ' could not be worked out (' + http(plan) + '). Nothing was changed.';
        return;
      }
      const blocks = fns.planBlocks(plan.body, destIds);
      if (blocks.length) {
        v.saveError = 'Not transferred: ' + blocks.join(' ');
        return;
      }
      const destSite = fns.destSite(plan.body, destIds);
      if (!destSite) {
        v.saveError = 'No site is mapped for ' + dest.number + ', so nothing was created. Check the business unit and org mapping in Configuration.';
        return;
      }

      // 2 reserve
      const batchNumber = fns.batchNumber(dest.number, Date.now());
      const resv = await call(context, {
        endpoint: 'eqp-v1/reserveConfirm',
        uriParams: { requestId: Number(dest.id) },
        headers,
        body: { lineIds: destIds, batchNumber, idempotencyKey: fns.idempotencyKey(intent), leg: 'OUTBOUND' },
      });
      if (resv.ok) {
        const b = resv.body || {};
        if (b.replayed === true) {
          v.done = { count: pairs.length, orderNumber: '', from: source.number, to: dest.number, replayed: true, historyError: '' };
          await this.reload(context, source.id, dest.id);
          return;
        }
        const rejected = (b.rejectedLineIds || []).length;
        if (rejected) {
          if ((b.reservedLineIds || []).length) {
            await this.release(context, dest.id, batchNumber);
          }
          v.saveError = (rejected === 1 ? '1 line' : rejected + ' lines') + ' of ' + dest.number
            + ' are being confirmed by someone else right now. Nothing was changed; try again in a few minutes.';
          return;
        }
      } else {
        console.warn('[createTransferChain] reserve not ok (' + http(resv) + ') — proceeding unreserved');
      }

      // 3 the transfer order
      const sourceOrgId = (v.sites || {})[String(units[0].lineId)];
      const f = {
        source, dest, batchNumber, destSite, sourceOrgId, date: v.date, comments: v.comments,
        subinventory: v.subinventory, locator: v.locator, actor: cu.auditActor(context),
      };
      const order = await call(context, { endpoint: 'eqp-v1/createTransferOrder', headers, body: fns.orderBody(f) });
      const orderId = order.ok && order.body ? order.body.id : null;
      if (orderId == null) {
        await this.release(context, dest.id, batchNumber);
        v.attempt = (Number(v.attempt) || 0) + 1;
        v.saveError = 'The transfer order could not be created (' + http(order) + '). Nothing was transferred.';
        return;
      }

      // 4 its lines
      for (let i = 0; i < pairs.length; i++) {
        const res = await call(context, {
          endpoint: 'eqp-v1/createTransferOrderLine',
          headers,
          body: fns.orderLineBody(orderId, pairs[i], i, fns.itemNumber(plan.body, pairs[i].dest.lineId)),
        });
        if (!res.ok) {
          await call(context, {
            endpoint: 'eqp-v1/patchTransferOrder',
            uriParams: { id: Number(orderId) },
            headers,
            body: { orderStatus: 'CANCELLED' },
          });
          await this.release(context, dest.id, batchNumber);
          v.attempt = (Number(v.attempt) || 0) + 1;
          v.saveError = 'The transfer order line for ' + fns.unitText(pairs[i].source) + ' could not be created (' + http(res)
            + '). The order ' + batchNumber + ' was cancelled; nothing was transferred.';
          return;
        }
      }

      // 5 history, on both requests
      let historyFailed = 0;
      for (const p of pairs) {
        const res = await call(context, { endpoint: 'eqp-v1/createTransferHistory', headers, body: fns.historyBody(f, p, orderId) });
        if (!res.ok) {
          historyFailed++;
        }
      }

      v.selected = {};
      v.attempt = 0;
      v.comments = '';
      v.done = {
        count: pairs.length,
        orderNumber: (order.body && order.body.orderNumber) || batchNumber,
        from: source.number,
        to: dest.number,
        replayed: false,
        historyError: historyFailed
          ? 'The transfer order is recorded, but the history entry of ' + (historyFailed === 1 ? '1 unit' : historyFailed + ' units') + ' was not saved.'
          : '',
      };
      await Actions.fireNotificationEvent(context, {
        summary: 'Transfer recorded',
        message: fns.moveText(pairs.length).replace('Transfer', 'Moving') + ' from ' + source.number + ' to ' + dest.number
          + ' (' + v.done.orderNumber + '), pending the inter-org transfer in Fusion.',
        type: historyFailed ? 'warning' : 'confirmation',
        displayMode: 'transient',
      });
      await this.reload(context, source.id, dest.id);
    }

    /**
     * Fresh history for both requests and the recent list (the new entries show at once, and a unit with a
     * pending transfer cannot be ticked again), and fresh lines for both (redrawn, so no box stays ticked).
     */
    async reload(context, sourceId, destId) {
      const { $page } = context;
      const v = $page.variables;
      const [src, dst, recent, srcLines, dstLines] = await Promise.all([
        call(context, { endpoint: 'eqp-v1/getTransferHistory', uriParams: { equipmentRequestId: Number(sourceId) } }),
        call(context, { endpoint: 'eqp-v1/getTransferHistory', uriParams: { equipmentRequestId: Number(destId) } }),
        call(context, { endpoint: 'eqp-v1/getTransferHistory', uriParams: {} }),
        call(context, { endpoint: 'eqp-v1/getEquipriteV1ViewsRequestDetailLines', uriParams: { requestId: Number(sourceId), size: 500 } }),
        call(context, { endpoint: 'eqp-v1/getEquipriteV1ViewsRequestDetailLines', uriParams: { requestId: Number(destId), size: 500 } }),
      ]);
      if (src.ok) {
        v.sourceHistory = rows(src);
      }
      if (dst.ok) {
        v.destHistory = rows(dst);
      }
      if (recent.ok) {
        v.recent = rows(recent);
      }
      if (srcLines.ok) {
        const number = $page.functions.requestNumber(v.sourceRows, sourceId);
        v.sourceLines = rows(srcLines).map((l) => Object.assign({}, l, { requestNumber: l.requestNumber || number }));
      }
      if (dstLines.ok) {
        v.destLines = rows(dstLines);
      }
    }
  }

  return createTransferChain;
});
