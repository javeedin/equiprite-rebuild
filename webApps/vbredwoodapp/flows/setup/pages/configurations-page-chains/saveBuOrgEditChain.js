define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Save the BU & Org mapping edit dialog: PATCH the row's orgRole (Yard Type) and
  // isTransactable by id, then reload. BU + yard are fixed.
  class saveBuOrgEditChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const target = $page.variables.BuOrgEditTarget || {};

      if (target.id == null || !target.yardType) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Yard Type required',
          message: 'Please choose a yard type.',
          displayMode: 'transient', type: 'warning'
        });
        return;
      }

      $page.variables.isBuOrgSaving = true;
      let ok = false;
      try {
        const res = await Actions.callRest(context, {
          endpoint: 'eqp-v1/patchBuOrgMapping',
          uriParams: { id: target.id },
          body: {
            orgRole:        target.yardType,
            isTransactable: target.isTransactable === 'N' ? 'N' : 'Y',
            // Cleared when the yard type no longer uses one (Destination Yard).
            subinventoryCode: ($page.functions.buOrgNeedsSubinventory(target.yardType) && target.subinventoryCode) || null,
            lastUpdatedBy:  'EQUIPRITE'
          }
        });
        ok = !!(res && res.ok);
        if (!ok) console.error('saveBuOrgEditChain: PATCH failed', res && res.statusCode);
      } catch (e) {
        console.error('saveBuOrgEditChain: exception', e);
      }
      $page.variables.isBuOrgSaving = false;

      const dlg = document.getElementById('buOrgEditDialog');
      if (dlg) dlg.close();

      if (ok) {
        await Actions.callChain(context, { chain: 'loadBuOrgMappingsChain' });
        await Actions.fireNotificationEvent(context, {
          summary: 'Mapping updated',
          message: '"' + (target.orgName || '') + '" was updated.',
          displayMode: 'transient', type: 'confirmation'
        });
      } else {
        await Actions.fireNotificationEvent(context, {
          summary: 'Could not update mapping',
          message: 'Failed to update the mapping. Please try again.',
          displayMode: 'transient', type: 'error'
        });
      }
    }
  }

  return saveBuOrgEditChain;
});
