define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/approveAllocate',
  'resources/js/approvalQueue',
  'resources/js/requestData',
  'resources/js/requestHistory',
  'resources/js/requestList',
  'resources/js/requestProgress',
  'resources/js/exportKit',
  'resources/js/shellBus',
], (ActionChain, Actions, aa, queue, requestData, history, list, Progress, exportKit, bus) => {
  'use strict';

  // The popup on a request, from its row:
  //   approve   decide it here. The same calls as Approve & allocate's bulk decision for one request (New EquipRite's
  //             bulkDecideChain): its lines read live, then approve or send back every line still undecided, all or
  //             nothing (approveAllocate.decideRequest). Sending back needs a reason, which goes to the requester
  //             (approveAllocate.notifySentBack). Then the list is read again and the popup says what comes next, with
  //             the step to take it: assign units (Approve & allocate) or pick (Picking & shipping).
  //   history   the request from start to end (requestHistory): the milestones, when and by whom each was reached,
  //             and everything recorded; exportable.
  //   action: approve | history | close | askReject | back | doApprove | doReject | reasonText | assign | pick | record
  //           | timeline | tab | export
  class popChain extends ActionChain {
    async run(context, { action, id, number, value }) {
      const v = context.$page.variables;
      const pop = v.pop || { kind: '' };
      const set = (patch) => { v.pop = Object.assign({}, v.pop, patch); };

      if (action === 'close') { if (!pop.busy) v.pop = { kind: '' }; return; }
      if (action === 'reasonText') { set({ reason: String(value || ''), error: '' }); return; }
      if (action === 'askReject') { set({ step: 'reason', error: '' }); return; }
      if (action === 'back') { set({ step: 'ask', error: '' }); return; }
      if (action === 'tab') { set({ tab: value === 'activity' ? 'activity' : 'steps' }); return; }

      if (action === 'approve' || action === 'history') {
        const base = summaryOf(v, id, number);
        if (!base) return;
        if (action === 'approve') {
          v.pop = Object.assign(base, { kind: 'approve', step: 'ask', reason: '', error: '', result: null, busy: false });
          return;
        }
        await openHistory(context, base);
        return;
      }
      if (action === 'timeline') {
        const base = summaryOf(v, pop.id, pop.number);
        if (base) await openHistory(context, base);
        return;
      }
      if (action === 'record') {
        bus.open({ record: 'request', params: { id: Number(pop.id) || undefined, number: pop.number } });
        v.pop = { kind: '' };
        return;
      }
      if (action === 'assign' || action === 'pick') {
        bus.focus(action === 'assign' ? 'approvals' : 'picking', { id: Number(pop.id) || undefined, number: pop.number });
        v.pop = { kind: '' };
        return;
      }
      if (action === 'export') {
        const h = pop.h || {};
        const res = await exportKit.run(value, {
          name: 'history-' + pop.number,
          title: pop.number + ': history',
          subtitle: [pop.party, h.p ? h.p.headline : ''].filter(Boolean).join(' · '),
          rows: h.events || [],
          columns: [
            { key: 'when', label: 'When' }, { key: 'title', label: 'What happened' }, { key: 'text', label: 'Details' },
            { key: 'who', label: 'Who' }, { key: 'source', label: 'Source', value: (r) => (r.recorded ? 'Recorded status change' : 'From its dates and transfer orders') },
          ],
        });
        bus.toast(res.message, res.ok ? 'info' : 'error');
        return;
      }

      if (action === 'doApprove' || action === 'doReject') {
        if (pop.kind !== 'approve' || pop.busy) return;
        if (!v.can || !v.can.decide) {
          set({ error: 'Your role cannot approve or send back requests: that needs full access to Approve & allocate.' });
          return;
        }
        const reason = String(pop.reason || '').trim();
        if (action === 'doReject' && !reason) {
          set({ error: 'Write the reason first: ' + (pop.requestor || 'the requester') + ' gets it with the request.' });
          return;
        }
        set({ busy: true, step: 'busy', error: '', busyText: action === 'doApprove' ? 'Approving ' + pop.number + '…' : 'Sending ' + pop.number + ' back…' });
        let words;
        try {
          const out = await aa.decideRequest(context, Actions, action === 'doApprove' ? 'approve' : 'reject', Number(pop.id));
          if (out.skip) {
            words = { tone: 'warn', text: out.message };
          } else if (!out.ok) {
            words = { tone: 'error', text: 'Nothing was changed on ' + pop.number + ': ' + (out.message || 'the change was refused') + '.' };
          } else if (action === 'doApprove') {
            words = queue.approveWords(pop.number, out.result);
          } else {
            const head = await Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1EquipmentRequestById', uriParams: { id: Number(pop.id) } })
              .catch(() => null);
            const h = (head && head.ok && head.body) || {};
            const note = await aa.notifySentBack(context, Actions, { userId: h.requestorUserId, requestId: Number(pop.id), requestNumber: pop.number,
              reason, lines: out.result.updated, whole: out.result.requestRejected });
            words = queue.rejectWords(pop.number, out.result, note, h.requestorName || pop.requestor);
          }
        } catch (e) {
          console.error('[popChain] decide failed', e);
          words = { tone: 'error', text: 'Something went wrong; ' + pop.number + ' has been read again to show where it stands.' };
        }
        bus.toast(words.text, words.tone === 'error' ? 'error' : (words.tone === 'warn' ? 'warning' : 'info'));
        requestData.invalidate();
        await Actions.callChain(context, { chain: 'loadChain', params: { refresh: true } });
        const after = summaryOf(v, pop.id, pop.number) || {};
        v.pop = Object.assign({}, v.pop, after, { kind: 'approve', step: 'done', busy: false, busyText: '', result: words, reason: '' });
      }
    }
  }

  /** What the popup says about a request, from the list as loaded: its words, its equipment and its steps. */
  function summaryOf(v, id, number) {
    const row = (v.rows || []).filter((r) => (id && String(r.eqrEquipmentRequestId) === String(id)) || (number && r.requestNumber === number))[0];
    if (!row) return null;
    const lines = (v.linesByRequest || {})[row.requestNumber] || [];
    const item = list.decorate([row], v.linesByRequest, Date.now())[0];
    const kind = (queue.build([row], v.linesByRequest, {})[0] || {}).kind || '';
    const acts = list.actions(item, lines, kind, v.can);
    return {
      id: String(row.eqrEquipmentRequestId || ''),
      number: row.requestNumber,
      party: item.party,
      task: row.taskName || '',
      dates: item.dates,
      requestor: row.requestorName || row.contactName || '',
      external: item.external,
      status: String(row.status || row.requestStatus || '').toUpperCase(),
      headline: item.p.headline,
      tone: item.p.tone,
      next: item.p.next ? item.p.next.text : '',
      late: item.p.late.map((l) => l.text).join(' · '),
      waiting: lines.filter((l) => Progress.line(l.lineStatus, item.external).stage === 'approval').length,
      equipment: lines.map((l) => {
        const info = Progress.line(l.lineStatus, item.external);
        return { name: l.name, qty: l.qty, label: info.label, stage: info.stage || 'ready' };
      }),
      acts,
    };
  }

  /** Opens the history popup and reads the history (the list's own lines, so it matches the row). */
  async function openHistory(context, base) {
    const v = context.$page.variables;
    v.pop = Object.assign(base, { kind: 'history', tab: 'steps', h: { loading: true } });
    const h = await history.load(context, Actions, {
      id: base.id,
      head: { status: base.status, external: base.external, number: base.number, requestor: base.requestor },
      lines: (v.linesByRequest || {})[base.number],
    }).catch((e) => ({ error: 'The history could not be read: ' + ((e && e.message) || e) }));
    if (!v.pop || v.pop.kind !== 'history' || v.pop.number !== base.number) return;
    v.pop = Object.assign({}, v.pop, { h: Object.assign({ loading: false }, h) });
  }

  return popChain;
});
