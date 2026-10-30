define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/approveAllocate',
  'resources/js/approvalQueue',
  'resources/js/mobileApprove',
  'resources/js/rules',
  'resources/js/mobileBus',
], (ActionChain, Actions, aa, queue, ma, rules, bus) => {
  'use strict';

  // Opens (or closes, or reads again) a line's units in the unit sheet: Next's unitsChain (New EquipRite's
  // openUnitsChain). The line's gate first (approvalQueue.lineAction: not while the request waits for approval or owes
  // a quote; never for free stock or a line sent back), then its units over the line's dates, whether a Transfer Order
  // locks it, and the other requests' bookings of these units (the clashes). Reads only; nothing is written until Save.
  class unitsChain extends ActionChain {
    async run(context, { lineId, close, reload }) {
      const { $page, $application } = context;
      const pv = $page.variables;
      const app = $application.variables;
      if (pv.busy) return;
      pv.pickNote = '';
      if (close) {
        pv.picker = { lineId: '' };
        pv.sheet = '';
        $page.functions.clearPicker();
        return;
      }
      const head = pv.rec && pv.rec.head ? JSON.parse(JSON.stringify(pv.rec.head)) : null;
      const found = (pv.lines || []).filter((l) => String(l.lineId) === String(lineId))[0];
      if (!head || !found || pv.rec.offline) return;
      const line = JSON.parse(JSON.stringify(found));
      const gate = queue.lineAction(line, head, head.quotingAllowed, !pv.canAct);
      if (gate.kind === 'blocked' || gate.kind === 'none') {
        bus.toast(gate.reason || 'This line takes no unit.', 'info');
        return;
      }
      const id = String(lineId);
      const suggested = ma.suggestedNames(pv.sugg, id);
      pv.picker = { lineId: id, loading: true, error: '', title: line.equipment_name || ('Line ' + line.line_no), lineNo: line.line_no, suggested };
      pv.sheet = 'unit';
      const u = await aa.loadUnits(context, Actions, {
        requestId: head.id, line, requestNumber: head.number, readOnly: !pv.canAct, bookings: true,
        isExternal: (source) => rules.isExternalSource(source),
        quotingOn: (source) => rules.isQuotingAllowed(app.globalSettings, app.flagsLoaded, source),
      });
      if (String(pv.picker.lineId) !== id) return; // closed, or another line opened meanwhile
      if (u.error) {
        pv.picker = Object.assign({}, pv.picker, { loading: false, error: u.error });
        return;
      }
      $page.functions.initPicker(u, head.number);
      pv.picker = {
        lineId: id,
        loading: false,
        error: u.empty,
        mode: u.mode,
        confirmed: u.confirmed,
        readOnly: u.readOnly,
        readOnlyWhy: u.readOnlyWhy,
        title: u.allocLine.equipment_name || line.equipment_name,
        lineNo: line.line_no,
        qty: u.allocLine.qty,
        dates: $page.functions.range(u.allocLine.start_date, u.allocLine.end_date),
        suggested,
        reload: !!reload,
      };
      pv.pickTick = (pv.pickTick || 0) + 1;
    }
  }

  return unitsChain;
});
