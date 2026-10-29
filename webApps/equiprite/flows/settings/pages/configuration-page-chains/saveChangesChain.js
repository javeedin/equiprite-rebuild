define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/saveChangesChain.js. Same writes in the same
  // order: one call per staged key, in the order the keys were staged —
  //   stored row  PATCH eqp-v1/patchConfGlobalSettingsById { settingValue }
  //   new key     POST  eqp-v1/postConfGlobalSettings { settingKey, settingValue, settingCategory, isActiveFlag: 'Y',
  //               description, createdBy: 'EQUIPRITE', lastUpdatedBy: 'EQUIPRITE' }
  // then, when all succeed, reload the page (loadConfigSettingsChain) and refresh the app's featureFlags /
  // globalSettings so the menu and every gate follow at once.
  // One change for New EquipRite: on a partial failure only the keys that failed stay pending (the old chain kept
  // them all, so a retry re-POSTed rows that had just been created). A key that was created gets its new id, so
  // changing it again PATCHes it.
  class saveChangesChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const changedRows = $page.variables.changedRows;
      const buSettingsDirty = $page.variables.buSettingsDirty;

      const changedKeys = Object.keys(changedRows);
      if (changedKeys.length === 0 && !buSettingsDirty) {
        console.info('saveChangesChain: No settings changes to save.');
        return;
      }
      if ($page.variables.isSaving) return;

      $page.variables.isSaving = true;
      $page.variables.saveError = '';

      const failedKeys = [];
      const createdIds = {};

      // ─── Save global settings (changedRows) ──────────────────────────────
      for (const key of changedKeys) {
        const entry = changedRows[key];
        try {
          let saveResult;
          if (entry.id) {
            saveResult = await Actions.callRest(context, {
              endpoint: 'eqp-v1/patchConfGlobalSettingsById',
              uriParams: { id: entry.id },
              body: { settingValue: entry.settingValue }
            });
          } else {
            saveResult = await Actions.callRest(context, {
              endpoint: 'eqp-v1/postConfGlobalSettings',
              body: {
                settingKey: key,
                settingValue: entry.settingValue,
                settingCategory: entry.settingCategory || null,
                isActiveFlag: 'Y',
                description: entry.description || null,
                createdBy: 'EQUIPRITE',
                lastUpdatedBy: 'EQUIPRITE'
              }
            });
            if (saveResult && saveResult.ok && saveResult.body && saveResult.body.id != null) {
              createdIds[key] = saveResult.body.id;
            }
          }

          if (!saveResult || !saveResult.ok) {
            console.error(`saveChangesChain: Failed to save key [${key}]`, saveResult && saveResult.statusCode);
            failedKeys.push(key);
          }
        } catch (err) {
          console.error('saveChangesChain: Exception saving key', key, err);
          failedKeys.push(key);
        }
      }

      $page.variables.isSaving = false;

      // ─── Handle outcomes ─────────────────────────────────────────────────
      if (failedKeys.length === 0) {
        $page.variables.changedRows = {};
        $page.variables.hasChanges = false;
        $page.variables.buSettingsDirty = false;

        // Reload to sync any server-side changes
        await Actions.callChain(context, {
          chain: 'loadConfigSettingsChain'
        });

        // Refresh the app-level feature-flags cache so a just-saved flag takes effect in this session (the
        // menu reads it). The fetch + filter mirror loadFeatureFlagsChain exactly, as in the old chain.
        try {
          const { $application } = context;
          const flagsResult = await Actions.callRest(context, {
            endpoint:  'eqp-v1/getConfGlobalSettings',
            uriParams: { size: 500 }
          });
          if (flagsResult && flagsResult.ok) {
            const flagRows = (flagsResult.body && flagsResult.body.data) || [];
            const flagMap = {};
            const globalMap = {};
            flagRows.forEach(function (r) {
              if (!r || r.settingKey == null) return;
              if (r.isActiveFlag === 'N') return;
              if (r.settingCategory === 'SYSTEM') {
                globalMap[r.settingKey] = r.settingValue != null ? String(r.settingValue) : '';
                return;
              }
              if (r.settingCategory !== 'FEATURE_FLAG') return;
              flagMap[r.settingKey] = r.settingValue != null ? String(r.settingValue) : '';
            });
            $application.variables.featureFlags = flagMap;
            $application.variables.globalSettings = globalMap;
            $application.variables.flagsLoaded = true;
          }
        } catch (e) {
          console.error('saveChangesChain: failed to refresh app-level feature flags', e);
        }

        await Actions.fireNotificationEvent(context, {
          summary: 'Changes Saved',
          message: 'All configuration settings have been updated successfully.',
          displayMode: 'transient',
          type: 'confirmation'
        });
      } else {
        // Partial failure: keep only what failed, so a retry does not write the saved keys twice.
        const keep = {};
        failedKeys.forEach(function (k) { keep[k] = changedRows[k]; });
        $page.variables.changedRows = keep;
        $page.variables.hasChanges = true;
        const map = Object.assign({}, $page.variables.ConfigSettingsMap || {});
        Object.keys(createdIds).forEach(function (k) {
          map[k] = Object.assign({}, map[k] || {}, { id: createdIds[k] });
        });
        $page.variables.ConfigSettingsMap = map;
        $page.variables.saveError =
          'Some settings could not be saved: ' + failedKeys.join(', ') +
          '. Please try again.';
        console.error('saveChangesChain: Failed keys:', failedKeys);
      }
    }
  }

  return saveChangesChain;
});
