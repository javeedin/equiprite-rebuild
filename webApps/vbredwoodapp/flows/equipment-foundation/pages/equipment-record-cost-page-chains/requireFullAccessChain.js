define(['vb/action/actionChain', 'vb/action/actions'], (ActionChain, Actions) => {
  'use strict';

  /**
   * Page-entry guard for Record Cost: recording a cost is a write, so it needs
   * FULL access to EQR_EQUIPMENT_MASTER - the same rule as the Record Cost
   * button on equipment-unit-detail-page and as equipment-create-page's
   * requireFullAccessChain, which this copies. This closes the direct-URL path.
   *
   * Access not loaded yet -> let the page open, as every guard here does: the
   * map resolves moments after app start, and blocking on it would bounce
   * real users.
   */
  class requireFullAccessChain extends ActionChain {
    async run(context) {
      const { $application } = context;
      try {
        const fns = $application.functions;
        const vars = $application.variables;
        if (!vars.pageAccessLoaded) return;
        if (fns.pageAccess(vars.pageAccessMap, vars.pageAccessLoaded, 'EQR_EQUIPMENT_MASTER') === 'FULL') {
          return;
        }
        await Actions.fireNotificationEvent(context, {
          summary: 'No access',
          message: 'Recording cost needs full access to Equipment Master.',
          type: 'warning', displayMode: 'transient'
        });
        await Actions.navigateToPage(context, { page: 'equipment-master' });
      } catch (e) {
        console.error('[record-cost requireFullAccessChain] unexpected error', e);
      }
    }
  }

  return requireFullAccessChain;
});
