define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestLineBody',
  'resources/js/currentUser',
], (ActionChain, Actions, lineBody, cu) => {
  'use strict';

  // An equipment's expenditure type (the type its cost posts to PPM under). save is the old saveExpTypeChain: ONE
  // patchRequestLinesBatch for EVERY request line under the equipment (rows group by equipment name, so one row can
  // be two lines), and the rows are updated in place. Weeks already posted keep the type frozen into the ledger.
  class expTypeChain extends ActionChain {
    async run(context, { action, value }) {
      const { $page } = context;
      const v = $page.variables;
      if (action === 'query') {
        v.exp = Object.assign({}, v.exp, { query: value == null ? '' : String(value) });
        return;
      }
      if (action === 'pick') {
        v.exp = Object.assign({}, v.exp, { choice: value || null, error: '' });
        return;
      }
      if (action !== 'save' || v.isSavingExp || v.readOnly) return;

      const line = (v.exp && v.exp.line) || {};
      const chosen = v.exp && v.exp.choice ? String(v.exp.choice) : '';
      if (!chosen) {
        v.exp = Object.assign({}, v.exp, { error: 'Choose an expenditure type, or close without saving to leave it unset.' });
        return;
      }
      if (chosen === (line.current || '')) {
        v.panel = '';
        return;
      }
      const rows = v.rowsAll || [];
      const grp = rows.find((r) => r.kind === 'group' && r.groupKey === line.groupKey);
      if (!grp) { v.panel = ''; return; }
      const lineIds = (Array.isArray(grp.requestLineIds) && grp.requestLineIds.length) ? grp.requestLineIds
        : (grp.requestLineId != null ? [Number(grp.requestLineId)] : []);
      if (!lineIds.length) {
        v.exp = Object.assign({}, v.exp, { error: 'This equipment has no request line to save against.' });
        return;
      }
      const requestId = Number(v.current && v.current.eqrEquipmentRequestId) || null;
      if (!requestId) {
        v.exp = Object.assign({}, v.exp, { error: 'The request id is not known, so the choice cannot be saved. Open the request from the list again.' });
        return;
      }
      v.isSavingExp = true;
      try {
        const batch = await lineBody.updateLines(context, Actions, {
          requestId,
          headers: cu.auditHeaders(context),
          updates: lineIds.map((lid) => ({ id: Number(lid), expenditureType: chosen })),
        });
        if (!batch.ok) {
          v.exp = Object.assign({}, v.exp, { error: 'Could not save the expenditure type' + (batch.message ? ' (' + batch.message + ')' : '') + '.' });
          return;
        }
        v.rowsAll = rows.map((r) => (r.kind === 'group' && r.groupKey === line.groupKey ? Object.assign({}, r, { expenditureType: chosen, expenditureTypeMixed: false })
          : (r.kind === 'week' && r.groupKey === line.groupKey && !r.posted ? Object.assign({}, r, { lineExpenditureType: chosen }) : r)));
        v.panel = '';
        await Actions.fireNotificationEvent(context, {
          summary: 'Expenditure type saved',
          message: (line.equipmentName || 'This equipment') + ' will post to PPM as "' + chosen + '".'
            + (line.hasPosted ? ' Weeks already posted keep the type they were sent with.' : ''),
          type: 'confirmation',
        });
      } finally {
        v.isSavingExp = false;
      }
    }
  }

  return expTypeChain;
});
