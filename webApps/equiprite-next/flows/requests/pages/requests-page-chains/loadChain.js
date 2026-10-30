define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestData',
  'resources/js/rules',
], (ActionChain, Actions, requestData, rules) => {
  'use strict';

  // Loads the requests and their equipment (shared with the bell and My work for half a minute; Refresh loads anew).
  // Which steps a row offers follows page access, as on the screens that take them: approving needs EQR_WORKBENCH
  // FULL (Approve & allocate), assigning units opens that screen (seen with READ_ONLY too), picking opens Picking &
  // shipping (EQR_INITIATE_PICKING). Until access has loaded, none (fail closed).
  const TRIES = 60;
  const GAP_MS = 50;

  class loadChain extends ActionChain {
    async run(context, { refresh }) {
      const { $page, $application } = context;
      const app = $application.variables;
      $page.variables.isLoading = true;
      try {
        const data = await requestData.load(context, Actions, { refresh: !!refresh });
        $page.variables.error = data.error || '';
        $page.variables.manager = !!data.manager;
        $page.variables.linesLoaded = !!data.linesLoaded;
        $page.variables.linesByRequest = data.linesByRequest || {};
        $page.variables.rows = data.rows || [];
      } finally {
        $page.variables.isLoading = false;
      }
      for (let i = 0; i < TRIES && !app.pageAccessLoaded; i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      const workbench = rules.pageAccess(app.pageAccessMap, app.pageAccessLoaded, 'EQR_WORKBENCH');
      const picking = rules.pageAccess(app.pageAccessMap, app.pageAccessLoaded, 'EQR_INITIATE_PICKING');
      $page.variables.can = { decide: workbench === 'FULL', assign: workbench !== 'HIDDEN', pick: picking !== 'HIDDEN' };
      await Actions.callChain(context, { chain: 'applyChain' });
      await Actions.callChain(context, { chain: 'focusChain' });
    }
  }

  return loadChain;
});
