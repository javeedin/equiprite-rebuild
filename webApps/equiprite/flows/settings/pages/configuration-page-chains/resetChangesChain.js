define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/resetChangesChain.js, unchanged.

  class resetChangesChain extends ActionChain {

    /**
     * Reverts all unsaved changes by reloading the configuration data from the server.
     * @param {Object} context
     */
    async run(context) {
      const { $page } = context;

      // 1. Clear dirty state flags immediately
      $page.variables.hasChanges = false;
      $page.variables.changedRows = {};
      $page.variables.buSettingsDirty = false;
      $page.variables.saveError = '';

      // 2. Re-run the main load chain to pull fresh data from the API
      // This effectively "undoes" any local edits in the ConfigSettingsMap.
      // NOTE: use { chain: ... } — the { id: ... } form of callChain is not
      // supported in the VB 2510 runtime and throws "reading 'id'".
      await Actions.callChain(context, {
        chain: 'loadConfigSettingsChain',
      });

      // 3. Fire a subtle notification
      await Actions.fireNotificationEvent(context, {
        summary: 'Changes Reset',
        message: 'All unsaved changes have been reverted.',
        displayMode: 'transient',
        type: 'info',
      });
    }
  }

  return resetChangesChain;
});
