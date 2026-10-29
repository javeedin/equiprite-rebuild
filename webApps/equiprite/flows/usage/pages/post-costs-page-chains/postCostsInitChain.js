define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/usageGuard',
], (ActionChain, Actions, usageGuard) => {
  'use strict';

  // Opens Post costs. The feature guard stands for the old projectsModuleGuardChain and ppmRatesGuardChain: under
  // Fusion PPM rates EquipRite prices nothing, so the page does not exist (R14). Then the request list, and
  // ?request= opens that request's preview.
  class postCostsInitChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      if (!(await usageGuard.allow(context, Actions))) {
        return;
      }
      const fns = $application.functions;
      const vars = $application.variables;
      $page.variables.readOnly = !!fns.isPageReadOnly(vars.pageAccessMap, vars.pageAccessLoaded, 'EQR_POST_COST');
      await Actions.callChain(context, { chain: 'listChain' });
      const wanted = String($page.variables.request || '').trim();
      if (wanted) {
        await Actions.callChain(context, { chain: 'openRequestChain', params: { requestNumber: wanted } });
      }
    }
  }

  return postCostsInitChain;
});
