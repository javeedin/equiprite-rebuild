define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/transferList',
  'resources/js/shellBus',
], (ActionChain, Actions, list, bus) => {
  'use strict';

  // Loads one transfer. Reads only.
  //   the order          transfer-orders/{id} (or, given only its number, transfer-orders and the one with it)
  //   what is on it      transfer-order-lines?transferOrderId
  //   the names          inv-orgs
  //   where it is        views/request-detail-lines of its request (each unit's line status)
  //   inter-project      transfer-history?equipmentRequestId (an inter-project transfer on record without an order is
  //                      read from transfer-history alone)
  // Then the tab is named after it.
  async function get(context, endpoint, uriParams) {
    try {
      const res = await Actions.callRest(context, { endpoint, uriParams });
      if (!res || !res.ok) return { ok: false, status: res && res.status, body: null, rows: [] };
      return { ok: true, body: res.body, rows: list.rows(res.body) };
    } catch (e) {
      console.warn('[transfer loadRecordChain] ' + endpoint + ' failed', e);
      return { ok: false, status: 0, body: null, rows: [] };
    }
  }

  class loadRecordChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      v.isLoading = true;
      v.error = '';
      v.note = '';
      try {
        const id = Number(v.id) || 0;
        const number = String(v.number || '');
        let order = null;
        let toLines = null;
        let hist = [];
        const orgsCall = get(context, 'eqp-v1/getInvOrgs', { size: 500 });
        if (v.source === 'history') {
          // read from its history below
        } else if (id) {
          const [o, tl] = await Promise.all([
            get(context, 'eqp-v1/getTransferOrderById', { id }),
            get(context, 'eqp-v1/getTransferOrderLines', { transferOrderId: id }),
          ]);
          order = o.ok && o.body && o.body.id != null ? o.body : null;
          toLines = tl.ok ? tl.rows : null;
        } else if (number) {
          const all = await get(context, 'eqp-v1/getTransferOrders', {});
          order = all.rows.filter((x) => x && x.orderNumber === number)[0] || null;
          if (order) {
            const tl = await get(context, 'eqp-v1/getTransferOrderLines', { transferOrderId: Number(order.id) });
            toLines = tl.ok ? tl.rows : null;
          }
        }
        if (!order) {
          // An inter-project transfer on record without an order of its own.
          const h = await get(context, 'eqp-v1/getTransferHistory', {});
          hist = h.rows.filter((x) => x && ((id && Number(x.transferOrderId) === id) || (number && x.orderNumber === number)));
          order = list.historyOnly([], hist)[0] || null;
        }
        const orgs = await orgsCall;
        if (!order) {
          v.error = 'Transfer ' + (number || id || '') + ' was not found.';
          return;
        }
        const reqId = Number(order.equipmentRequestId) || 0;
        const [lines, history] = await Promise.all([
          reqId ? get(context, 'eqp-v1/getEquipriteV1ViewsRequestDetailLines', { requestId: reqId, size: 500 }) : Promise.resolve({ ok: false, rows: [] }),
          reqId ? get(context, 'eqp-v1/getTransferHistory', { equipmentRequestId: reqId }) : Promise.resolve({ ok: true, rows: [] }),
        ]);
        const mine = (h) => h && ((order.id != null && h.transferOrderId != null && Number(h.transferOrderId) === Number(order.id))
          || (order.orderNumber && h.orderNumber === order.orderNumber));
        // Each history row once, whichever call read it.
        const seen = {};
        const allHist = hist.concat(history.rows.filter(mine)).filter((h) => {
          const k = h.id != null ? 'id:' + h.id : JSON.stringify(h);
          if (seen[k]) return false;
          seen[k] = true;
          return true;
        });
        const first = lines.rows[0];
        const requests = {};
        if (reqId && first) requests[String(reqId)] = { number: first.requestNumber || '', party: first.projectName || first.customerName || '' };
        const ctx = {
          orgs: orgs.rows,
          requests,
          toLines: toLines ? { [String(order.id)]: toLines } : {},
          lines: lines.ok ? list.indexLines(lines.rows) : {},
          history: allHist,
          now: Date.now(),
        };
        const head = list.decorate(order, ctx);
        if (toLines && !lines.ok && reqId) v.note = 'Where each unit is could not be read (its request did not load); Refresh to try again.';
        if (!toLines && head.kind !== 'between') v.note = 'What is on this transfer could not be read; Refresh to try again.';
        v.head = head;
        v.units = head.units;
        v.historyRows = list.historyRows(allHist);
        bus.rename('transfer:' + (v.id || v.number), head.number);
      } catch (e) {
        console.error('[transfer loadRecordChain] failed', e);
        v.error = 'The transfer could not be loaded.';
      } finally {
        v.isLoading = false;
      }
    }
  }

  return loadRecordChain;
});
