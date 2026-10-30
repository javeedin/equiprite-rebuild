define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/approveAllocate',
  'resources/js/approvalQueue',
  'resources/js/requestData',
  'resources/js/shellBus',
], (ActionChain, Actions, aa, queue, requestData, bus) => {
  'use strict';

  // Approve or send back the ticked requests (FDD 7.11: across project and customer requests). New EquipRite's
  // bulkDecideChain, request by request: each request's lines (views/request-detail-lines), then the approve or
  // reject of Approve & allocate with every line in the pool (approveAllocate.decideRequest). One request failing is
  // reported and the next still runs; each request's lines change all together or not at all.
  // Sending back asks for a reason first; once a request is sent back its requester gets the reason
  // (approveAllocate.notifySentBack, with the requester read from the request).
  //   action: approve | askReject | cancel | reject
  class bulkChain extends ActionChain {
    async run(context, { action }) {
      const v = context.$page.variables;
      if (action === 'askReject') { v.bulk = { mode: 'reject', reason: (v.bulk && v.bulk.reason) || '', error: '' }; return; }
      if (action === 'cancel') { v.bulk = { mode: '', reason: '', error: '' }; return; }
      if (action !== 'approve' && action !== 'reject') return;
      if (v.busy || !v.canAct) return;
      const ids = (v.selection && v.selection.ids) || [];
      const rows = (v.items || []).filter((r) => r.kind === 'decide' && ids.indexOf(r.key) !== -1);
      if (!rows.length) return;
      const reason = String((v.bulk && v.bulk.reason) || '').trim();
      if (action === 'reject' && !reason) {
        v.bulk = Object.assign({}, v.bulk, { error: 'Write the reason first: each requester gets it with their request.' });
        return;
      }

      const verb = action === 'approve' ? 'Approving' : 'Sending back';
      const done = [];
      const failed = [];
      const skipped = [];
      const touched = [];
      v.busy = true;
      v.busyWhere = 'bulk';
      v.bulkResult = null;
      try {
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          v.busyText = verb + ' ' + (i + 1) + ' of ' + rows.length + ': ' + row.number + '…';
          const out = await aa.decideRequest(context, Actions, action, row.id);
          if (out.skip) {
            skipped.push({ number: row.number, text: out.message });
            continue;
          }
          if (!out.ok) {
            failed.push({ number: row.number, text: out.message });
            continue;
          }
          touched.push(row.key);
          if (action === 'approve') {
            done.push({ number: row.number, text: queue.approveWords(row.number, out.result).text });
          } else {
            const head = await Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1EquipmentRequestById', uriParams: { id: row.id } })
              .catch(() => null);
            const h = (head && head.ok && head.body) || {};
            const who = h.requestorName || row.requestor || '';
            const note = await aa.notifySentBack(context, Actions, { userId: h.requestorUserId, requestId: row.id, requestNumber: row.number,
              reason, lines: out.result.updated, whole: out.result.requestRejected });
            done.push({ number: row.number, text: queue.rejectWords(row.number, out.result, note, who).text });
          }
        }
      } finally {
        v.busy = false;
        v.busyText = '';
      }
      v.bulkResult = queue.bulkWords(action, rows.length, done, failed, skipped);
      bus.toast(v.bulkResult.title + '.', failed.length ? 'error' : 'info');
      v.selectedIds = [];
      v.bulk = { mode: '', reason: '', error: '' };
      requestData.invalidate();
      await Actions.callChain(context, { chain: 'loadChain', params: { refresh: true } });
      if (v.current && touched.indexOf(v.current.key) !== -1) {
        await Actions.callChain(context, { chain: 'recordChain', params: {} });
      }
    }
  }

  return bulkChain;
});
