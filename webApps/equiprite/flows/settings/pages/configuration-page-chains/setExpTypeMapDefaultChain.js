define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/setExpTypeMapDefaultChain.js, unchanged.

  // Make one mapping the default for its scope -- the type the timesheet
  // pre-selects when a row has none yet.
  //
  // Only ever sets 'Y'. The backend clears the flag on the scope's other rows in
  // the same transaction, so there is no "unset" action: a scope has one default
  // or none, and none only happens before the first type is authored or after
  // the default is deleted.
  class setExpTypeMapDefaultChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const { id } = params || {};
      if (id == null) return;

      const row = ($page.variables.ExpTypeMapAllArray || [])
        .find(r => Number(r.eqrExpTypeMapId) === Number(id)) || {};

      // Already the default: nothing to do, and re-sending would burn an update
      // and an object-version bump for no change.
      if (row.isDefault === 'Y') return;

      const result = await Actions.callRest(context, {
        endpoint:  'eqp-v1/patchExpTypeMap',
        uriParams: { id: Number(id) },
        // Only isDefault. Omitted fields are left alone by the backend, and
        // expenditureTypeId in particular must NOT be sent as a bare null --
        // that means "leave unchanged" there, but sending it needlessly invites
        // confusion with clearExpenditureTypeId.
        body: { isDefault: 'Y' }
      });

      if (result.ok) {
        await Actions.callChain(context, { chain: 'loadExpTypeMapsChain' });
        await Actions.fireNotificationEvent(context, {
          summary: 'Default set',
          message: '"' + (row.expenditureType || 'That type') + '" is now pre-selected on timesheets for '
            + (row.scopeName || 'this scope') + '.',
          displayMode: 'transient',
          type: 'confirmation'
        });
      } else {
        const detail = (result.body && (result.body.detail || JSON.stringify(result.body)))
          || ('status ' + result.statusCode);
        await Actions.fireNotificationEvent(context, {
          summary: 'Could not set the default',
          message: detail,
          displayMode: 'transient',
          type: 'error'
        });
      }
    }
  }

  return setExpTypeMapDefaultChain;
});
