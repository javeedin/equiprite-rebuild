define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Dispatches the Equipment Master page's secondary action menu.
   *
   * The menu items are declared in $page.variables.secondaryActions
   * (importFusion / refresh / syncFusion; mapView is off). Until this chain
   * existed the menu
   * rendered but nothing was wired to it, so every item was inert.
   *
   * NOTE: oj-sp-*-page emits the clicked id on $event.detail.secondaryItem,
   * NOT $event.detail.id. Reading .id yields undefined and the dispatch
   * silently does nothing. (request-detail-page.json uses .id and only appears
   * to work because it has a single action with a harmless fallback.)
   */
  class SecondaryActionChain extends ActionChain {
    async run(context, { event }) {
      const { $application } = context;
      const actionId = event && event.detail && event.detail.secondaryItem;

      if (actionId === 'importFusion') {
        // Writes the equipment master: FULL only. The menu item is already
        // off below FULL (actionsFor); this is the backstop.
        const vars = $application.variables;
        if ($application.functions.pageAccess(vars.pageAccessMap, vars.pageAccessLoaded,
              'EQR_EQUIPMENT_MASTER') !== 'FULL') {
          return;
        }
        // Opens the dialog on its PARAMETER step and loads the two filter
        // LOVs. It does NOT start the import — that is the dialog's Import
        // button, which calls ImportFromFusionChain with the chosen filter.
        await Actions.callChain(context, { chain: 'OpenImportDialogChain' });
        return;
      }

      // Header icon beside Import From Fusion; every user may refresh.
      if (actionId === 'refresh') {
        await Actions.callChain(context, { chain: 'RefreshEquipmentListChain' });
        return;
      }

      // Access and busy checks are in the chain itself.
      if (actionId === 'syncFusion') {
        await Actions.callChain(context, { chain: 'SyncFromFusionChain' });
        return;
      }

      // Declared in secondaryActions but not yet implemented. Handled
      // explicitly so an unimplemented item is a no-op rather than falling
      // through to the import.
      if (actionId === 'mapView') {
        return;
      }
    }
  }

  return SecondaryActionChain;
});
