define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/currentUser',
  'resources/js/shellBus',
], (ActionChain, Actions, cu, bus) => {
  'use strict';

  // New EquipRite's Timesheet approval adjustChain, unchanged but for its message (the shell's toast here).

  // Adjust hours at approval (FDD 7.14.3: "adjust hours, audit kept, no resubmission"). Old EquipRite has no adjust;
  // the writes are the time-entry writes the old timesheet save makes, in its order, without touching the status:
  //   1 PATCH patchTimeEntry {totalHours, billableHours}   (no status: the line stays SUBMITTED for approval)
  //   2 createTimeEntryDay for each of the 7 days          (the save's upsert on entry + date)
  //   3 POST createAuditTrailEntry: entity EQR_TIME_ENTRY, the submitted and the new hours, who and why
  // A failed PATCH changes nothing and says so. A failed audit write after the hours were saved is reported as an
  // error that names the change, so it can be recorded by hand.
  class adjustChain extends ActionChain {
    async run(context, { action, key, day, value }) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      if (action === 'cancel') {
        v.adjust = null;
        return;
      }
      if (action === 'start') {
        const row = (v.rowsAll || []).find((r) => r.key === key);
        if (!row || !fns.canAct(row, v.readOnly) || v.isWorking) return;
        v.adjust = { key: row.key, days: row.days.map((h) => String(h)), reason: '' };
        v.actionError = '';
        return;
      }
      if (!v.adjust) return;
      if (action === 'day') {
        const i = Number(day);
        if (!(i >= 0 && i <= 6)) return;
        const days = v.adjust.days.slice();
        days[i] = value == null ? '' : String(value).trim();
        v.adjust = Object.assign({}, v.adjust, { days });
        return;
      }
      if (action === 'reason') {
        v.adjust = Object.assign({}, v.adjust, { reason: value == null ? '' : String(value) });
        return;
      }
      if (action !== 'save' || v.isWorking) return;

      const row = (v.rowsAll || []).find((r) => r.key === v.adjust.key);
      const problems = fns.adjustProblems(row, v.adjust);
      if (problems.length) {
        v.actionError = problems.join(' ');
        return;
      }
      const after = v.adjust.days.map((x) => Number(String(x).trim() === '' ? 0 : x) || 0);
      const totalHours = Math.round(after.reduce((s, h) => s + h, 0) * 100) / 100;
      const audit = fns.auditBody(row, after, v.adjust.reason, cu.auditActor(context), v.weekDays);
      v.isWorking = true;
      v.actionError = '';
      v.actionNote = '';
      try {
        const p = await Actions.callRest(context, {
          endpoint: 'eqp-v1/patchTimeEntry',
          uriParams: { id: row.entryId },
          body: { totalHours, billableHours: totalHours },
        });
        if (!p || !p.ok) {
          v.actionError = 'The hours could not be adjusted (HTTP ' + (p && p.status) + '). Nothing was changed.';
          return;
        }
        let dayFailed = 0;
        for (let i = 0; i < 7; i++) {
          const d = v.weekDays[i];
          if (!d) continue;
          const r = await Actions.callRest(context, {
            endpoint: 'eqp-v1/createTimeEntryDay',
            body: { timeEntryId: row.entryId, workDate: d.iso + 'T00:00:00Z', hoursWorked: after[i] },
          });
          if (!r || !r.ok) dayFailed++;
        }
        const a = await Actions.callRest(context, { endpoint: 'eqp-v1/createAuditTrailEntry', headers: cu.auditHeaders(context), body: audit });
        if (!a || !a.ok) {
          v.actionError = 'The hours were adjusted but the audit entry was not written (HTTP ' + (a && a.status) + '). Record it by hand: '
            + audit.changeSummary;
        } else if (dayFailed) {
          v.actionError = dayFailed + ' day(s) of the adjustment were not saved. Check the line and adjust again.';
        } else {
          v.actionNote = audit.changeSummary;
          bus.toast('Hours adjusted. ' + audit.changeSummary, 'info');
        }
        v.adjust = null;
        await Actions.callChain(context, { chain: 'loadApprovalsChain', params: { week: v.weekKey } });
      } catch (e) {
        console.error('[adjustChain] failed', e);
        v.actionError = 'The adjustment was interrupted. Reload the week before trying again.';
      } finally {
        try { v.isWorking = false; } catch (e2) { /* page left */ }
      }
    }
  }

  return adjustChain;
});
