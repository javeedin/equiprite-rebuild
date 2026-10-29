define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Re-read the Equipment Master list from the server.
   *
   * Runs from the Refresh icon in the page header and whenever the Import
   * From Fusion dialog closes. Until 2026-10-05 nothing refreshed the list: rows merged by Import
   * did not appear behind the dialog until a full page reload, which read as
   * "Import did nothing". Refreshing the SDP keeps the current search and sort.
   */
  class RefreshEquipmentListChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      try {
        await Actions.fireDataProviderEvent(context, {
          target: $page.variables.equipmentSDP,
          refresh: null
        });
      } catch (e) {
        console.error('[RefreshEquipmentListChain] refresh failed', e);
      }
    }
  }

  return RefreshEquipmentListChain;
});
