define(['vb/action/actionChain', 'resources/js/future/fxPage', 'resources/js/future/fxReturn', 'resources/js/shellBus'], (ActionChain, fx, fxReturn, bus) => {
  'use strict';

  const CLOSED = { open: false, mode: 'return', requestId: '', lineId: '', kicker: '', title: '', sub: '', datesText: '', early: false, date: '', minDate: '', dateNote: '', rows: [],
    canApprove: false, approveLabel: '', waitText: '', rangeText: '', weekendText: '', plannedText: '', returnedText: '', rental: false, sheetTitle: 'The final timesheet', ruleText: '',
    notYetText: '', planText: '', emptyText: '', hasActual: false, actualCount: 0, plannedCount: 0 };

  /** A plain copy of a page variable (the dialog's definition and draft go to fxReturn and the engine as plain data). */
  function plain(x) { return JSON.parse(JSON.stringify(x || {})); }

  /** Native inputs keep what was typed: when the draft changes them (Fill standard hours), set them too. */
  function setInputs(list) {
    const apply = () => (list || []).forEach((x) => { const el = document.getElementById(x.id); if (el && el.value !== x.value) el.value = x.value; });
    apply();
    setTimeout(apply, 0);
  }

  // The Return dialog (fxReturn), op:
  //   open     data-request-id, data-line-id: the request's end (or today, or the planned date) as the return date,
  //            the timesheet from the hire's start prefilled (the days after today planned, with standard hours)
  //   date     a return date picked: the rows follow it (by the hour to the return day, by the day to the day before;
  //            planned after today), the values typed stay
  //   hours    a day's hours of use or standby typed (data-kind, data-date): the bill follows; the rows stay (focus)
  //   approve  "These hours are agreed" ticked or not
  //   fill     Fill standard hours: 8 h of use on each empty working day
  //   confirm  the actual days of the timesheet (logHoursBulk, approved when ticked), then the return (offHire; a later
  //            date books it): one toast. The planned days are an estimate and never sent.
  //   close    closes it, nothing done
  class returnChain extends ActionChain {
    async run(context, { op, data, value, kind, date, checked }) {
      const $v = context.$page.variables;
      const s = fx.store.get();
      $v.exportOpen = '';
      if (op === 'close') {
        $v.retError = '';
        $v.retDef = Object.assign({}, CLOSED);
        return;
      }
      if (op === 'open') {
        const d = data || {};
        const o = fxReturn.open(s, { requestId: d.requestId, lineId: d.lineId });
        $v.askDef = { open: false, kind: '', ids: {}, kicker: '', title: '', sub: '', confirm: '', tone: 'primary', fields: [] };
        $v.retError = '';
        $v.ret = o.draft;
        $v.retView = fxReturn.preview(s, o.def, o.draft);
        $v.retDef = o.def;
        return;
      }
      if (!$v.retDef || !$v.retDef.open) return;
      const def = plain($v.retDef);
      let draft = plain($v.ret);
      $v.retError = '';
      if (op === 'date') {
        draft.date = String(value || '');
        const nd = fxReturn.def(s, { requestId: def.requestId, lineId: def.lineId }, draft.date, draft);
        $v.ret = draft;
        $v.retView = fxReturn.preview(s, nd, draft);
        $v.retDef = nd;
        setInputs(nd.rows.map((r) => ({ id: r.uid, value: r.usage })).concat(nd.rows.map((r) => ({ id: r.sid, value: r.standby }))));
        return;
      }
      if (op === 'hours') {
        if (!date || (kind !== 'usage' && kind !== 'standby')) return;
        draft[kind] = Object.assign({}, draft[kind] || {});
        draft[kind][date] = value === undefined || value === null ? '' : String(value);
        $v.ret = draft;
        $v.retView = fxReturn.preview(s, def, draft);
        return;
      }
      if (op === 'approve') {
        draft.approve = checked === true || checked === 'true';
        $v.ret = draft;
        $v.retView = fxReturn.preview(s, def, draft);
        return;
      }
      if (op === 'fill') {
        const f = fxReturn.fill(s, def, draft);
        $v.ret = f.draft;
        $v.retView = fxReturn.preview(s, def, f.draft);
        setInputs(f.reset);
        return;
      }
      if (op === 'now') {
        const pv = fxReturn.preview(s, def, draft);
        if (!pv.ok || !pv.now) { $v.retView = pv; $v.retError = pv.warn || 'Pick a return date after today to return it now.'; return; }
        const res = fx.act({ type: 'returnNow', payload: pv.now, quiet: true });
        if (!res || res.cancelled) return;
        if (!res.ok) {
          $v.retError = res.error || 'It did not go through.';
          $v.failure = { text: $v.retError, what: def.title };
          return;
        }
        $v.failure = { text: '', what: '' };
        $v.retDef = Object.assign({}, CLOSED);
        bus.toast(pv.nowToast || 'Returned.', 'info');
        return;
      }
      if (op === 'confirm') {
        const pv = fxReturn.preview(s, def, draft);
        if (!pv.ok) { $v.retView = pv; $v.retError = pv.warn; return; }
        let res = { ok: true };
        if (pv.bulk) res = fx.act({ type: 'logHoursBulk', payload: pv.bulk, quiet: true });
        if (res.ok && pv.offHire) res = fx.act({ type: 'offHire', payload: pv.offHire, quiet: true });
        if (!res || res.cancelled) return;
        if (!res.ok) {
          $v.retError = res.error || 'It did not go through.';
          $v.failure = { text: $v.retError, what: def.title };
          $v.retView = fxReturn.preview(fx.store.get(), fxReturn.def(fx.store.get(), { requestId: def.requestId, lineId: def.lineId }, draft.date, draft), draft);
          return;
        }
        $v.failure = { text: '', what: '' };
        $v.retDef = Object.assign({}, CLOSED);
        bus.toast(pv.toast || 'Done.', 'info');
      }
    }
  }

  return returnChain;
});
