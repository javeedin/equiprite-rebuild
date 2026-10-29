define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Picks (or, with an empty id, clears) the From or the To request and loads what the checks need.
  //   From: its lines (views/request-detail-lines), its transfer history, its submitted / draft timesheets
  //         (views/timesheet-details, only with TIMESHEETS_ENABLED) and the site each unit is at: the
  //         destination of the outbound transfer order that carried it (transfer-orders by request, then
  //         transfer-order-lines by order, the pair the old picking drawer reads). Clearing From clears To.
  //   To:   its lines and its transfer history.
  // A token per side guards against a slow answer for a request the user has already changed.
  async function get(context, endpoint, uriParams) {
    try {
      const res = await Actions.callRest(context, { endpoint, uriParams });
      if (!res || !res.ok) {
        return { ok: false, status: res && res.status, rows: [] };
      }
      const b = res.body;
      return { ok: true, rows: Array.isArray(b) ? b : ((b && Array.isArray(b.data)) ? b.data : []) };
    } catch (e) {
      console.warn('[pickRequestChain] ' + endpoint + ' failed', e);
      return { ok: false, status: 0, rows: [] };
    }
  }

  class pickRequestChain extends ActionChain {
    async run(context, { side, id }) {
      const { $page, $application } = context;
      const v = $page.variables;
      const fns = $page.functions;
      v.saveError = '';
      if (side === 'dest') {
        await this.dest(context, id);
        return;
      }
      if (side !== 'source') {
        return;
      }
      v.done = null;
      v.selected = {};
      v.sites = {};
      v.sourceLines = [];
      v.timesheets = [];
      v.sourceHistory = [];
      v.sourceError = '';
      v.attempt = 0;
      v.sourceQuery = '';
      await this.dest(context, '');
      const token = (Number(v.sourceToken) || 0) + 1;
      v.sourceToken = token;
      v.sourceId = id ? Number(id) : null;
      if (!id) {
        v.sourceLoading = false;
        return;
      }
      const req = fns.findRequest(v.sourceRows, id);
      const number = req ? req.number : '';
      const vars = $application.variables;
      const withTimesheets = !!$application.functions.isFeatureEnabled(vars.featureFlags, vars.flagsLoaded, 'TIMESHEETS_ENABLED');
      v.sourceLoading = true;
      try {
        const [lines, history, orders, sheets] = await Promise.all([
          get(context, 'eqp-v1/getEquipriteV1ViewsRequestDetailLines', { requestId: Number(id), size: 500 }),
          get(context, 'eqp-v1/getTransferHistory', { equipmentRequestId: Number(id) }),
          get(context, 'eqp-v1/getTransferOrders', { equipmentRequestId: Number(id) }),
          withTimesheets && number
            ? get(context, 'eqp-v1/getEquipriteV1ViewsTimesheetDetails', { requestNumber: number, size: 500 })
            : Promise.resolve({ ok: true, rows: [] }),
        ]);
        if (v.sourceToken !== token) {
          return;
        }
        if (!lines.ok) {
          v.sourceError = 'The equipment on ' + (number || 'this request') + ' could not be loaded (HTTP ' + (lines.status || 0) + ').';
          return;
        }
        v.sourceLines = lines.rows.map((l) => Object.assign({}, l, { requestNumber: l.requestNumber || number }));
        v.sourceHistory = history.rows;
        v.timesheets = sheets.rows;
        if (!sheets.ok) {
          v.sourceError = 'The timesheets of ' + number + ' could not be checked; try again before transferring.';
        }

        // Where each unit is: newest outbound (or earlier inter-project) order first; the first order that lists
        // the line wins. Inbound orders are the way back to the yard and are skipped.
        const sites = {};
        const legs = orders.rows
          .filter((o) => o && o.id != null && String(o.orderType || '').toUpperCase() !== 'INBOUND')
          .sort((a, b) => String(b.createdDate || '').localeCompare(String(a.createdDate || '')) || (Number(b.id) - Number(a.id)));
        for (const o of legs) {
          const tol = await get(context, 'eqp-v1/getTransferOrderLines', { transferOrderId: Number(o.id) });
          tol.rows.forEach((tl) => {
            const k = tl && tl.requestLineId != null ? String(tl.requestLineId) : '';
            if (k && sites[k] === undefined && o.destinationOrgId != null) {
              sites[k] = Number(o.destinationOrgId);
            }
          });
        }
        if (v.sourceToken === token) {
          v.sites = sites;
        }
      } finally {
        if (v.sourceToken === token) {
          v.sourceLoading = false;
        }
      }
    }

    async dest(context, id) {
      const { $page } = context;
      const v = $page.variables;
      const token = (Number(v.destToken) || 0) + 1;
      v.destToken = token;
      v.destId = id ? Number(id) : null;
      v.destLines = [];
      v.destHistory = [];
      v.destError = '';
      v.destQuery = '';
      if (!id) {
        v.destLoading = false;
        return;
      }
      v.destLoading = true;
      try {
        const [lines, history] = await Promise.all([
          get(context, 'eqp-v1/getEquipriteV1ViewsRequestDetailLines', { requestId: Number(id), size: 500 }),
          get(context, 'eqp-v1/getTransferHistory', { equipmentRequestId: Number(id) }),
        ]);
        if (v.destToken !== token) {
          return;
        }
        if (!lines.ok) {
          v.destError = 'The lines of the destination request could not be loaded (HTTP ' + (lines.status || 0) + ').';
          return;
        }
        v.destLines = lines.rows;
        v.destHistory = history.rows;
      } finally {
        if (v.destToken === token) {
          v.destLoading = false;
        }
      }
    }
  }

  return pickRequestChain;
});
