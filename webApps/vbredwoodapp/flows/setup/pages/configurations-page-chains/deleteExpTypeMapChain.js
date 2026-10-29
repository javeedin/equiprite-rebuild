define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Hard-delete one mapping, then reload the table.
  class deleteExpTypeMapChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const { id } = params || {};
      if (id == null) return;

      const target = $page.variables.DeleteExpTypeMapTarget || {};

      const result = await Actions.callRest(context, {
        endpoint:  'eqp-v1/deleteExpTypeMap',
        uriParams: { id: Number(id) }
      });

      const dlg = document.getElementById('expTypeMapDeleteDialog');
      if (dlg) dlg.close();

      // 204 on success. A 404 means it is already gone, which is the outcome the
      // user asked for -- treat it as done rather than as an error.
      if (result.ok || result.statusCode === 204 || result.statusCode === 404) {
        await Actions.callChain(context, { chain: 'loadExpTypeMapsChain' });
        await Actions.fireNotificationEvent(context, {
          summary: 'Mapping removed',
          message: (target.expenditureType || 'The mapping')
            + ' is no longer offered for ' + (target.scopeName || 'that scope') + '.'
            // Removing the default leaves the scope with no pre-selected type;
            // the remaining ones still show, just with nothing highlighted.
            + (target.isDefault === 'Y' ? ' It was the default - set another if you want one.' : ''),
          displayMode: 'transient',
          type: 'confirmation'
        });
      } else {
        const detail = (result.body && (result.body.detail || JSON.stringify(result.body)))
          || ('status ' + result.statusCode);
        await Actions.fireNotificationEvent(context, {
          summary: 'Could not remove mapping',
          message: detail,
          displayMode: 'transient',
          type: 'error'
        });
      }
    }
  }

  return deleteExpTypeMapChain;
});
