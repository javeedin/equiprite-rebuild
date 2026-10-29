define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/loadConfigSettingsChain.js. Calls and their
  // order unchanged; one addition: StoredSettingsMap keeps the map as loaded.

  class loadConfigSettingsChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.isLoading = true;
      $page.variables.saveError = '';

      try {
        // Fire all calls sequentially (VBCS does not support Promise.all in this context).
        // Global settings (week config, module + notification flags, Class Mapping)
        // live in the dedicated conf-global-settings table, keyed only by settingKey
        // (no businessUnitId).
        //
        // ⚠ THE ENDPOINT IS PAGINATED and defaults to 20 rows (Spring), exactly as
        // loadFeatureFlagsChain documents. At 25 rows (2026-10-09) the newest five
        // -- including CLASS_MAPPING_COLUMNS_* -- silently fell off page 0, so the
        // saved column mappings vanished from the page. Ask for the whole table.
        const settingsResult = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getConfGlobalSettings',
          uriParams: { size: 500 }
        });

        const auditResult = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getAuditTrail'
        });

        // Process settings flat map
        if (settingsResult.ok) {
          const settingsData = settingsResult.body.data || [];
          const map = $page.functions.buildSettingsMap(settingsData);
          $page.variables.ConfigSettingsMap = map;
          // New EquipRite: the map as loaded, to mark changed rows and to lock a saved WEEK_END_DAY.
          $page.variables.StoredSettingsMap = map;

          // Seed the Week Config end-day select from the global setting. The select
          // is two-way bound to this var (oj-select-single needs a writable value);
          // the save flow still captures it via data-setting-key. (Week is modeled
          // by END day only; start is derived end−6 — spec D1.)
          $page.variables.WeekEndDaySel = $page.functions.getSettingValue(map, 'WEEK_END_DAY', '');

          // Seed the Enable Quotes picker the same way (two-way bound var +
          // data-setting-key for the save path). Defaults to CUSTOMER — today's
          // hardcoded behaviour — when the row has never been saved, so an
          // un-seeded environment keeps quoting working for customers.
          $page.variables.EnableQuotesSel =
            $page.functions.getSettingValue(map, 'ENABLE_QUOTES', 'CUSTOMER');

          // Class Mapping source of truth. Defaults to '' (not chosen), which
          // offers all three sources -- the behaviour before the setting existed.
          $page.variables.ClassMapTruthSel =
            $page.functions.getSettingValue(map, 'CLASS_MAPPING_SOURCE_OF_TRUTH', '');
          $page.variables.ClassMapPrecedenceSel =
            $page.functions.getSettingValue(map, 'CLASS_MAPPING_PRECEDENCE', '');

          // Refill the column-mapping form from the saved mapping. On page entry
          // this load and the column-list load (loadClassMapTypesChain) race; if
          // the columns land first, the form was filled from an empty settings map.
          await Actions.callChain(context, { chain: 'onColumnMapSourceChangedChain' });

          // PPM posting identity — the source/document/document-entry triple the
          // OIC field map currently hardcodes. Defaulted to the values that post
          // successfully today, so an environment that has never saved these
          // behaves exactly as the hardcoded map does rather than posting blanks.
          //
          // Seeded here for the same reason the pickers above are: the controls
          // are two-way bound, and updateSettingChain's init-event guard compares
          // the incoming value against the STORED one. Without seeding, the first
          // render of an unsaved key would look like a change and mark the page
          // dirty before the user has touched anything.
          $page.variables.PpmTxnSourceSel =
            $page.functions.getSettingValue(map, 'PPM_TXN_SOURCE', 'External Miscellaneous');
          $page.variables.PpmDocumentSel =
            $page.functions.getSettingValue(map, 'PPM_DOCUMENT', 'Miscellaneous');
          $page.variables.PpmDocEntrySel =
            $page.functions.getSettingValue(map, 'PPM_DOC_ENTRY', 'Miscellaneous');
          // No default: blank means "not set" and the queue view falls back to its
          // old literal. Deliberately NOT in getMissingPpmPostingRows -- nothing
          // to auto-save when the field is empty.
          $page.variables.PpmExpenditureOrgSel =
            $page.functions.getSettingValue(map, 'PPM_EXPENDITURE_ORG', '');

          // The defaults above are only on screen. If PPM is on and a label was
          // never saved, the queue view has no row to read and posts nothing —
          // so mark the missing ones pending, which enables Save and writes them.
          if ($page.functions.getSettingBool(map, 'PPM_RATES_ENABLED')) {
            const missing = $page.functions.getMissingPpmPostingRows(map, {
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
        }

        // Process Audit Trail
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
    }
  }

  return loadConfigSettingsChain;
});
