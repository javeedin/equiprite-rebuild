define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Detach one expenditure type from this equipment, or make it the default.
  // Two small operations in one chain because they share everything except the
  // call itself, and splitting them would mean two near-identical files.
  //
  // Deleting the LAST one does not leave the equipment with nothing: it falls
  // back to whatever its subclass or class maps, and if none of those exist, to
  // the project's full list. Nothing is ever blocked by removing a mapping.
  class removeEquipExpTypeChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const { id, action } = params || {};
      if (id == null) { return; }

      const row = ($page.variables.ExpTypeRows || [])
        .find(r => Number(r.eqrExpTypeMapId) === Number(id)) || {};

      let result;
      if (action === 'default') {
        // Already the default: re-sending would burn an update and bump the
        // object version for no change.
        if (row.isDefault === 'Y') { return; }
        result = await Actions.callRest(context, {
          endpoint:  'eqp-v1/patchExpTypeMap',
          uriParams: { id: Number(id) },
          // isDefault only. The backend clears the flag on this scope's other
          // rows in the same transaction, so there is no "unset" to send.
          body:      { isDefault: 'Y' }
        });
      } else {
        result = await Actions.callRest(context, {
          endpoint:  'eqp-v1/deleteExpTypeMap',
          uriParams: { id: Number(id) }
        });
      }

      // 204 on delete. A 404 means it is already gone, which is what was asked
      // for -- treat it as done, not as an error.
      const ok = result.ok || result.statusCode === 204
        || (action !== 'default' && result.statusCode === 404);

      if (ok) {
        await Actions.callChain(context, { chain: 'loadEquipExpTypesChain' });
        await Actions.fireNotificationEvent(context, {
          summary: action === 'default' ? 'Default set' : 'Expenditure type removed',
          message: action === 'default'
            ? '"' + (row.expenditureType || 'That type') + '" is now listed first on timesheets '
              + 'for this equipment.'
            : '"' + (row.expenditureType || 'The type') + '" is no longer offered for this equipment.',
          displayMode: 'transient',
          type: 'confirmation'
        });
      } else {
        const detail = (result.body && (result.body.detail || JSON.stringify(result.body)))
          || ('status ' + result.statusCode);
        await Actions.fireNotificationEvent(context, {
          summary: action === 'default' ? 'Could not set the default' : 'Could not remove',
          message: detail,
          displayMode: 'transient',
          type: 'error'
        });
      }
    }
  }

  return removeEquipExpTypeChain;
});
