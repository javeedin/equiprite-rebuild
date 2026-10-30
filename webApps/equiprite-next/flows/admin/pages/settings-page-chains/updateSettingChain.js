define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/configurationInventory',
  'resources/js/settingsKit',
  'resources/js/shellBus',
], (ActionChain, Actions, inv, kit, bus) => {
  'use strict';

  // New EquipRite's updateSettingChain (from Old's), every guard unchanged. Stages one global setting in changedRows
  // for Save; nothing is written here.
  //   init-event guard        a value equal to the current one records nothing
  //   last module standing    PROJECTS / CUSTOMERS module: one must stay on
  //   PPM needs timesheets    PPM_RATES_ENABLED on needs TIMESHEETS_ENABLED on, and timesheets cannot go off under it
  //   PPM posting labels      switching PPM on also stages the posting labels never saved (getMissingPpmPostingRows)
  //   back to the stored value drops the pending entry; a read-only page stages nothing.
  // Differences for Next: a refusal is a toast through the shell (shellBus) rather than fireNotificationEvent, and
  // nothing is staged while the settings failed to load (an empty map would turn every change into a new row).
  const SEL = {
    PPM_TXN_SOURCE: 'PpmTxnSourceSel',
    PPM_DOCUMENT: 'PpmDocumentSel',
    PPM_DOC_ENTRY: 'PpmDocEntrySel',
    PPM_EXPENDITURE_ORG: 'PpmExpenditureOrgSel',
    ENABLE_QUOTES: 'EnableQuotesSel',
    WEEK_END_DAY: 'WeekEndDaySel',
  };

  class updateSettingChain extends ActionChain {
    /**
     * @param {object} context
     * @param {object} params
     * @param {string} params.settingKey  - The setting key (e.g. "PROJECTS_MODULE_ENABLED")
     * @param {*}      params.value       - boolean for a switch, string for a choice or a text field
     */
    async run(context, params) {
      const { $page } = context;
      const { settingKey } = params || {};
      let { value } = params || {};
      if (!settingKey || $page.variables.readOnly || $page.variables.loadError) return;

      const def = inv.BY_KEY[settingKey] || {};
      const settingCategory = def.category || (params && params.settingCategory) || null;
      const settingDescription = def.description || (params && params.settingDescription) || null;

      // A switch's data-on attribute arrives as the string 'true' / 'false' from the binding.
      if (def.kind === 'flag' && (value === 'true' || value === 'false')) {
        value = value === 'true';
      }

      // ─── INIT EVENT GUARD ───────────────────────────────────────────────
      let convertedValue;
      if (typeof value === 'boolean') {
        convertedValue = value ? 'true' : 'false';
      } else {
        convertedValue = (value === null || value === undefined) ? '' : String(value);
      }

      const currentMap = $page.variables.ConfigSettingsMap || {};
      const existingEntry = currentMap[settingKey];
      const alreadyTracked = $page.variables.changedRows[settingKey] !== undefined;

      const storedValue = existingEntry ? existingEntry.settingValue : undefined;

      if (existingEntry && convertedValue === storedValue && !alreadyTracked) {
        return;
      }
      // ────────────────────────────────────────────────────────────────────

      // ─── LAST-MODULE-STANDING GUARD ─────────────────────────────────────
      const MODULE_PAIR = {
        PROJECTS_MODULE_ENABLED: 'CUSTOMERS_MODULE_ENABLED',
        CUSTOMERS_MODULE_ENABLED: 'PROJECTS_MODULE_ENABLED'
      };
      const otherKey = MODULE_PAIR[settingKey];
      if (otherKey && convertedValue === 'false') {
        const pendingOther = $page.variables.changedRows[otherKey];
        const otherEntry = currentMap[otherKey];
        const otherValue = pendingOther
          ? pendingOther.settingValue
          : (otherEntry ? otherEntry.settingValue : undefined);

        if (otherValue !== 'true') {
          bus.toast('At least one module must stay on. Turning this off would switch off every module and leave no screen to land on: turn the other module on first.', 'error');
          $page.variables.ConfigSettingsMap = Object.assign({}, currentMap);
          return;
        }
      }
      // ─── PPM REQUIRES TIMESHEETS ────────────────────────────────────────
      const effectiveSetting = (key) => {
        const pending = $page.variables.changedRows[key];
        if (pending) { return pending.settingValue; }
        const entry = currentMap[key];
        return entry ? entry.settingValue : undefined;
      };

      const refuse = async (summary, message) => {
        bus.toast(summary + '. ' + message, 'error');
        $page.variables.ConfigSettingsMap = Object.assign({}, currentMap);
      };

      if (settingKey === 'PPM_RATES_ENABLED' && convertedValue === 'true'
          && effectiveSetting('TIMESHEETS_ENABLED') !== 'true') {
        await refuse('Timesheets must be on first',
          'Fusion PPM rates needs timesheets: an approved timesheet is what sends '
          + 'hours to Fusion for pricing. Turn Timesheets on, then this.');
        return;
      }

      if (settingKey === 'TIMESHEETS_ENABLED' && convertedValue === 'false'
          && effectiveSetting('PPM_RATES_ENABLED') === 'true') {
        await refuse('Fusion PPM rates depends on timesheets',
          'Turning timesheets off would leave nothing to send hours to Fusion, and '
          + 'cost would stop posting without any error. Turn Fusion PPM rates off first.');
        return;
      }
      // ────────────────────────────────────────────────────────────────────

      const updatedMap = Object.assign({}, currentMap);
      updatedMap[settingKey] = Object.assign({}, updatedMap[settingKey] || {}, {
        settingValue: convertedValue
      });
      $page.variables.ConfigSettingsMap = updatedMap;
      if (SEL[settingKey]) {
        $page.variables[SEL[settingKey]] = convertedValue;
      }

      const updatedChanged = Object.assign({}, $page.variables.changedRows);

      // Switching PPM on reveals the three posting labels with on-screen
      // defaults; save those too, or the queue view has nothing to read.
      if (settingKey === 'PPM_RATES_ENABLED' && convertedValue === 'true') {
        const missing = kit.getMissingPpmPostingRows(currentMap, {
          txnSource: $page.variables.PpmTxnSourceSel,
          document: $page.variables.PpmDocumentSel,
          docEntry: $page.variables.PpmDocEntrySel
        });
        Object.keys(missing).forEach(function (k) {
          if (updatedChanged[k] === undefined) updatedChanged[k] = missing[k];
        });
      }

      const loaded = ($page.variables.StoredSettingsMap || {})[settingKey];
      if (loaded && loaded.id && String(loaded.settingValue == null ? '' : loaded.settingValue) === convertedValue) {
        // Back to what the database holds: nothing to save for this key.
        delete updatedChanged[settingKey];
      } else {
        updatedChanged[settingKey] = {
          id: (existingEntry && existingEntry.id) || null,
          settingValue: convertedValue,
          businessUnitId: (existingEntry && existingEntry.businessUnitId) || null,
          settingCategory: (existingEntry && existingEntry.settingCategory) || settingCategory || null,
          description: (existingEntry && existingEntry.description) || settingDescription || null
        };
      }
      $page.variables.changedRows = updatedChanged;

      $page.variables.hasChanges = Object.keys(updatedChanged).length > 0;
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return updateSettingChain;
});
