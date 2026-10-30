define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/shellBus',
], (ActionChain, Actions, bus) => {
  'use strict';

  // New EquipRite's Timesheet approval approveChain, with its Fusion step left to New EquipRite.
  //
  // In New, approving runs once per request:
  //   1 PATCH patchTimeEntry {status: APPROVED} for each of the request's ticked entries, stopping at a failure
  //   2 under Fusion PPM rates only: send the request to Fusion (postCostToFusion: the OIC post-cost flow)
  //   3 on any failure: PATCH this request's just-approved entries back to SUBMITTED, and name any that could not be
  // Step 2 writes to Fusion, which EquipRite Next does not do. And under Fusion PPM rates a timesheet must never sit at
  // APPROVED with hours that did not reach Fusion (New's rule), so under PPM rates Next approves NOTHING: it says so
  // and the screen offers New's Approve time instead. Without PPM rates step 2 does not exist and Next runs steps 1 and
  // 3 exactly as New does (tests/next-usage.test.js runs both chains against one fake backend). Requests are
  // independent: one request's failure does not undo another's approval. Refused while the settings are still loading
  // (the PPM check would otherwise read as off). Asks first.
  function describeFailure(resp) {
    if (!resp) return 'no response';
    const b = resp.body;
    let detail = '';
    if (b && typeof b === 'object') detail = b.detail || b.title || b.message || '';
    else if (typeof b === 'string') detail = b;
    return 'HTTP ' + (resp.status || '?') + (detail ? ': ' + String(detail).slice(0, 300) : '');
  }

  const PPM_IN_NEW = 'Rates come from Fusion PPM, so approving also sends these hours to Fusion PPM, which EquipRite Next does not do yet. '
    + 'Nothing was approved: approve these lines in New EquipRite.';

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
      if (ppmOn) {
        // Next: New's step 2 writes to Fusion. Nothing is written here.
        v.confirm = '';
        v.actionError = PPM_IN_NEW;
        return;
      }
      v.isWorking = true;
      v.actionError = '';
      v.actionNote = '';
      v.confirm = '';
      const done = [];
      const failed = [];
      try {
        for (const g of groups) {
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
          bus.toast('Timesheet not approved: ' + failed.join(' '), 'error');
        }
        if (done.length) {
          v.actionNote = 'Approved: ' + done.join(', ') + '.';
          bus.toast('Approved ' + done.join(', ') + '.', 'info');
        }
        await Actions.callChain(context, { chain: 'loadApprovalsChain', params: { week: v.weekKey } });
      } finally {
        try { v.isWorking = false; } catch (e2) { /* page left */ }
      }
    }
  }

  return approveChain;
});
