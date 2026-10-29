define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestLineBody',
  'resources/js/currentUser'
], (ActionChain, Actions, lineBody, cu) => {
  'use strict';

  /*
   * Persist the per-equipment expenditure type.
   *
   * The type is authored on EQR_REQUEST_LINE and applies to every week of that
   * equipment. It is SNAPSHOTTED into EQR_POSTED_WEEK at post time (see
   * postSelectedChain), so changing it here never rewrites a week that has
   * already gone to Fusion — the ledger is frozen by design, exactly as it is
   * for COST_RATE and PERIOD_TYPE.
   *
   * Contract: MD/Post Cost/expenditure-type/BACKEND_HANDOFF_expenditure_type.md
   */
  class saveExpTypeChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const line = $page.variables.expTypeDrawerLine || {};
      const chosen = $page.variables.expTypeChoice ? String($page.variables.expTypeChoice) : '';

      if (!chosen) {
        $page.variables.expTypeFormError = 'Choose an expenditure type, or close without saving to leave it unset.';
        return;
      }
      if (chosen === (line.current || '')) {
        // Nothing to do. Silently closing is better than a "saved" toast for a
        // save that never happened.
        $page.variables.isExpTypeDrawerOpen = false;
        return;
      }

      const rows = $page.variables.rowsAll || [];
      const grp = rows.find(function (r) { return r.kind === 'group' && r.groupKey === line.groupKey; });
      if (!grp) { $page.variables.isExpTypeDrawerOpen = false; return; }

      // EVERY line under this equipment. The page groups by equipment NAME, so two
      // request lines carrying the same equipment render as one row; patching only
      // the head would leave half this equipment's cost posting under the old type
      // while the screen claimed otherwise. Falls back to the head id for a row
      // stamped before requestLineIds existed.
      const lineIds = (Array.isArray(grp.requestLineIds) && grp.requestLineIds.length)
        ? grp.requestLineIds
        : (grp.requestLineId != null ? [Number(grp.requestLineId)] : []);
      if (!lineIds.length) {
        $page.variables.expTypeFormError = 'This equipment has no request line to save against.';
        return;
      }

      const requestId = Number($page.variables.internalRequestId) || null;
      if (!requestId) {
        $page.variables.expTypeFormError = 'This page was opened without a request id, so the choice cannot be saved. '
          + 'Return to the Post Cost list and open the request again.';
        return;
      }

      $page.variables.isSavingExpType = true;
      $page.variables.expTypeFormError = '';
      try {
        // ONE batch PATCH for every line under this equipment (one
        // transaction, all or nothing), replacing a per-line Promise.all.
        const typeBatch = await lineBody.updateLines(context, Actions, {
          requestId: requestId,
          headers:   cu.auditHeaders(context),
          updates:   lineIds.map(function (lid) { return { id: Number(lid), expenditureType: chosen }; })
        });
        if (!typeBatch.ok) {
          $page.variables.expTypeFormError = 'Could not save the expenditure type'
            + (typeBatch.message ? ' (' + typeBatch.message + ')' : '')
            + '. If this is a "not found" or "unrecognized field" error, the '
            + 'EQR_REQUEST_LINE.EXPENDITURE_TYPE column is not deployed yet — see '
            + 'MD/Post Cost/expenditure-type/BACKEND_HANDOFF_expenditure_type.md.';
          return;
        }

        // Update in place rather than re-running vbEnterChain. A full re-read would
        // collapse every expanded equipment and lose the scroll position, which on
        // a 20-row rental is a worse outcome than the staleness it prevents — and
        // there is nothing to re-derive here: expenditure type feeds no total, no
        // rate and no rollup. (saveMiscChain DOES re-read, correctly: a new charge
        // exists server-side with an id and changes the money.)
        $page.variables.rowsAll = rows.map(function (r) {
          return (r.kind === 'group' && r.groupKey === line.groupKey)
            ? Object.assign({}, r, { expenditureType: chosen })
            : r;
        });
        $page.variables.rowsVisible = $page.functions.visibleRows($page.variables.rowsAll);
        $page.variables.isExpTypeDrawerOpen = false;

        await Actions.fireNotificationEvent(context, {
          summary: 'Expenditure type saved',
          message: (line.equipmentName || 'This equipment') + ' will post to PPM as "' + chosen + '".'
                 + (line.hasPosted
                      ? ' Weeks already posted keep the type they were sent with.'
                      : ''),
          type: 'confirmation',
        });
      } finally {
        $page.variables.isSavingExpType = false;
      }
    }
  }

  return saveExpTypeChain;
});
