define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class saveChangesChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const changedRows = $page.variables.changedRows;
      const buSettingsDirty = $page.variables.buSettingsDirty;

      // NOTE: BU & Org Mapping persists immediately on Add/Delete (its own
      // upsert-by-BU PUT), so it is intentionally NOT handled here.
      const changedKeys = Object.keys(changedRows);
      if (changedKeys.length === 0 && !buSettingsDirty) {
        console.info('saveChangesChain: No settings changes to save.');
        return;
      }

      $page.variables.isSaving = true;
      $page.variables.saveError = '';

      const failedKeys = [];

      // ─── Save global settings (changedRows) ──────────────────────────────
      for (const key of changedKeys) {
        const entry = changedRows[key];
        try {
          let saveResult;
          if (entry.id) {
            console.info(`saveChangesChain: Updating existing setting [${key}] with id [${entry.id}]`);
            saveResult = await Actions.callRest(context, {
              endpoint: 'eqp-v1/patchConfGlobalSettingsById',
              uriParams: { id: entry.id },
              body: { settingValue: entry.settingValue }
            });
          } else {
            console.info(`saveChangesChain: No id found for key [${key}] — creating new global setting via POST.`);
            // POST /conf-global-settings body: settingKey, settingValue,
            // settingCategory, isActiveFlag, description. Global settings have NO
            // businessUnitId — the dedicated table isn't BU-scoped.
            //
            // settingCategory / description: ConfigSettingsMap never carries these
            // for existing rows, so a never-before-saved key has nowhere else to
            // get them — threaded through from the triggering element's
            // data-setting-category / data-setting-description attributes instead
            // (see updateSettingChain.js).
            //
            // createdBy / lastUpdatedBy: not in the documented body, but NOT NULL
            // on EQR_CONF_GLOBAL_SETTING. The DB DEFAULTs them to 'SYSTEM', but the
            // equipment-settings path proved the backend sends null when the field
            // is absent (ORA-01400), so we pass them explicitly to be safe.
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
          }

          if (!saveResult.ok) {
            console.error(`saveChangesChain: Failed to save key [${key}]`, saveResult.statusCode);
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
        // Success — clear dirty state
        $page.variables.changedRows = {};
        $page.variables.hasChanges = false;
        $page.variables.buSettingsDirty = false;
        console.info('saveChangesChain: All changes saved successfully.');

        // Reload to sync any server-side changes
        await Actions.callChain(context, {
          chain: 'loadConfigSettingsChain'
        });

        // Refresh the app-level feature-flags cache so a just-saved flag (e.g.
        // AGREEMENTS_ENABLED) takes effect immediately in this session. Gating
        // chains (agreementsFlagGuardChain, isFeatureEnabled()) read
        // $application.variables.featureFlags, which loadFeatureFlagsChain only
        // populates once on app vbEnter — without this refresh a save here would
        // persist to the DB but the running app would keep enforcing the stale
        // value until a full reload. Inlined (not callChain'd to the app flow's
        // chain) since cross-flow callChain isn't a supported pattern here; the
        // fetch+filter mirrors loadFeatureFlagsChain exactly so both stay in sync.
        try {
          const { $application } = context;
          // size: 500 — the endpoint is paginated (Spring default 20) and the
          // table holds 23 rows, so without it page 0 silently dropped
          // TIMESHEETS_ENABLED and the session treated timesheets as OFF after
          // any save here. Same explicit size as loadFeatureFlagsChain.
          const flagsResult = await Actions.callRest(context, {
            endpoint:  'eqp-v1/getConfGlobalSettings',
            uriParams: { size: 500 }
          });
          if (flagsResult && flagsResult.ok) {
            const flagRows = (flagsResult.body && flagsResult.body.data) || [];
            const flagMap = {};
            // SYSTEM-category settings (ENABLE_QUOTES, …) ride along in their own
            // map so a just-saved quote mode takes effect in this session too.
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

        // Show success notification
        await Actions.fireNotificationEvent(context, {
          summary: 'Changes Saved',
          message: 'All configuration settings have been updated successfully.',
          displayMode: 'transient',
          type: 'confirmation'
        });
      } else {
        // Partial failure — keep changedRows so user can retry
        $page.variables.saveError =
          'Some settings could not be saved: ' + failedKeys.join(', ') +
          '. Please try again.';
        console.error('saveChangesChain: Failed keys:', failedKeys);
      }
    }
  }

  return saveChangesChain;
});
