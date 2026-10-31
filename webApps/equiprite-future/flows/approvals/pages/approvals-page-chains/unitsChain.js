define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/approveAllocate',
  'resources/js/approvalQueue',
  'resources/js/rules',
  'resources/js/shellBus',
], (ActionChain, Actions, aa, queue, rules, bus) => {
  'use strict';

  // Opens (or closes, or reads again) the unit picker under a line: New EquipRite's openUnitsChain. The line's gate
  // first (approvalQueue.lineAction: not while the request waits for approval or owes a quote; never for free stock or
  // a line sent back), then its units over the line's dates, whether a Transfer Order locks it, and the other
  // requests' bookings of these units (the schedule). Reads only; nothing is written until Save.
  class unitsChain extends ActionChain {
    async run(context, { lineId, close, reload }) {
      const { $page, $application } = context;
      const v = $page.variables;
      const app = $application.variables;
      v.pickNote = '';
      if (close || (!reload && lineId != null && String(v.picker.lineId) === String(lineId))) {
        v.picker = { lineId: '' };
        $page.functions.clearPicker();
        return;
      }
      const head = v.rec && v.rec.head;
      const line = (v.lines || []).filter((l) => String(l.lineId) === String(lineId))[0];
      if (!head || !line) return;
      const gate = queue.lineAction(line, head, head.quotingAllowed, !v.canAct);
      if (gate.kind === 'blocked' || gate.kind === 'none') {
        bus.toast(gate.reason || 'This line takes no unit.', 'info');
        return;
      }
      const id = String(lineId);
      v.picker = { lineId: id, loading: true, error: '', title: line.equipment_name || ('Line ' + line.line_no), lineNo: line.line_no };
      const u = await aa.loadUnits(context, Actions, {
        requestId: head.id, line, requestNumber: head.number, readOnly: !v.canAct, bookings: true,
        isExternal: (source) => rules.isExternalSource(source),
        quotingOn: (source) => rules.isQuotingAllowed(app.globalSettings, app.flagsLoaded, source),
      });
      if (String(v.picker.lineId) !== id) return; // another line was opened meanwhile
      if (u.error) {
        v.picker = Object.assign({}, v.picker, { loading: false, error: u.error });
        return;
      }
      $page.functions.initPicker(u, head.number);
      v.picker = {
        lineId: id,
        loading: false,
        error: u.empty,
        mode: u.mode,
        confirmed: u.confirmed,
        readOnly: u.readOnly,
        readOnlyWhy: u.readOnlyWhy,
        title: u.allocLine.equipment_name || line.equipment_name,
        lineNo: line.line_no,
        dates: $page.functions.range(u.allocLine.start_date, u.allocLine.end_date),
      };
      v.pickTick = (v.pickTick || 0) + 1;
    }
  }

  return unitsChain;
});
