
define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class RateScheduleInitChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const response = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getRateSchedules',
      });

      if (!response.ok) {
        console.warn('[RateScheduleInitChain] Failed to load rate schedules:', response.status);
        $page.variables.RequestAllArray = [];
        $page.variables.RequestFilteredArray = [];
        return;
      }

      const raw = response.body.data ?? [];

      // The YARD column used to render "—" for every row: it read
      // record.yardOrgName, but RateScheduleDto exposes only yardOrgId — there
      // is no name field on the DTO and no yard-name column on
      // EQR_RATE_SCHEDULE (unlike PROJECT_NAME / TASK_NAME, which are
      // denormalized there). Resolve it here instead of asking for a new
      // column: the mapping table is a handful of rows, one call covers the
      // whole list, and a live lookup cannot go stale the way a denormalized
      // copy does when someone renames a yard on the config page.
      const yardNames = new Map();
      // Every BU a yard is mapped under (one org can sit under several), for
      // the "not used — PPM" marker below.
      const yardBus = new Map();
      try {
        const orgResp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getBuOrgMappings',
          uriParams: { isActiveFlag: 'Y', orgRole: 'EQUIPMENT_YARD' }
        });
        if (orgResp && orgResp.ok) {
          (orgResp.body.data || []).forEach(r => {
            // Role re-checked client-side: the server param is declared but
            // unproven, and a VIRTUAL_* org must never be labelled as a yard.
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
        console.warn('[RateScheduleInitChain] yard name lookup failed, showing ids', e);
      }

      // A schedule is unused when every BU its yard belongs to takes PPM rates
      // (usesPpmRates: global flag, else the BU's Rate Source). Marked, not
      // hidden, so nobody thinks it was deleted. No yard or no mapped BU → no
      // marker, since there is nothing to judge it by.
      const { $application } = context;
      const isPpmYard = yardOrgId => {
        const bus = yardOrgId != null ? yardBus.get(Number(yardOrgId)) : null;
        return !!(bus && bus.length) && bus.every(bu => $application.functions.usesPpmRates(
          $application.variables.featureFlags, $application.variables.flagsLoaded,
          $application.variables.buRateSources, bu));
      };

      const mapped = raw.map(record => ({
        id:             record.id,
        scheduleName:   record.scheduleName || '—',
        equipmentClass: record.equipmentClassId ? String(record.equipmentClassId) : '—',
        description:    record.description || '—',
        customer:       record.customerName  || '—',
        project:        record.projectName   || '—',
        task:           record.taskName      || '—',
        // Schedules saved before the yard picker moved to Fusion org ids hold a
        // local EQR_INV_ORG PK, which will not resolve — show the raw id rather
        // than a dash so the mismatch is visible instead of looking like "no yard".
        yard:           record.yardOrgId != null
                          ? (yardNames.get(Number(record.yardOrgId)) || String(record.yardOrgId))
                          : '—',
        ppmUnused:      isPpmYard(record.yardOrgId),
        calcBasis:      record.calcBasis || '—',
        calcMethod:     record.calcMethod || '—',
        status:         record.isActiveFlag === 'Y' ? 'ACTIVE' : 'INACTIVE',
        currency:       record.currencyCode || '—',
        startDate:      record.effectiveFrom ? record.effectiveFrom.slice(0, 10) : '—',
        endDate:        record.effectiveTo ? record.effectiveTo.slice(0, 10) : '—',
      }));

      $page.variables.RequestAllArray = mapped;
      $page.variables.RequestFilteredArray = mapped;
    }
  }

  return RateScheduleInitChain;
});
