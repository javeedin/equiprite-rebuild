define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Loads the Equipment Yard list for the Yard picker — one call, no cascade.
  //
  // Replaces LoadBuListChain + RescopeBuChain, which took THREE calls to fill a
  // two-item dropdown: the configured BU list, that BU's mapped orgs, and then
  // all ~345 rows of EQR_INV_ORG purely to translate a Fusion org id into the
  // local EQR_INV_ORG PK, because YARD_ORG_ID used to store the local PK.
  //
  // That translation is gone. EQR_BU_ORG_MAPPING.INV_ORG_ID holds the FUSION org
  // id, and every yard-aware view in the schema already joins on it:
  //   EQR_V_YARD_STOCK / EQR_V_YARD_UTILIZATION / EQR_V_ONHAND_QTY /
  //   EQR_RATE_EXCEPTION_V  ->  org.INV_ORG_ID = <table>.EQP_INV_ORG_ID
  // EQR_INV_ORG, by contrast, is referenced by no view and no PL/SQL — it is
  // read only by the frontend. So storing the Fusion id puts the rate schedule
  // in the same id space as the rest of the system rather than the odd one out.
  //
  // The BU picker is gone too: BU was never persisted (there is no BU column on
  // EQR_RATE_SCHEDULE) and every mapping row carries businessUnitId/buName, so
  // it stays derivable from whichever yard is chosen.
  class LoadYardsChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      let yards = [];

      try {
        // orgRole IS a declared query param on this endpoint, despite the older
        // chains asserting otherwise and filtering purely client-side. Ask the
        // server to narrow it, but keep the client-side check below — a param
        // being in the spec is not proof the backend honours it, and silently
        // offering VIRTUAL_PROJECT / VIRTUAL_CUSTOMER orgs as yards would be worse
        // than an extra comparison.
        const res = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getBuOrgMappings',
          uriParams: { isActiveFlag: 'Y', orgRole: 'EQUIPMENT_YARD' }
        });

        if (res && res.ok) {
          // De-duplicate by invOrgId. One org can be mapped under several BUs,
          // which is why every view in the schema wraps this table in a
          // SELECT DISTINCT INV_ORG_ID — the same org must not appear twice in
          // the picker.
          const seen = new Set();
          // Every BU each yard is mapped under, for the PPM filter below.
          const yardBus = new Map();
          (res.body.data || []).forEach(r => {
            if (r.orgRole !== 'EQUIPMENT_YARD') return;   // backstop, see above
            if (r.isActiveFlag === 'N') return;
            if (r.invOrgId == null) return;
            const id = Number(r.invOrgId);
            if (r.businessUnitId != null) {
              yardBus.set(id, (yardBus.get(id) || []).concat([r.businessUnitId]));
            }
            if (seen.has(id)) return;
            seen.add(id);
            yards.push({
              invOrgId:       id,                          // FUSION org id -> YARD_ORG_ID
              invOrgName:     r.invOrgName || String(id),
              invOrgCode:     r.invOrgCode || '',
              businessUnitId: r.businessUnitId != null ? Number(r.businessUnitId) : null,
              buName:         r.buName || ''
            });
          });
          yards.sort((a, b) => a.invOrgName.localeCompare(b.invOrgName));

          // Leave out yards whose every BU takes Fusion PPM rates (usesPpmRates):
          // a schedule there would never be used. The yard a schedule being
          // edited already holds is kept, so editing never silently clears it.
          const { $application } = context;
          const savedYard = $page.variables.formData && $page.variables.formData.yardOrgId != null
            ? Number($page.variables.formData.yardOrgId)
            : null;
          yards = yards.filter(y => {
            if (y.invOrgId === savedYard) return true;
            const bus = yardBus.get(y.invOrgId) || [];
            return !bus.length || !bus.every(bu => $application.functions.usesPpmRates(
              $application.variables.featureFlags, $application.variables.flagsLoaded,
              $application.variables.buRateSources, bu));
          });
        } else {
          console.warn('[create-rate-schedule LoadYardsChain] yard lookup failed');
        }
      } catch (e) {
        console.warn('[create-rate-schedule LoadYardsChain] yard lookup error', e);
      }

      $page.variables.yardOrgArray = yards;

      // Edit mode: keep the saved yard only if it is still a mapped, active
      // Equipment Yard, so the field can never display a value that is not in
      // its own option list. Schedules saved before this change hold a local
      // EQR_INV_ORG PK rather than a Fusion org id and will not match — that is
      // the intended outcome, since those ids point at orgs that were never
      // marked as yards.
      const current = $page.variables.formData && $page.variables.formData.yardOrgId != null
        ? Number($page.variables.formData.yardOrgId)
        : null;
      const match = current != null ? yards.find(y => y.invOrgId === current) : null;

      if (current != null && !match) {
        console.warn('[create-rate-schedule LoadYardsChain] saved yard is not a mapped Equipment Yard, clearing:', current);
      }
      if (!match) {
        $page.variables.formData.yardOrgId = null;
        $page.variables.formData.yardOrgName = null;
      } else {
        $page.variables.formData.yardOrgName = match.invOrgName;
      }
    }
  }

  return LoadYardsChain;
});
