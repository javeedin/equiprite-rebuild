define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The inspection queue. There is no line-grain "waiting for inspection" view, so it is built the way Initiate
  // picking and Receipt & returns build theirs (InitPickingQueueChain): workbench-requests by stage for the
  // requests in play (OUTBOUND: on the way out, INBOUND: on the way back), then each request's
  // views/request-detail-lines for line status, class, subclass and serial. Lines not waiting at any inspection
  // point are dropped here. With them comes the inspection matrix (conf-inspection-details): which class or
  // subclass is inspected at which point. When the matrix cannot be read every waiting line is listed.
  const MAX_REQUESTS = 60;
  const PARALLEL = 6;

  async function get(context, endpoint, uriParams) {
    try {
      const res = await Actions.callRest(context, { endpoint, uriParams });
      if (!res || !res.ok) {
        return { ok: false, status: res && res.status, rows: [] };
      }
      const b = res.body;
      return { ok: true, rows: Array.isArray(b) ? b : ((b && Array.isArray(b.data)) ? b.data : []) };
    } catch (e) {
      console.warn('[loadQueueChain] ' + endpoint + ' failed', e);
      return { ok: false, status: 0, rows: [] };
    }
  }

  class loadQueueChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      v.isLoading = true;
      v.loadError = '';
      v.matrixNote = '';
      v.truncatedNote = '';
      try {
        const [matrix, outbound, inbound] = await Promise.all([
          get(context, 'eqp-v1/getConfInspectionDetails', {}),
          get(context, 'eqp-v1/getEquipriteV1ViewsWorkbenchRequests', { stage: 'OUTBOUND', size: 1000 }),
          get(context, 'eqp-v1/getEquipriteV1ViewsWorkbenchRequests', { stage: 'INBOUND', size: 1000 }),
        ]);
        if (!outbound.ok && !inbound.ok) {
          v.lines = [];
          v.loadError = 'The equipment waiting for inspection could not be loaded (HTTP ' + (outbound.status || inbound.status || 0) + ').';
          return;
        }
        v.matrix = matrix.rows;
        if (!matrix.ok) {
          v.matrixNote = 'The inspection matrix could not be read, so every line waiting at a point is listed.';
          v.scope = 'all';
        } else if (!matrix.rows.length) {
          v.matrixNote = 'No class has an inspection point set in Configuration yet, so every line waiting at a point is listed.';
          v.scope = 'all';
        }

        const ids = [];
        outbound.rows.concat(inbound.rows).forEach((r) => {
          const id = r && r.eqrEquipmentRequestId;
          if (id != null && ids.indexOf(Number(id)) === -1) {
            ids.push(Number(id));
          }
        });
        if (ids.length > MAX_REQUESTS) {
          v.truncatedNote = 'Showing the lines of ' + MAX_REQUESTS + ' of ' + ids.length + ' requests in progress.';
        }
        const wanted = ids.slice(0, MAX_REQUESTS);
        const lines = [];
        let failed = 0;
        for (let i = 0; i < wanted.length; i += PARALLEL) {
          const batch = await Promise.all(wanted.slice(i, i + PARALLEL).map((id) =>
            get(context, 'eqp-v1/getEquipriteV1ViewsRequestDetailLines', { requestId: id, size: 500 })
              .then((r) => ({ id, r }))));
          batch.forEach(({ id, r }) => {
            if (!r.ok) {
              failed++;
              return;
            }
            r.rows.forEach((l) => {
              if (l && l.lineId != null && fns.isWaiting(l.lineStatus)) {
                lines.push(Object.assign({}, l, { requestId: l.requestId != null ? l.requestId : id }));
              }
            });
          });
        }
        if (failed) {
          v.loadError = failed === 1 ? 'The lines of 1 request could not be loaded.' : 'The lines of ' + failed + ' requests could not be loaded.';
        }
        v.lines = lines;
      } finally {
        v.isLoading = false;
      }
    }
  }

  return loadQueueChain;
});
