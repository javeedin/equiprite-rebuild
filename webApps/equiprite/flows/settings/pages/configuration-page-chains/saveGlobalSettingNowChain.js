define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/saveGlobalSettingNowChain.js, unchanged.

  // Saves ONE global setting immediately (conf-global-settings), for controls on
  // tabs without a Save Changes button. PATCH when the row exists (id from
  // ConfigSettingsMap), POST to create it otherwise -- same rules as
  // saveChangesChain. Keeps ConfigSettingsMap in step so the next save PATCHes.
  //
  // Params: settingKey, settingValue, description (used only when creating).
  // Returns { saved: true } on a real save, { saved: false } when there was
  // nothing to save (value equals what is stored -- e.g. the value-changed fired
  // while seeding), and THROWS on failure so the caller can restore its picker.
  class saveGlobalSettingNowChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const { settingKey, description } = params || {};
      const value = String((params && params.settingValue) || '');
      const map = $page.variables.ConfigSettingsMap || {};
      const entry = map[settingKey];

      if (entry && String(entry.settingValue || '') === value) return { saved: false };
      if (!entry && !value) return { saved: false };

      const result = entry && entry.id
        ? await Actions.callRest(context, {
            endpoint: 'eqp-v1/patchConfGlobalSettingsById',
            uriParams: { id: entry.id },
            body: { settingValue: value }
          })
        : await Actions.callRest(context, {
            endpoint: 'eqp-v1/postConfGlobalSettings',
            body: {
              settingKey: settingKey,
              settingValue: value,
              settingCategory: 'SYSTEM',
              isActiveFlag: 'Y',
              description: description || null,
              // NOT NULL with no backend default -- see saveChangesChain.
              createdBy: 'EQUIPRITE',
              lastUpdatedBy: 'EQUIPRITE'
            }
          });

      if (!result.ok) {
        const detail = (result.body && result.body.detail)
          || (result.body && JSON.stringify(result.body))
          || ('status ' + result.statusCode);
        throw new Error(detail);
      }

      const saved = result.body || {};
      $page.variables.ConfigSettingsMap = {
        ...map,
        [settingKey]: {
          id: saved.id || (entry && entry.id) || null,
          settingValue: value,
          businessUnitId: null
        }
      };
      return { saved: true };
    }
  }

  return saveGlobalSettingNowChain;
});
