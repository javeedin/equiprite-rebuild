define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestEdit',
  'resources/js/requestData',
  'resources/js/shellBus',
], (ActionChain, Actions, requestEdit, requestData, bus) => {
  'use strict';

  // Edit request (the page head's button; Redwood: the header's action), until anyone decides the request: add
  // equipment, or remove a line (asked first). Each change is saved at once, written to the audit trail and so to the
  // History (requestEdit), then the request is read again.
  //   open | close        the edit panel
  //   query               what is typed in Add equipment (value)
  //   pick                the equipment picked in its list (value: master id)
  //   qty                 how many (value)
  //   add                 adds the picked equipment
  //   ask | keep | remove  remove a line (value: its line id): asked, kept, or removed
  class editChain extends ActionChain {
    async run(context, { act, value }) {
      const v = context.$page.variables;
      const e = JSON.parse(JSON.stringify(v.edit || {}));
      const set = (o) => { v.edit = Object.assign({}, e, o); };
      if (act === 'open') {
        if (!v.editCan) return;
        set({ on: true, query: '', pick: '', qty: 1, ask: '', note: '', tone: '' });
        if (!(v.editCatalog || []).length) {
          const c = await requestEdit.loadCatalog(context, Actions, v.head);
          v.editCatalog = c.rows;
          if (!c.ok) v.edit = Object.assign({}, JSON.parse(JSON.stringify(v.edit)), { note: c.message, tone: 'error' });
        }
        return;
      }
      if (act === 'close') { set({ on: false, ask: '', note: '', tone: '' }); return; }
      if (act === 'query') { set({ query: String(value || ''), pick: '' }); return; }
      if (act === 'pick') { set({ pick: String(value || '') }); return; }
      if (act === 'qty') { set({ qty: Math.max(1, Math.floor(Number(value) || 1)) }); return; }
      if (act === 'ask') { set({ ask: String(value || ''), note: '', tone: '' }); return; }
      if (act === 'keep') { set({ ask: '' }); return; }
      if (e.busy) return;
      let out = null;
      const head = JSON.parse(JSON.stringify(v.head || {}));
      const lines = JSON.parse(JSON.stringify(v.lines || []));
      if (act === 'add') {
        const row = (v.editCatalog || []).filter((r) => String(r.eqrEquipmentMasterId != null ? r.eqrEquipmentMasterId : r.equipmentId) === String(e.pick))[0];
        set({ busy: true, note: '', tone: '' });
        out = await requestEdit.addLine(context, Actions, { head, row: row ? JSON.parse(JSON.stringify(row)) : null, qty: e.qty });
      } else if (act === 'remove') {
        const line = lines.filter((l) => String(l.lineId) === String(value || e.ask))[0];
        set({ busy: true, note: '', tone: '' });
        out = await requestEdit.removeLine(context, Actions, { head, line, lines });
      } else {
        return;
      }
      const said = { busy: false, ask: '', note: out.message, tone: out.ok ? 'ok' : 'error' };
      v.edit = Object.assign({}, e, said, out.ok && act === 'add' ? { query: '', pick: '', qty: 1 } : {});
      if (out.ok) {
        bus.toast(out.message, 'info');
        requestData.invalidate();
        await Actions.callChain(context, { chain: 'loadRecordChain' });
        // Still editable after the change (it is, until someone decides it): the panel stays open with what was done.
        v.edit = Object.assign({}, JSON.parse(JSON.stringify(v.edit)), said, { on: !!v.editCan, query: '', pick: '', qty: 1 });
      }
    }
  }

  return editChain;
});
