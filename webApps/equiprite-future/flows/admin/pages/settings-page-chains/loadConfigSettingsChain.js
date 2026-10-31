define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/settingsKit',
], (ActionChain, Actions, kit) => {
  'use strict';

  // New EquipRite's loadConfigSettingsChain (from Old's), with its calls and their order unchanged:
  //   GET conf-global-settings?size=500 (the table is paginated; 20 by default), then GET audit-trail;
  //   the settings map (buildSettingsMap), kept as loaded too (StoredSettingsMap);
  //   the on-screen copies seeded from it (week-ending day, quotes, the PPM posting labels with their defaults);
  //   when Fusion PPM rates is on and a posting label was never saved, it is staged so Save writes it.
  // Left out: the Class Mapping seeds and the column-mapping refill, which belong to the Equipment classes section
  // (managed in New EquipRite).
  class loadConfigSettingsChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.isLoading = true;
      $page.variables.saveError = '';
      $page.variables.loadError = '';

      try {
        const settingsResult = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getConfGlobalSettings',
          uriParams: { size: 500 }
        });

        const auditResult = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getAuditTrail'
        });

        if (settingsResult.ok) {
          const settingsData = settingsResult.body.data || [];
          const map = kit.buildSettingsMap(settingsData);
          $page.variables.ConfigSettingsMap = map;
          $page.variables.StoredSettingsMap = map;

          $page.variables.WeekEndDaySel = kit.getSettingValue(map, 'WEEK_END_DAY', '');
          $page.variables.EnableQuotesSel = kit.getSettingValue(map, 'ENABLE_QUOTES', 'CUSTOMER');
          $page.variables.PpmTxnSourceSel = kit.getSettingValue(map, 'PPM_TXN_SOURCE', 'External Miscellaneous');
          $page.variables.PpmDocumentSel = kit.getSettingValue(map, 'PPM_DOCUMENT', 'Miscellaneous');
          $page.variables.PpmDocEntrySel = kit.getSettingValue(map, 'PPM_DOC_ENTRY', 'Miscellaneous');
          $page.variables.PpmExpenditureOrgSel = kit.getSettingValue(map, 'PPM_EXPENDITURE_ORG', '');

          if (kit.getSettingBool(map, 'PPM_RATES_ENABLED')) {
            const missing = kit.getMissingPpmPostingRows(map, {
              txnSource: $page.variables.PpmTxnSourceSel,
              document: $page.variables.PpmDocumentSel,
              docEntry: $page.variables.PpmDocEntrySel
            });
            if (Object.keys(missing).length > 0) {
              $page.variables.changedRows = Object.assign({}, $page.variables.changedRows, missing);
              $page.variables.hasChanges = true;
            }
          }
        } else {
          console.error('loadConfigSettingsChain: Failed to load settings', settingsResult.statusCode);
          $page.variables.loadError = 'The settings could not be loaded (HTTP ' + (settingsResult.status || settingsResult.statusCode || '?') + '). Nothing can be changed until they are; refresh the tab to try again.';
        }

        if (auditResult.ok) {
          $page.variables.AuditTrailAllArray = auditResult.body.data || [];
        } else {
          console.error('loadConfigSettingsChain: Failed to load audit-trail', auditResult.statusCode);
        }
      } catch (err) {
        console.error('loadConfigSettingsChain: Unexpected error', err);
        $page.variables.saveError = 'Failed to load configuration settings. Please refresh.';
      } finally {
        $page.variables.isLoading = false;
      }
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return loadConfigSettingsChain;
});
