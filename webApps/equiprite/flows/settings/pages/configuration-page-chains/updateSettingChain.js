define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/configurationInventory',
], (ActionChain, Actions, inv) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/updateSettingChain.js. Stages one global
  // setting in changedRows for Save changes; nothing is written here. Every guard is the old chain's:
  //   init-event guard        a value equal to the current one records nothing
  //   last module standing    PROJECTS / CUSTOMERS module: one must stay on
  //   PPM needs timesheets    PPM_RATES_ENABLED on needs TIMESHEETS_ENABLED on, and timesheets cannot go off under it
  //   PPM posting labels      switching PPM on also stages the posting labels never saved (getMissingPpmPostingRows)
  // What changed for New EquipRite:
  //   - the key comes as a parameter (a button's data-key), and the category / description a never-saved key is
  //     POSTed with come from resources/js/configurationInventory.js, which holds the old data-setting-category /
  //     data-setting-description attributes verbatim (the old chain read them off the DOM element);
  //   - setting a value back to what is stored drops the pending entry instead of re-saving the same value;
  //   - the on-screen copies the old two-way bindings kept (PpmTxnSourceSel, EnableQuotesSel…) are kept in step;
  //   - a read-only page (EQR_CONFIGURATIONS READ_ONLY) stages nothing.
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
      if (!settingKey || $page.variables.readOnly) return;

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
          await Actions.fireNotificationEvent(context, {
            summary: 'At least one module must stay enabled',
            message: 'Turning this off would disable every module and leave no '
              + 'landing page. Enable the other module first.',
            displayMode: 'transient',
            type: 'error'
          });
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
        await Actions.fireNotificationEvent(context, {
          summary, message, displayMode: 'transient', type: 'error'
        });
        $page.variables.ConfigSettingsMap = Object.assign({}, currentMap);
      };

      if (settingKey === 'PPM_RATES_ENABLED' && convertedValue === 'true'
          && effectiveSetting('TIMESHEETS_ENABLED') !== 'true') {
        await refuse('Timesheets must be on first',
          'Fusion PPM Rates needs timesheets: an approved timesheet is what sends '
          + 'hours to Fusion for pricing. Turn Timesheets on, then enable this.');
        return;
      }

      if (settingKey === 'TIMESHEETS_ENABLED' && convertedValue === 'false'
          && effectiveSetting('PPM_RATES_ENABLED') === 'true') {
        await refuse('Fusion PPM Rates depends on timesheets',
          'Turning timesheets off would leave nothing to send hours to Fusion, and '
          + 'cost would stop posting without any error. Turn Fusion PPM Rates off first.');
        return;
      }
      // ────────────────────────────────────────────────────────────────────

      // Update ConfigSettingsMap in memory (immutable pattern)
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
        const missing = $page.functions.getMissingPpmPostingRows(currentMap, {
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

      // Mark page as dirty
      $page.variables.hasChanges = Object.keys(updatedChanged).length > 0;
    }
  }

  return updateSettingChain;
});
