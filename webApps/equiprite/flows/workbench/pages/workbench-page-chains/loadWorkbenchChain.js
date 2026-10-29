define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Loads every stage at once, so each tab shows its real count before it is opened. The calls are the old app's:
  //   OUTBOUND, DEPLOYED, INBOUND  old Workbench, WorkbenchInitChain (one call per tab there)
  //   INITIATE                     old Initiate picking, InitPickingQueueChain (the picking queue)
  //   UNDER_PROCUREMENT lines      old Analytics, analyticsData.fetchPending (views/pending-approval-lines with a
  //                                lineStatus); includeAll=Y because the view otherwise keeps to its default
  //                                "actionable" statuses, which do not include UNDER_PROCUREMENT
  // Rows are mapped with WorkbenchInitChain's rules (workbench-page.js mapRequests). Reads only.
  const STAGES = [
    { key: 'outbound', label: 'Outbound', uriParams: { size: 1000, stage: 'OUTBOUND' } },
    { key: 'pick',     label: 'To pick',  uriParams: { stage: 'INITIATE', size: 1000 } },
    { key: 'deployed', label: 'Deployed', uriParams: { size: 1000, stage: 'DEPLOYED' } },
    { key: 'inbound',  label: 'Inbound',  uriParams: { size: 1000, stage: 'INBOUND' } },
  ];
  const PROCUREMENT = { size: 2000, lineStatus: 'UNDER_PROCUREMENT', includeAll: 'Y' };
  // Feature flags and page access load with the app; wait briefly for them (as My requests waits for the roles).
  const TRIES = 60;
  const GAP_MS = 50;

  class loadWorkbenchChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const vars = $application.variables;
      const fns = $application.functions;
      const v = $page.variables;
      for (let i = 0; i < TRIES && !(vars.flagsLoaded && vars.pageAccessLoaded); i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      v.isLoading = true;
      v.fetchError = '';
      v.loadNote = '';
      const now = new Date();
      v.today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      v.isReadOnly = !!fns.isPageReadOnly(vars.pageAccessMap, vars.pageAccessLoaded, 'EQR_WORKBENCH');
      v.showSource = !!fns.isFeatureEnabled(vars.featureFlags, vars.flagsLoaded, 'CUSTOMERS_MODULE_ENABLED');

      const failed = (e) => ({ ok: false, status: 0, error: e });
      const calls = STAGES.map((s) => Actions.callRest(context, {
        endpoint: 'eqp-v1/getEquipriteV1ViewsWorkbenchRequests',
        uriParams: s.uriParams,
      }).catch(failed));
      calls.push(Actions.callRest(context, {
        endpoint: 'eqp-v1/getEquipriteV1ViewsPendingApprovalLines',
        uriParams: PROCUREMENT,
      }).catch(failed));

      try {
        const res = await Promise.all(calls);
        const isExt = (source) => fns.isExternalSource(source);
        const quoting = (source) => fns.isQuotingAllowed(vars.globalSettings, vars.flagsLoaded, source);
        const stages = {};
        const missing = [];
        let lastStatus = 0;
        STAGES.forEach((s, i) => {
          const r = res[i];
          if (!r || !r.ok) {
            missing.push(s.label);
            lastStatus = (r && r.status) || lastStatus;
            stages[s.key] = [];
            return;
          }
          stages[s.key] = $page.functions.mapRequests(r.body && r.body.data, isExt, quoting);
        });
        const pr = res[STAGES.length];
        if (!pr || !pr.ok) {
          missing.push('Procurement');
        }
        const known = [].concat(stages.outbound, stages.pick, stages.deployed, stages.inbound);
        stages.procurement = $page.functions.procurementRows(pr && pr.ok && pr.body ? pr.body.data : [], known);

        const buckets = $page.functions.buckets(stages);
        v.buckets = buckets;
        v.tabList = $page.functions.tabs(buckets);
        if (missing.length === STAGES.length + 1) {
          v.fetchError = `The workbench could not be loaded (HTTP ${lastStatus}).`;
        } else if (missing.length) {
          v.loadNote = `Not loaded: ${missing.join(', ')}. Those tabs may be short; Refresh to try again.`;
        }
        // On the first load, open the first tab that has work in it.
        if (!v.tabChosen && !(buckets[v.tab] || []).length) {
          const first = ['approve', 'pick', 'outbound'].find((k) => (buckets[k] || []).length);
          if (first) {
            v.tab = first;
          }
        }
        // A ticked request that is no longer waiting for approval drops out of the selection.
        v.selectedIds = (v.selectedIds || []).filter((id) => (buckets.approve || []).some((r) => String(r.request_id) === String(id)));
      } catch (e) {
        console.error('[loadWorkbenchChain] failed', e);
        v.fetchError = 'The workbench could not be loaded.';
      } finally {
        v.isLoading = false;
      }
      await Actions.callChain(context, { chain: 'applyFilterChain' });
    }
  }

  return loadWorkbenchChain;
});
