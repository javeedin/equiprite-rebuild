define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/shellBus',
], (ActionChain, Actions, bus) => {
  'use strict';

  // New EquipRite's resetChangesChain (Discard), unchanged but for the toast: clear what is staged, then load the
  // settings again so the page shows what the database holds.
  class resetChangesChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.hasChanges = false;
      $page.variables.changedRows = {};
      $page.variables.buSettingsDirty = false;
      $page.variables.saveError = '';
      await Actions.callChain(context, { chain: 'loadConfigSettingsChain' });
      bus.toast('Unsaved changes discarded. The settings are as saved.', 'info');
    }
  }

  return resetChangesChain;
});
