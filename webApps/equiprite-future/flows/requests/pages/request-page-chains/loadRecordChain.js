define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestData',
  'resources/js/requestProgress',
  'resources/js/requestHistory',
  'resources/js/requestList',
  'resources/js/approvalQueue',
  'resources/js/rules',
  'resources/js/shellBus',
], (ActionChain, Actions, requestData, Progress, history, list, queue, rules, bus) => {
  'use strict';

  // Loads one request: its id from the tab (or, given only a number, from the requests list), then its lines
  // (views/request-detail-lines, enriched, one row per line, the request's own fields on each) and its header
  // (equipment-requests/{id}, for the customer, contract and requestor). Then the tab is named after it, the steps it
  // offers this user are worked out (as on its row in Requests: approve, assign units, pick; by page access), and its
  // history is read (requestHistory; reads only) while the request already shows.
  class loadRecordChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;
      v.isLoading = true;
      v.error = '';
      try {
        let id = Number(v.id) || 0;
        let fromList = null;
        if (!id && v.number) {
          const data = await requestData.load(context, Actions, {});
          fromList = (data.rows || []).filter((r) => String(r.requestNumber).toUpperCase() === String(v.number).toUpperCase())[0] || null;
          id = fromList ? Number(fromList.eqrEquipmentRequestId) || 0 : 0;
        }
        if (!id) {
          v.error = 'Request ' + (v.number || '') + ' was not found among the requests you can see.';
          return;
        }
        v.requestId = id;
        const [linesRes, headRes] = await Promise.all([
          Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1ViewsRequestDetailLines', uriParams: { requestId: id, page: 0, size: 500 } }),
          Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1EquipmentRequestById', uriParams: { id } }).catch(() => null),
        ]);
        if (!linesRes || !linesRes.ok) {
          v.error = 'The request could not be loaded (HTTP ' + (linesRes && linesRes.status) + ').';
          return;
        }
        const rows = (linesRes.body && Array.isArray(linesRes.body.data)) ? linesRes.body.data : [];
        const header = (headRes && headRes.ok && headRes.body) || {};
        const first = rows[0] || fromList || {};
        const status = String(first.requestStatus || header.status || (fromList && fromList.status) || '').toUpperCase();
        const external = rules.isExternalSource(header.requestType || first.source || (fromList && fromList.requestOrigin)) || !!header.eqrCustomerRefId;
        const lines = rows.map((r) => requestData.lineOf(r, first.requestNumber));
        const head = {
          id,
          requestNumber: first.requestNumber || header.requestNumber || v.number || String(id),
          status,
          external,
          project: first.projectName || header.projectName || '',
          task: first.taskName || header.taskName || '',
          customer: header.customerName || header.projectInternalCustomer || '',
          contract: header.contractNumber || '',
          requestor: first.requestorName || header.requestorName || '',
          location: first.deploymentLocation || header.attribute1 || '',
          start: String(first.requestedStartDate || header.requestedStartDate || '').slice(0, 10),
          end: String(first.requestedEndDate || header.requestedEndDate || '').slice(0, 10),
          estCost: first.totalEstCost != null ? Number(first.totalEstCost) : null,
        };
        v.head = head;
        v.lines = lines.map((l) => Object.assign({}, l, { unit: l.serial || ({ ALLOCATED: 'Unit assigned', PENDING: 'No unit assigned yet', UNALLOCATED: 'No unit assigned yet' }[l.allocation] || '—') }));
        v.p = Progress.summarize(status, lines, { start: head.start, end: head.end, external });
        bus.rename('request:' + (v.id || v.number), head.requestNumber);
        const app = context.$application.variables;
        const workbench = rules.pageAccess(app.pageAccessMap, app.pageAccessLoaded, 'EQR_WORKBENCH');
        const picking = rules.pageAccess(app.pageAccessMap, app.pageAccessLoaded, 'EQR_INITIATE_PICKING');
        const row = { requestNumber: head.requestNumber, status, eqrEquipmentRequestId: id, requestOrigin: external ? 'External' : 'Internal' };
        const kind = (queue.build([row], { [head.requestNumber]: lines }, {})[0] || {}).kind || '';
        v.acts = list.actions(row, lines, kind, { decide: workbench === 'FULL', assign: workbench !== 'HIDDEN', pick: picking !== 'HIDDEN' });
        v.history = { loading: true };
        history.load(context, Actions, { id, head: { status, external, number: head.requestNumber, requestor: head.requestor, start: head.start, end: head.end,
          createdDate: header.createdDate || '' }, lines })
          .then((h) => { v.history = Object.assign({ loading: false }, h); })
          .catch((e) => { v.history = { loading: false, error: 'Its history could not be read: ' + ((e && e.message) || e) }; });
      } catch (e) {
        console.error('[loadRecordChain] failed', e);
        v.error = 'The request could not be loaded.';
      } finally {
        v.isLoading = false;
      }
    }
  }

  return loadRecordChain;
});
