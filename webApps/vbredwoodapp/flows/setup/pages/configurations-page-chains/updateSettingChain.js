define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class updateSettingChain extends ActionChain {
    /**
     * @param {object} context
     * @param {object} params
     * @param {string} params.settingKey  - The setting key (e.g. "PROJECTS_MODULE_ENABLED")
     * @param {*}      params.value       - The new value (boolean from oj-switch or string from oj-input-text)
     * @param {Event}  params.event       - The raw DOM event (used to extract settingKey when not passed directly)
     */
    async run(context, params) {
      const { $page } = context;
      let { settingKey, value, event } = params;

      // ─── SETTING KEY / CATEGORY EXTRACTION ───────────────────────────────
      // If settingKey was not passed directly, extract from the triggering
      // element's data-setting-key (+ data-setting-category) attributes via
      // the DOM event. Category is only ever needed for the POST-a-brand-new-
      // row path (saveChangesChain) — ConfigSettingsMap never carries category
      // for existing rows, so a never-before-saved key has nowhere else to get it.
      let settingCategory;
      let settingDescription;
      if (!settingKey && event && event.target) {
        settingKey = event.target.dataset && event.target.dataset.settingKey;
        settingCategory = event.target.dataset && event.target.dataset.settingCategory;
        settingDescription = event.target.dataset && event.target.dataset.settingDescription;
      }
      // Fallback: walk up the DOM tree to find the closest element with the attribute
      if (!settingKey && event && event.target) {
        const el = event.target.closest ? event.target.closest('[data-setting-key]') : null;
        if (el) {
          settingKey = el.dataset.settingKey;
          settingCategory = el.dataset.settingCategory;
          settingDescription = el.dataset.settingDescription;
        }
      }

      if (!settingKey) return;

      // ─── INIT EVENT GUARD ───────────────────────────────────────────────
      // oj-switch fires on-value-changed during table population (init event).
      // Convert the incoming value to a canonical string for comparison.
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

      // If the setting already exists in the DB and the incoming value matches
      // the stored value AND we have not yet recorded a pending change for this key,
      // this is an init event fired by oj-switch during table population — skip it.
      // NOTE: If existingEntry is undefined (new / un-seeded setting), we always
      // proceed so that first-time toggles are correctly captured and POSTed.
      if (existingEntry && convertedValue === storedValue && !alreadyTracked) {
        return;
      }
      // ────────────────────────────────────────────────────────────────────

      // ─── LAST-MODULE-STANDING GUARD ─────────────────────────────────────
      // PROJECTS_MODULE_ENABLED and CUSTOMERS_MODULE_ENABLED each own one of the
      // two landing pages, so switching BOTH off leaves the app with no reachable
      // home — see getHomeTarget() in app-flow.js. Enforce the invariant at the
      // source rather than coping with the broken state downstream: refuse the
      // toggle that would turn off the last enabled module.
      //
      // Reads the OTHER module's pending value first (changedRows) so two
      // unsaved toggles in one sitting can't slip through — the map alone would
      // still show the stale 'true'.
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
          // Revert the switch: reassigning the map rebinds oj-switch to the
          // unchanged stored value, so the UI snaps back.
          $page.variables.ConfigSettingsMap = Object.assign({}, currentMap);
          return;
        }
      }
      // ─── PPM REQUIRES TIMESHEETS ────────────────────────────────────────
      // PPM_RATES_ENABLED may only be on while TIMESHEETS_ENABLED is on (R16).
      // Under PPM, EquipRite calculates no rental cost and the Post Cost screen
      // is withdrawn — the approved timesheet IS the delivery mechanism, the
      // only thing that produces a quantity for Fusion to price. Turn PPM on
      // with timesheets off and the app looks entirely healthy while posting
      // nothing, forever, with no error anywhere to find.
      //
      // Guarded in BOTH directions, because either toggle can create the
      // invalid pair: switching PPM on, or switching timesheets off underneath
      // it. Reads the other flag's PENDING value first, exactly as the module
      // guard above does — the stored map alone would miss a second unsaved
      // toggle made in the same sitting.
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
        // Reassigning the map rebinds the switch to its unchanged stored value,
        // so the UI snaps back — same revert as the module guard.
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

      // Record in changedRows for save. businessUnitId is null unless the
      // existing row already carries one — these are all global toggles with
      // no BU picker on this tab, so a brand-new row is BU-agnostic (the
      // column is nullable; there is no "default BU" for a global setting).
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

      updatedChanged[settingKey] = {
        id: (existingEntry && existingEntry.id) || null,
        settingValue: convertedValue,
        businessUnitId: (existingEntry && existingEntry.businessUnitId) || null,
        settingCategory: (existingEntry && existingEntry.settingCategory) || settingCategory || null,
        description: (existingEntry && existingEntry.description) || settingDescription || null
      };
      $page.variables.changedRows = updatedChanged;

      // Mark page as dirty
      $page.variables.hasChanges = true;
    }
  }

  return updateSettingChain;
});
