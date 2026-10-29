define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/postCostToFusion',
], (ActionChain, Actions, postCostToFusion) => {
  'use strict';

  // Approve the ticked SUBMITTED lines. The old timesheet-approval-detail approveTimesheetChain, run once per request
  // (that page held one request; this one holds a week of them):
  //   1 PATCH patchTimeEntry {status: APPROVED} for each of the request's ticked entries, stopping at a failure
  //   2 under Fusion PPM rates only: send the request to Fusion (postCostToFusion.post: the project URL, then v1 on
  //     a 404). Approval is the only event that delivers PPM-priced hours to Fusion, so a timesheet must never sit at
  //     APPROVED with hours that did not get there
  //   3 on any failure: PATCH this request's just-approved entries back to SUBMITTED, and name any that could not be
  // Requests are independent: one request's failure does not undo another's approval. Refused while the settings are
  // still loading (the PPM check would otherwise read as off). Asks first: the confirmation states the lines, hours
  // and cost, and under PPM rates that Fusion is sent the hours now.
  function describeFailure(resp) {
    if (!resp) return 'no response';
    const b = resp.body;
    let detail = '';
    if (b && typeof b === 'object') detail = b.detail || b.title || b.message || '';
    else if (typeof b === 'string') detail = b;
    return 'HTTP ' + (resp.status || '?') + (detail ? ': ' + String(detail).slice(0, 300) : '');
  }

  class approveChain extends ActionChain {
    async run(context, { step }) {
      const { $page, $application } = context;
      const v = $page.variables;
      if (step === 'cancel') {
        v.confirm = '';
        return;
      }
      const groups = $page.functions.byRequest(v.rowsAll, v.picked);
      if (step === 'ask') {
        v.actionError = '';
        v.actionNote = '';
        if (!groups.length) {
          v.actionError = 'No SUBMITTED rows selected to approve.';
          return;
        }
        v.confirm = 'approve';
        return;
      }
      if (step !== 'go' || v.isWorking || v.readOnly) return;
      if (!groups.length) {
        v.actionError = 'No SUBMITTED rows selected to approve.';
        v.confirm = '';
        return;
      }
      if (!$application.variables.flagsLoaded) {
        v.actionError = 'Settings are still loading. Please try again in a moment.';
        return;
      }
      const ppmOn = $application.functions.isFeatureEnabled($application.variables.featureFlags, $application.variables.flagsLoaded, 'PPM_RATES_ENABLED');
      v.isWorking = true;
      v.actionError = '';
      v.actionNote = '';
      v.confirm = '';
      const done = [];
      const failed = [];
      try {
        for (const g of groups) {
          if (ppmOn && !g.requestNumber) {
            failed.push('A line with no request number cannot be sent to Fusion PPM, so it was not approved.');
            continue;
          }
          const approvedIds = [];
          let failure = '';
          try {
            for (const entryId of g.entryIds) {
              const r = await Actions.callRest(context, { endpoint: 'eqp-v1/patchTimeEntry', uriParams: { id: Number(entryId) }, body: { status: 'APPROVED' } });
              if (!r || !r.ok) {
                failure = 'Could not approve entry ' + entryId + ' (' + describeFailure(r) + ').';
                break;
              }
              approvedIds.push(entryId);
            }
            if (!failure && ppmOn) {
              const f = await postCostToFusion.post(context, Actions, g.requestNumber);
              if (!f || !f.ok) failure = 'The send to Fusion PPM failed (' + describeFailure(f) + ').';
            }
          } catch (e) {
            failure = failure || ('Approval error: ' + ((e && e.message) || e));
          }
          if (!failure) {
            done.push(g.requestNumber + ' (' + approvedIds.length + ')');
            continue;
          }
          const stuck = [];
          for (const entryId of approvedIds) {
            try {
              const r = await Actions.callRest(context, { endpoint: 'eqp-v1/patchTimeEntry', uriParams: { id: Number(entryId) }, body: { status: 'SUBMITTED' } });
              if (!r || !r.ok) stuck.push(entryId);
            } catch (e) {
              stuck.push(entryId);
            }
          }
          failed.push(g.requestNumber + ': NOT approved. ' + failure + (stuck.length
            ? ' Entries ' + stuck.join(', ') + ' could not be returned to SUBMITTED and are still APPROVED.'
            : ' It is still SUBMITTED; fix the cause and approve again.'));
        }
        if (failed.length) {
          v.actionError = failed.join(' ');
          await Actions.fireNotificationEvent(context, { summary: 'Timesheet not approved', message: failed.join(' '), type: 'error', displayMode: 'persist' });
        }
        if (done.length) {
          v.actionNote = 'Approved: ' + done.join(', ') + '.' + (ppmOn ? ' Hours sent to Fusion PPM.' : '');
          await Actions.fireNotificationEvent(context, {
            summary: 'Timesheets approved',
            message: 'Approved ' + done.join(', ') + '.' + (ppmOn ? ' Hours sent to Fusion PPM.' : ''),
            type: 'confirmation',
            displayMode: 'transient',
          });
        }
        await Actions.callChain(context, { chain: 'loadApprovalsChain', params: { week: v.weekKey } });
      } finally {
        try { v.isWorking = false; } catch (e2) { /* page left */ }
      }
    }
  }

  return approveChain;
});
