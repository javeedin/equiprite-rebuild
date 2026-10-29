define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Reject the ticked SUBMITTED lines: the old rejectTimesheetChain, PATCH patchTimeEntry {status: REJECTED} entry by
  // entry, stopping at the first failure. A rejected line is editable again in Time entry. Asks first.
  class rejectChain extends ActionChain {
    async run(context, { step }) {
      const { $page } = context;
      const v = $page.variables;
      const rows = $page.functions.pickedRows(v.rowsAll, v.picked);
      if (step === 'ask') {
        v.actionError = '';
        v.actionNote = '';
        if (!rows.length) {
          v.actionError = 'No SUBMITTED rows selected to reject.';
          return;
        }
        v.confirm = 'reject';
        return;
      }
      if (step !== 'go' || v.isWorking || v.readOnly) return;
      v.confirm = '';
      if (!rows.length) {
        v.actionError = 'No SUBMITTED rows selected to reject.';
        return;
      }
      v.isWorking = true;
      v.actionError = '';
      v.actionNote = '';
      let rejected = 0;
      try {
        for (const r of rows) {
          const res = await Actions.callRest(context, { endpoint: 'eqp-v1/patchTimeEntry', uriParams: { id: Number(r.entryId) }, body: { status: 'REJECTED' } });
          if (!res || !res.ok) {
            v.actionError = 'Failed to reject entry ' + r.entryId + ' (' + r.requestNumber + ' · ' + r.equipmentName + ').'
              + (rejected ? ' ' + rejected + ' line(s) before it were rejected.' : '');
            break;
          }
          rejected++;
        }
        if (rejected && !v.actionError) {
          v.actionNote = rejected + (rejected === 1 ? ' line' : ' lines') + ' rejected. The timekeeper can correct and resubmit them.';
          await Actions.fireNotificationEvent(context, { summary: 'Timesheet rejected', message: v.actionNote, type: 'confirmation', displayMode: 'transient' });
        }
        await Actions.callChain(context, { chain: 'loadApprovalsChain', params: { week: v.weekKey } });
      } catch (e) {
        v.actionError = 'Rejection error: ' + ((e && e.message) || e);
      } finally {
        try { v.isWorking = false; } catch (e2) { /* page left */ }
      }
    }
  }

  return rejectChain;
});
