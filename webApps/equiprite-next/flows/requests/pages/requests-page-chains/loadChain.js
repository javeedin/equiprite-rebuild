define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestData',
], (ActionChain, Actions, requestData) => {
  'use strict';

  // Loads the requests and their equipment (shared with the bell and My work for half a minute; Refresh loads anew).
  class loadChain extends ActionChain {
    async run(context, { refresh }) {
      const { $page } = context;
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
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return loadChain;
});
