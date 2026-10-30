define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestData',
  'resources/js/transferList',
], (ActionChain, Actions, requestData, list) => {
  'use strict';

  // Loads the transfers. Reads only.
  //   1 side by side: transfer-orders (all), transfer-history (all: the inter-project transfers), inv-orgs (the names of
  //     yards and sites), and the requests (views/my-requests, shared with the other tabs for half a minute)
  //     -> the list shows at once, each order with its stored dates
  //   2 then, for the newest open orders (at most MAX), what is on them and where it is: transfer-order-lines per order
  //     and views/request-detail-lines per request (the pair New EquipRite's picking drawer reads), a few at a time
  // A token keeps a slow answer from an earlier load (Refresh) from landing on a newer one.
  const MAX = 60;
  const PARALLEL = 6;

  async function get(context, endpoint, uriParams) {
    try {
      const res = await Actions.callRest(context, { endpoint, uriParams });
      if (!res || !res.ok) return { ok: false, status: res && res.status, rows: [] };
      return { ok: true, rows: list.rows(res.body) };
    } catch (e) {
      console.warn('[transfers loadChain] ' + endpoint + ' failed', e);
      return { ok: false, status: 0, rows: [] };
    }
  }

  class loadChain extends ActionChain {
    async run(context, { refresh }) {
      const v = context.$page.variables;
      const token = (Number(v.loadToken) || 0) + 1;
      v.loadToken = token;
      v.isLoading = true;
      v.error = '';
      v.note = '';
      let orders;
      try {
        const [o, history, orgs, reqData] = await Promise.all([
          get(context, 'eqp-v1/getTransferOrders', {}),
          get(context, 'eqp-v1/getTransferHistory', {}),
          get(context, 'eqp-v1/getInvOrgs', { size: 500 }),
          requestData.load(context, Actions, { refresh: !!refresh }),
        ]);
        if (v.loadToken !== token) return;
        orders = o;
        const failed = [];
        if (!o.ok) failed.push('the transfer orders (HTTP ' + (o.status || 0) + ')');
        if (!history.ok) failed.push('the inter-project transfers (HTTP ' + (history.status || 0) + ')');
        v.error = failed.length ? 'Could not load ' + failed.join(' or ') + '.' : '';
        v.orders = o.rows;
        v.history = history.rows;
        v.orgs = orgs.rows;
        v.requests = list.indexRequests(reqData.rows);
        v.toLines = {};
        v.lines = {};
      } finally {
        if (v.loadToken === token) v.isLoading = false;
      }
      await Actions.callChain(context, { chain: 'applyChain' });
      if (!orders || !orders.ok) return;

      const pick = list.toRead(orders.rows, MAX + 1);
      if (pick.length > MAX) {
        v.note = 'Where the equipment is was read for the newest ' + MAX + ' open transfers; older ones show their stored dates. Open one to read it.';
      }
      const wanted = pick.slice(0, MAX);
      if (!wanted.length) return;
      v.detailLoading = true;
      try {
        const toLines = {};
        let failed = 0;
        for (let i = 0; i < wanted.length; i += PARALLEL) {
          const batch = await Promise.all(wanted.slice(i, i + PARALLEL).map((ord) =>
            get(context, 'eqp-v1/getTransferOrderLines', { transferOrderId: Number(ord.id) }).then((r) => ({ ord, r }))));
          batch.forEach(({ ord, r }) => {
            if (r.ok) toLines[String(ord.id)] = r.rows;
            else failed++;
          });
        }
        const reqIds = [];
        wanted.forEach((ord) => {
          const id = Number(ord.equipmentRequestId);
          if (id && toLines[String(ord.id)] && reqIds.indexOf(id) === -1) reqIds.push(id);
        });
        const lineRows = [];
        const requests = Object.assign({}, v.requests || {});
        for (let i = 0; i < reqIds.length; i += PARALLEL) {
          const batch = await Promise.all(reqIds.slice(i, i + PARALLEL).map((id) =>
            get(context, 'eqp-v1/getEquipriteV1ViewsRequestDetailLines', { requestId: id, size: 500 }).then((r) => ({ id, r }))));
          batch.forEach(({ id, r }) => {
            if (!r.ok) { failed++; return; }
            r.rows.forEach((l) => lineRows.push(l));
            const first = r.rows[0];
            if (first && !requests[String(id)]) requests[String(id)] = { number: first.requestNumber || '', party: first.projectName || first.customerName || '' };
          });
        }
        if (v.loadToken !== token) return;
        if (failed) {
          v.note = [v.note, 'What is on ' + (failed === 1 ? '1 transfer' : failed + ' transfers') + ' could not be read; open one to try again.'].filter(Boolean).join(' ');
        }
        v.requests = requests;
        v.lines = list.indexLines(lineRows);
        v.toLines = toLines;
      } finally {
        if (v.loadToken === token) v.detailLoading = false;
      }
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return loadChain;
});
