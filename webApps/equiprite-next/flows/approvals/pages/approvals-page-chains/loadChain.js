define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestData',
  'resources/js/rules',
], (ActionChain, Actions, requestData, rules) => {
  'use strict';

  // Loads the queue: the requests and their equipment (requestData, shared with Requests, My work and the bell for
  // half a minute; Refresh and every write load anew). Reads only. Who may act is EQR_WORKBENCH, as in New EquipRite:
  // FULL approves, sends back and assigns units; READ_ONLY sees; HIDDEN is refused (fail closed).
  // reopen: Refresh also reads the open request again.
  const TRIES = 60;
  const GAP_MS = 50;

  class loadChain extends ActionChain {
    async run(context, { refresh, reopen }) {
      const { $page, $application } = context;
      const v = $page.variables;
      const app = $application.variables;
      for (let i = 0; i < TRIES && !(app.flagsLoaded && app.pageAccessLoaded); i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      v.access = rules.pageAccess(app.pageAccessMap, app.pageAccessLoaded, 'EQR_WORKBENCH');
      v.canAct = v.access === 'FULL';
      v.showSource = rules.isFeatureEnabled(app.featureFlags, app.flagsLoaded, 'CUSTOMERS_MODULE_ENABLED');
      if (app.pageAccessLoaded && v.access === 'HIDDEN') {
        v.isLoading = false;
        v.error = 'Approve & allocate is not open to your role.';
        return;
      }
      v.isLoading = true;
      try {
        const data = await requestData.load(context, Actions, { refresh: !!refresh });
        v.error = data.error || '';
        v.linesLoaded = !!data.linesLoaded;
        v.linesByRequest = data.linesByRequest || {};
        v.rows = data.rows || [];
      } finally {
        v.isLoading = false;
      }
      await Actions.callChain(context, { chain: 'applyChain' });
      if (reopen && v.current && v.current.key) {
        await Actions.callChain(context, { chain: 'recordChain', params: {} });
      }
    }
  }

  return loadChain;
});
