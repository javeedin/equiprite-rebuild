define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/rateRules',
], (ActionChain, Actions, R) => {
  'use strict';

  // The list of schedules: New EquipRite's loadSchedulesChain (the old RateScheduleInitChain), call for call:
  //   GET /rate-schedules; then GET /bu-org-mappings?isActiveFlag=Y&orgRole=EQUIPMENT_YARD for the yard names (the DTO
  //   has only yardOrgId) and every business unit each yard sits under, so a schedule whose yard's business units all
  //   take Fusion PPM rates is marked "not used" (usesPpmRates), not hidden. Rows: rateRules.scheduleRow, unchanged.
  // A failed read says so instead of showing an empty list.
  class loadSchedulesChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;

      const response = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getRateSchedules',
      });

      if (!response || !response.ok) {
        console.warn('[loadSchedulesChain] Failed to load rate schedules:', response && response.status);
        $page.variables.schedules = [];
        $page.variables.listError = 'The rate schedules could not be loaded (HTTP ' + (response && response.status) + ').';
        return;
      }

      const raw = (response.body && response.body.data) || [];

      const yardNames = new Map();
      const yardBus = new Map();
      try {
        const orgResp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getBuOrgMappings',
          uriParams: { isActiveFlag: 'Y', orgRole: 'EQUIPMENT_YARD' }
        });
        if (orgResp && orgResp.ok) {
          ((orgResp.body && orgResp.body.data) || []).forEach((r) => {
            // Role re-checked client-side: a VIRTUAL_* org must never be labelled as a yard.
            if (r.orgRole !== 'EQUIPMENT_YARD' || r.invOrgId == null) return;
            yardNames.set(Number(r.invOrgId), r.invOrgName || String(r.invOrgId));
            if (r.businessUnitId != null) {
              const bus = yardBus.get(Number(r.invOrgId)) || [];
              bus.push(r.businessUnitId);
              yardBus.set(Number(r.invOrgId), bus);
            }
          });
        }
      } catch (e) {
        console.warn('[loadSchedulesChain] yard name lookup failed, showing ids', e);
      }

      const av = $application.variables;
      const isPpmYard = (yardOrgId) => {
        const bus = yardOrgId != null ? yardBus.get(Number(yardOrgId)) : null;
        return !!(bus && bus.length) && bus.every((bu) => R.usesPpmRates(av.featureFlags, av.flagsLoaded, av.buRateSources, bu));
      };

      $page.variables.listError = '';
      $page.variables.schedules = raw.map((record) => R.scheduleRow(record, yardNames, isPpmYard));
    }
  }

  return loadSchedulesChain;
});
