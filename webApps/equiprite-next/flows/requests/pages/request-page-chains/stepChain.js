define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/exportKit',
  'resources/js/shellBus',
  'resources/js/requestData',
  'resources/js/confirmPicking',
  'resources/js/acceptDelivery',
], (ActionChain, Actions, exportKit, bus, requestData, confirmPicking, acceptDelivery) => {
  'use strict';

  // A step from the request's tab: the screen that takes it opens on this request (shellBus.focus), so the decision,
  // the units and the picking keep their own screens' rules and checks. Also: the history's view and its export.
  // Confirm for picking and Accept delivery are done here (confirmPicking, acceptDelivery), after asking once (ask).
  //   act: approve | assign (Approve & allocate) | pick (Picking & shipping) | ask (value: confirm | accept | '') | do (value)
  //        | help | tab (value) | export (value)
  class stepChain extends ActionChain {
    async run(context, { act, value }) {
      const v = context.$page.variables;
      const head = v.head || {};
      const what = { id: head.id ? Number(head.id) : undefined, number: head.requestNumber || '' };
      if (act === 'approve' || act === 'assign') { bus.focus('approvals', what); return; }
      if (act === 'pick') {
        bus.focus('picking', Object.assign({ confirm: (v.acts && v.acts.confirm) || 0, end: head.end || '',
          from: { label: what.number || 'the request', open: { record: 'request', params: { id: what.id, number: what.number } } } }, what));
        return;
      }
      if (act === 'ask') {
        if (v.stepBusy) return;
        v.ask = value === 'confirm' || value === 'accept' ? value : '';
        if (v.ask) v.stepResult = { tone: '', title: '', text: '' };
        return;
      }
      if (act === 'do') {
        if (v.stepBusy || (value !== 'confirm' && value !== 'accept')) return;
        const acts = v.acts || {};
        if (value === 'confirm' ? !acts.mayConfirm : !acts.mayAccept) return;
        v.stepBusy = value;
        let out;
        try {
          out = value === 'confirm'
            ? await confirmPicking.confirm(context, Actions, { requestId: Number(v.requestId || head.id), requestNumber: head.requestNumber, endDate: head.end })
            : await acceptDelivery.accept(context, Actions, { requestId: Number(v.requestId || head.id) });
        } catch (e) {
          console.error('[stepChain] ' + value + ' failed', e);
          out = { tone: 'error', title: value === 'confirm' ? 'Not confirmed' : 'Not accepted', text: 'Something went wrong (' + ((e && e.message) || e) + '). It is read again.', changed: true };
        } finally {
          v.stepBusy = '';
        }
        v.ask = '';
        v.stepResult = { tone: out.tone, title: out.title, text: out.text };
        if (out.changed) {
          requestData.invalidate();
          await Actions.callChain(context, { chain: 'loadRecordChain' });
        }
        return;
      }
      if (act === 'help') { bus.open({ navId: 'help' }); return; }
      if (act === 'tab') { v.histTab = value === 'activity' ? 'activity' : 'steps'; return; }
      if (act === 'export') {
        const h = v.history || {};
        const res = await exportKit.run(value, {
          name: 'history-' + (head.requestNumber || 'request'),
          title: (head.requestNumber || 'Request') + ': history',
          subtitle: [head.project || head.customer, v.p ? v.p.headline : ''].filter(Boolean).join(' · '),
          rows: h.events || [],
          columns: [
            { key: 'when', label: 'When' }, { key: 'title', label: 'What happened' }, { key: 'text', label: 'Details' },
            { key: 'who', label: 'Who' }, { key: 'source', label: 'Source', value: (r) => (r.recorded ? 'Recorded status change' : 'From its dates and transfer orders') },
          ],
        });
        bus.toast(res.message, res.ok ? 'info' : 'error');
      }
    }
  }

  return stepChain;
});
