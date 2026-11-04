define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/rateRules',
  'resources/js/rateCompare',
  'resources/js/shellBus',
], (ActionChain, Actions, R, RC, bus) => {
  'use strict';

  // Compare rates: the schedules (GET /rate-schedules, the yard names from /bu-org-mappings, as Rates reads them), then
  // what is picked: a schedule handed over by Rates (shellBus.focus, as the base), else what was picked before, else the
  // first three active schedules. Their rates are read by linesChain, which then compares them.
  class loadChain extends ActionChain {
    async run(context, { refresh }) {
      const v = context.$page.variables;
      v.isLoading = true;
      v.error = '';
      try {
        const res = await Actions.callRest(context, { endpoint: 'eqp-v1/getRateSchedules' });
        if (!res || !res.ok) {
          v.error = 'The rate schedules could not be loaded (HTTP ' + (res && res.status) + ').';
          return;
        }
        const yardNames = new Map();
        try {
          const org = await Actions.callRest(context, { endpoint: 'eqp-v1/getBuOrgMappings', uriParams: { isActiveFlag: 'Y', orgRole: 'EQUIPMENT_YARD' } });
          ((org && org.ok && org.body && org.body.data) || []).forEach((r) => {
            if (r.orgRole === 'EQUIPMENT_YARD' && r.invOrgId != null) yardNames.set(Number(r.invOrgId), r.invOrgName || String(r.invOrgId));
          });
        } catch (e) { /* the yard's id is shown instead */ }
        const rows = ((res.body && res.body.data) || []).map((r) => R.scheduleRow(r, yardNames, null));
        v.scheduleRows = rows;
        v.schedules = RC.pickable(rows);
        const known = v.schedules.map((s) => s.id);
        let picked = JSON.parse(JSON.stringify(v.picked || [])).map(String).filter((id) => known.indexOf(id) !== -1);
        const handed = bus.takeFocus('rate-compare');
        if (handed && handed.base && known.indexOf(String(handed.base)) !== -1) picked = RC.makeBase(picked, handed.base);
        if (picked.length < 2) {
          RC.defaultPick(rows, 3).forEach((id) => { if (picked.length < 3 && picked.indexOf(id) === -1) picked.push(id); });
        }
        v.picked = picked;
        if (refresh) v.linesBy = {};
      } finally {
        v.isLoading = false;
      }
      await Actions.callChain(context, { chain: 'linesChain' });
    }
  }

  return loadChain;
});
