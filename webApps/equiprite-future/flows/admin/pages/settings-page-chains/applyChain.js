define([
  'vb/action/actionChain',
  'resources/js/settingsKit',
  'resources/js/nav',
  'resources/js/rules',
], (ActionChain, kit, nav, rules) => {
  'use strict';

  // What the page shows, worked out once per change: the settings rows (New's rows(): value, what it needs and
  // whether that is met, what it affects, changed or not), what Save would change (values from and to, and what the
  // menu shows and hides afterwards, from Next's own menu with the flags as they would be), the business units, the
  // editor's fields and changes (and whether Rates would leave or come back to the menu), the change history.
  class applyChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const v = $page.variables;
      const av = $application.variables;
      const map = v.ConfigSettingsMap || {};
      const sections = kit.settingSections(map, v.StoredSettingsMap, v.changedRows, v.q, v.readOnly);
      const before = nav.visibleGroups(av.pageAccessMap, av.pageAccessLoaded, av.featureFlags, av.flagsLoaded, av.buRateSources);
      const after = nav.visibleGroups(av.pageAccessMap, av.pageAccessLoaded, kit.flagsAfter(av.featureFlags, v.changedRows), av.flagsLoaded, av.buRateSources);
      const pending = kit.pending(v.changedRows, v.StoredSettingsMap, before, after);

      let buFields = [];
      let buChanges = [];
      let buMenu = '';
      if (v.isEsDrawerOpen) {
        const draft = v.EsDraft || {};
        const row = (v.EsSettingsByBuArray || []).find((r) => String(r.buId) === String(draft.buId)) || {};
        buFields = kit.buFields(draft);
        buChanges = kit.buChanges(draft, row, map);
        if (draft.RATE_SOURCE === 'EQUIPRITE_RATES' || draft.RATE_SOURCE === 'PPM_RATES') {
          const sources = Object.assign({}, av.buRateSources || {});
          const was = rules.isRateManagementHidden(av.featureFlags, av.flagsLoaded, sources);
          sources[String(draft.buId)] = draft.RATE_SOURCE;
          const will = rules.isRateManagementHidden(av.featureFlags, av.flagsLoaded, sources);
          if (was !== will) {
            buMenu = will ? 'Rates will leave the menu: no business unit would price from EquipRite rate schedules.'
              : 'Rates will come back to the menu: this business unit would price from EquipRite rate schedules.';
          }
        }
      }

      v.vm = {
        sections,
        pending,
        bu: kit.buRows(v.EsSettingsByBuArray, map),
        buFields,
        buChanges,
        buMenu,
        history: kit.historyRows(v.AuditTrailAllArray, v.hq),
      };
    }
  }

  return applyChain;
});
