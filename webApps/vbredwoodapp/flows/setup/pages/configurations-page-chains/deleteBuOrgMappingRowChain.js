define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Hard-delete a mapping row by id (per-row DELETE endpoint), then reload.
  // Enable/disable is handled separately by the ACTIVE toggle, so Delete is a true
  // removal, not a deactivate.
  class deleteBuOrgMappingRowChain extends ActionChain {
    async run(context, { rowKey } = {}) {
      const { $page } = context;
      if (rowKey == null) return;

      const removed = ($page.variables.BuOrgMappingsArray || [])
        .find(function (r) { return r.rowKey === rowKey; });
      if (!removed || removed.id == null) return;

      $page.variables.isBuOrgSaving = true;
      let ok = false;
      try {
        const result = await Actions.callRest(context, {
          endpoint: 'eqp-v1/deleteBuOrgMapping',
          uriParams: { id: removed.id }
        });
        ok = !!(result && result.ok);
        if (!ok) console.error('deleteBuOrgMappingRowChain: DELETE failed', result && result.statusCode);
      } catch (e) {
        console.error('deleteBuOrgMappingRowChain: exception', e);
      }
      $page.variables.isBuOrgSaving = false;

      const dlg = document.getElementById('buOrgDeleteDialog');
      if (dlg) dlg.close();

      if (ok) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Mapping deleted',
          message: '"' + (removed.orgName || removed.orgId) + '" was removed.',
          displayMode: 'transient', type: 'confirmation'
        });
        await Actions.callChain(context, { chain: 'loadBuOrgMappingsChain' });
      } else {
        await Actions.fireNotificationEvent(context, {
          summary: 'Could not delete mapping',
          message: 'Please try again.',
          displayMode: 'transient', type: 'error'
        });
      }
    }
  }

  return deleteBuOrgMappingRowChain;
});
