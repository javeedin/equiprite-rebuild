define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestLineBody',
  'resources/js/currentUser'
], (ActionChain, Actions, lineBody, cu) => {
  'use strict';

  // Bulk approve / reject on To approve (FDD 7.11: across project and customer requests).
  //
  // The old app has no bulk action: the manager opens each request (main/equipment-request-detail) and approves or
  // rejects its lines. This runs THAT logic once per ticked request, request by request, acting on every line, as
  // the old chains do when every line is ticked:
  //   approve  confirmRequestChain  GET lines (allocation status) > PATCH lines/batch (IN_PROCESS, or ALLOCATED when
  //                                 already fully allocated) > PATCH header IN_PROCESS once every line is decided
  //   reject   rejectRequestChain   PATCH lines/batch REJECTED > PATCH header REJECTED once nothing is left live
  // Both chains are copied unchanged on Approve & allocate; tests/workbench.test.js checks that this chain sends what
  // they send. The lines each one acts on come from views/request-detail-lines, as Request detail's initChain loads
  // them. A request that fails is reported and the next one still runs (each request's batch is all or nothing).
  const APPROVE_TARGET = 'IN_PROCESS';
  const HEADER_READY_STATES = ['IN_PROCESS', 'ALLOCATED', 'REJECTED'];
  const CASCADABLE = [null, '', 'DRAFT', 'SUBMITTED', 'IN_PROCESS'];
  const REJECT_TARGET = 'REJECTED';
  const TERMINAL_STATES = ['REJECTED', 'CANCELLED', 'CLOSED', 'CONSUMED'];

  const isHeaderReady = (s) => HEADER_READY_STATES.indexOf(String(s || '').toUpperCase()) !== -1;
  const isTerminal = (s) => TERMINAL_STATES.indexOf(String(s || '').toUpperCase()) !== -1;

  /** The request's lines in the shape the old chains read (lineId, lineStatus, equipmentName), or null. */
  async function loadLines(context, numericId) {
    const res = await Actions.callRest(context, {
      endpoint: 'eqp-v1/getEquipriteV1ViewsRequestDetailLines',
      uriParams: { requestId: Number(numericId), size: 10000 }
    }).catch(() => null);
    if (!res || !res.ok || !res.body || !Array.isArray(res.body.data)) {
      return null;
    }
    return res.body.data.map((r, index) => ({
      lineId:        String(r.lineId !== undefined && r.lineId !== null ? r.lineId : index + 1),
      equipmentName: r.equipmentName || '',
      lineStatus:    r.lineStatus || ''
    }));
  }

  /** confirmRequestChain with every line in the pool. */
  async function approve(context, numericId, allLines) {
    const targets = allLines.filter(l => CASCADABLE.indexOf(l.lineStatus) !== -1);
    const skipped = allLines.length - targets.length;
    if (targets.length === 0) {
      return { skip: true, message: 'No line on this request can be approved.' };
    }
    const allocById = {};
    try {
      const allocResult = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2',
        uriParams: { requestId: numericId, size: 2000 }
      });
      if (allocResult && allocResult.ok && allocResult.body && Array.isArray(allocResult.body.data)) {
        allocResult.body.data.forEach(r => {
          allocById[String(r.id)] = r.allocationStatus;
        });
      } else {
        console.warn('[bulkDecideChain] allocationStatus lookup non-OK:', allocResult && allocResult.status, '- defaulting to IN_PROCESS');
      }
    } catch (e) {
      console.warn('[bulkDecideChain] allocationStatus lookup failed:', e, '- defaulting to IN_PROCESS');
    }
    const updates = targets.map(l => ({
      id: Number(l.lineId),
      lineStatus: (allocById[String(l.lineId)] === 'ALLOCATED') ? 'ALLOCATED' : APPROVE_TARGET
    }));
    const batch = await lineBody.updateLines(context, Actions, {
      requestId: numericId,
      headers:   cu.auditHeaders(context),
      updates:   updates,
      labels:    targets.map(l => l.equipmentName)
    });
    if (!batch.ok) {
      return { ok: false, message: batch.message + ' No line was changed.' };
    }
    const approvedStates = {};
    updates.forEach(u => { approvedStates[String(u.id)] = u.lineStatus; });
    let headerMoved = false;
    const everyLineReady = allLines.length > 0 && allLines.every(l => isHeaderReady(approvedStates[String(l.lineId)] || l.lineStatus));
    if (everyLineReady) {
      const headerResult = await Actions.callRest(context, {
        endpoint: 'eqp-v1/patchEquipmentRequest',
        uriParams: { id: numericId },
        body: { status: APPROVE_TARGET }
      }).catch(e => ({ ok: false, error: e }));
      headerMoved = !!(headerResult && headerResult.ok);
      if (!headerMoved) {
        console.warn('[bulkDecideChain] header PATCH failed:', headerResult && headerResult.status);
      }
    }
    return {
      ok: true,
      message: updates.length + ' line(s) approved' + (skipped ? ', ' + skipped + ' already settled' : '')
        + (headerMoved ? '; moved to In process.' : '; the request stays Submitted.')
    };
  }

  /** rejectRequestChain with every line in the pool. */
  async function reject(context, numericId, allLines) {
    const eligible = allLines.filter(l => !isTerminal(l.lineStatus));
    const skipped = allLines.length - eligible.length;
    if (eligible.length === 0) {
      return { skip: true, message: 'No line on this request can be rejected.' };
    }
    const batch = await lineBody.updateLines(context, Actions, {
      requestId: numericId,
      headers:   cu.auditHeaders(context),
      updates:   eligible.map(l => ({ id: Number(l.lineId), lineStatus: REJECT_TARGET })),
      labels:    eligible.map(l => l.equipmentName)
    });
    if (!batch.ok) {
      return { ok: false, message: batch.message + ' No line was changed.' };
    }
    const rejectedIds = {};
    eligible.forEach(l => { rejectedIds[String(l.lineId)] = true; });
    let requestRejected = false;
    const anyLive = allLines.some(l => !rejectedIds[String(l.lineId)] && !isTerminal(l.lineStatus));
    if (!anyLive && allLines.length > 0) {
      const headerResult = await Actions.callRest(context, {
        endpoint: 'eqp-v1/patchEquipmentRequest',
        uriParams: { id: numericId },
        body: { status: REJECT_TARGET }
      }).catch(e => ({ ok: false, error: e }));
      requestRejected = !!(headerResult && headerResult.ok);
      if (!requestRejected) {
        console.warn('[bulkDecideChain] header PATCH failed', headerResult && headerResult.status);
      }
    }
    return {
      ok: true,
      message: eligible.length + ' line(s) rejected' + (skipped ? ', ' + skipped + ' already settled' : '')
        + (requestRejected ? '; the request was rejected.' : '.')
    };
  }

  class bulkDecideChain extends ActionChain {
    /**
     * @param {Object} params
     * @param {string} params.action approve | reject | askReject | cancelReject
     */
    async run(context, { action }) {
      const { $page } = context;
      const v = $page.variables;

      if (action === 'askReject' || action === 'cancelReject') {
        await Actions.callComponentMethod(context, {
          selector: '#bulkRejectDialog',
          method:   action === 'askReject' ? 'open' : 'close'
        });
        return;
      }
      if (action !== 'approve' && action !== 'reject') {
        return;
      }
      if (action === 'reject') {
        await Actions.callComponentMethod(context, { selector: '#bulkRejectDialog', method: 'close' });
      }
      if (v.bulkBusy || v.isReadOnly) {
        return;
      }
      const ids = ((v.selection && v.selection.ids) || []).map(String);
      const rows = ((v.buckets && v.buckets.approve) || []).filter(r => ids.indexOf(String(r.request_id)) !== -1);
      if (!rows.length) {
        return;
      }

      const verb = action === 'approve' ? 'Approving' : 'Rejecting';
      const done = [];
      const failed = [];
      const skipped = [];
      v.bulkBusy = true;
      v.bulkResult = null;
      try {
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const numericId = Number(row.request_id);
          v.bulkProgress = verb + ' ' + (i + 1) + ' of ' + rows.length + ': ' + row.request_number + '…';
          const lines = await loadLines(context, numericId);
          if (!lines || !lines.length) {
            failed.push({ number: row.request_number, message: 'Its lines could not be loaded; nothing was changed.' });
            continue;
          }
          let out;
          try {
            out = action === 'approve' ? await approve(context, numericId, lines) : await reject(context, numericId, lines);
          } catch (e) {
            out = { ok: false, message: String((e && e.message) || e) };
          }
          const entry = { number: row.request_number, message: out.message };
          if (out.skip) {
            skipped.push(entry);
          } else if (out.ok) {
            done.push(entry);
          } else {
            failed.push(entry);
          }
        }
      } finally {
        v.bulkBusy = false;
        v.bulkProgress = '';
      }

      const past = action === 'approve' ? 'approved' : 'rejected';
      v.bulkResult = {
        action: action,
        title: done.length + ' of ' + rows.length + ' ' + (rows.length === 1 ? 'request' : 'requests') + ' ' + past,
        done: done,
        failed: failed,
        skipped: skipped
      };
      await Actions.fireNotificationEvent(context, {
        summary: failed.length ? (action === 'approve' ? 'Approve finished with errors' : 'Reject finished with errors')
          : (action === 'approve' ? 'Requests approved' : 'Requests rejected'),
        message: v.bulkResult.title + (failed.length ? '; ' + failed.length + ' failed.' : '.'),
        displayMode: failed.length ? 'persist' : 'transient',
        type: failed.length ? 'error' : (action === 'approve' ? 'confirmation' : 'info')
      });
      v.selectedIds = [];
      await Actions.callChain(context, { chain: 'loadWorkbenchChain' });
    }
  }

  return bulkDecideChain;
});
