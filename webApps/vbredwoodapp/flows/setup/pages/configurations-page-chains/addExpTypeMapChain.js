define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Author one equipment -> expenditure type link from the inline add form.
  class addExpTypeMapChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const draft = $page.variables.NewExpTypeMap || {};

      const scopeType = (draft.scopeType || 'MASTER').trim().toUpperCase();
      const scopeId   = Number(draft.scopeId) || null;
      const expType   = (draft.expenditureType || '').trim();

      if (!scopeId) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Pick something to map',
          message: 'Choose the equipment, subclass or class this expenditure type belongs to.',
          displayMode: 'transient',
          type: 'warning'
        });
        return;
      }
      if (!expType) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Expenditure type required',
          message: 'Choose (or type) the Fusion expenditure type to attach.',
          displayMode: 'transient',
          type: 'warning'
        });
        return;
      }
      // The column is VARCHAR2(80), the same width as EQR_REQUEST_LINE's, so a
      // longer name could never be written onto the line it is meant for. Caught
      // here rather than as a 500 from the driver.
      if (expType.length > 80) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Name too long',
          message: 'Expenditure type names are limited to 80 characters.',
          displayMode: 'transient',
          type: 'warning'
        });
        return;
      }

      // What this scope already holds, asked of the SERVER rather than read off
      // the table. The table is filtered (by scope and by search), so a filter
      // that happened to hide this scope's existing rows would make the next
      // type added look like the first -- marking it default and flipping the
      // real default off, with nothing on screen to show it happened.
      let existing = [];
      const existingResp = await Actions.callRest(context, {
        endpoint:  'eqp-v1/listExpTypeMaps',
        // Both or neither: the endpoint 400s on one without the other.
        uriParams: { scopeType: scopeType, scopeId: scopeId, page: 0, size: 200 }
      });
      if (existingResp.ok && existingResp.body && Array.isArray(existingResp.body.data)) {
        existing = existingResp.body.data;
      } else {
        // Could not tell. Add it as a NON-default rather than risk displacing a
        // default that may already exist -- "Make default" is one click away,
        // an unnoticed flip is not.
        console.warn('[EXPTYPEMAP] could not read existing rows for %s %s; adding as non-default',
          scopeType, scopeId);
      }
      const maxOrder = existing.reduce(function (m, r) {
        const o = (r && r.displayOrder != null) ? Number(r.displayOrder) : 0;
        return o > m ? o : m;
      }, 0);

      // The first type authored for a scope becomes its default, so the common
      // case (one type per model) needs no second action. The default is what
      // the timesheet lists FIRST -- it does not auto-fill the cell.
      const knownEmpty = existingResp.ok && existing.length === 0;
      const isDefault = knownEmpty ? 'Y' : 'N';

      const result = await Actions.callRest(context, {
        endpoint: 'eqp-v1/createExpTypeMap',
        body: {
          scopeType:       scopeType,
          scopeId:         scopeId,
          expenditureType: expType,
          isDefault:       isDefault,
          displayOrder:    maxOrder + 1,
          mapSource:       'MANUAL'
        }
      });

      if (result.ok) {
        // Keep the scope selected: authoring is 2-3 types for the SAME piece of
        // equipment in a row, so clearing it would mean re-picking every time.
        $page.variables.NewExpTypeMap = {
          scopeType:       scopeType,
          scopeId:         scopeId,
          expenditureType: ''
        };
        await Actions.callChain(context, { chain: 'loadExpTypeMapsChain' });
        await Actions.fireNotificationEvent(context, {
          summary: 'Mapping added',
          message: '"' + expType + '" will now be offered on timesheets for this '
            + (scopeType === 'MASTER' ? 'equipment' : scopeType.toLowerCase()) + '.',
          displayMode: 'transient',
          type: 'confirmation'
        });
      } else if (result.statusCode === 409) {
        // The unique key is case-INSENSITIVE on the name, so this fires even when
        // the two strings look different.
        await Actions.fireNotificationEvent(context, {
          summary: 'Already mapped',
          message: '"' + expType + '" is already attached to this '
            + (scopeType === 'MASTER' ? 'equipment' : scopeType.toLowerCase()) + '.',
          displayMode: 'transient',
          type: 'warning'
        });
      } else {
        const detail = (result.body && (result.body.detail || JSON.stringify(result.body)))
          || ('status ' + result.statusCode);
        await Actions.fireNotificationEvent(context, {
          summary: 'Could not add mapping',
          message: detail,
          displayMode: 'transient',
          type: 'error'
        });
      }
    }
  }

  return addExpTypeMapChain;
});
