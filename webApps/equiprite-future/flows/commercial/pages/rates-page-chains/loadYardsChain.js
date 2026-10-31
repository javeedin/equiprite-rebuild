define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/rateRules',
], (ActionChain, Actions, R) => {
  'use strict';

  // The Equipment Yard choices for the schedule's Yard tag: New EquipRite's loadYardsChain (the old LoadYardsChain),
  // unchanged. One call, GET /bu-org-mappings?isActiveFlag=Y&orgRole=EQUIPMENT_YARD; the role is re-checked here, an
  // org mapped under several business units appears once (yardOrgId stores the Fusion org id), sorted by name. Yards
  // whose every business unit takes Fusion PPM rates are left out, except the one the schedule already holds. A saved
  // yard that is no longer a mapped, active Equipment Yard is cleared, so the field never shows a value its options
  // lack.
  class loadYardsChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      let yards = [];

      try {
        const res = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getBuOrgMappings',
          uriParams: { isActiveFlag: 'Y', orgRole: 'EQUIPMENT_YARD' }
        });

        if (res && res.ok) {
          const seen = new Set();
          const yardBus = new Map();
          ((res.body && res.body.data) || []).forEach((r) => {
            if (r.orgRole !== 'EQUIPMENT_YARD') return;
            if (r.isActiveFlag === 'N') return;
            if (r.invOrgId == null) return;
            const id = Number(r.invOrgId);
            if (r.businessUnitId != null) {
              yardBus.set(id, (yardBus.get(id) || []).concat([r.businessUnitId]));
            }
            if (seen.has(id)) return;
            seen.add(id);
            yards.push({
              invOrgId:       id,
              invOrgName:     r.invOrgName || String(id),
              invOrgCode:     r.invOrgCode || '',
              businessUnitId: r.businessUnitId != null ? Number(r.businessUnitId) : null,
              buName:         r.buName || ''
            });
          });
          yards.sort((a, b) => a.invOrgName.localeCompare(b.invOrgName));

          const av = $application.variables;
          const savedYard = $page.variables.formData && $page.variables.formData.yardOrgId != null
            ? Number($page.variables.formData.yardOrgId)
            : null;
          yards = yards.filter((y) => {
            if (y.invOrgId === savedYard) return true;
            const bus = yardBus.get(y.invOrgId) || [];
            return !bus.length || !bus.every((bu) => R.usesPpmRates(av.featureFlags, av.flagsLoaded, av.buRateSources, bu));
          });
        } else {
          console.warn('[loadYardsChain] yard lookup failed');
        }
      } catch (e) {
        console.warn('[loadYardsChain] yard lookup error', e);
      }

      $page.variables.yardOptions = yards;

      const current = $page.variables.formData && $page.variables.formData.yardOrgId != null
        ? Number($page.variables.formData.yardOrgId)
        : null;
      const match = current != null ? yards.find((y) => y.invOrgId === current) : null;

      if (current != null && !match) {
        console.warn('[loadYardsChain] saved yard is not a mapped Equipment Yard, clearing:', current);
      }
      if (!match) {
        $page.variables.formData = Object.assign({}, $page.variables.formData, { yardOrgId: null, yardOrgName: null });
      } else {
        $page.variables.formData = Object.assign({}, $page.variables.formData, { yardOrgName: match.invOrgName });
      }
    }
  }

  return loadYardsChain;
});
