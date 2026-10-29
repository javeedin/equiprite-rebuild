define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Classes & Subclasses "Create from Fusion": open classFusionDialog on the
  // last source used (or the first with a saved column mapping) and list its
  // class / subclass pairs. Reopening refreshes the list.
  class openClassMapBulkChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const options = $page.functions.bulkSourceOptions(
        $page.variables.ConfigSettingsMap, $page.variables.ClassMapTruthSel);
      const current = $page.variables.ClassMapPairsSource;
      const source = options.some(o => o.value === current)
        ? current : (options.length ? options[0].value : '');

      const dlg = document.getElementById('classFusionDialog');
      if (dlg) dlg.open();
      if (!source) {
        $page.variables.ClassMapPairsSource = '';
        $page.variables.ClassMapPairsArray = [];
        return;
      }
      await Actions.callChain(context, { chain: 'previewClassMapPairsChain', params: { source } });
    }
  }

  return openClassMapBulkChain;
});
