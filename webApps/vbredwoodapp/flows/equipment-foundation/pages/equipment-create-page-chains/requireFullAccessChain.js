define(['vb/action/actionChain', 'vb/action/actions'], (ActionChain, Actions) => {
  'use strict';

  /**
   * Page-entry guard for Create: creating an equipment definition needs FULL
   * access to EQR_EQUIPMENT_MASTER, not just the READ_ONLY that lets someone
   * browse the list. (The generic enforcePageAccessChain accepts READ_ONLY.)
   *
   * Before 2026-10-05 this page had no guard at all, so a read-only user --
   * or anyone with the URL -- could open it. The master page also hides its
   * Create action below FULL; this closes the direct-URL path.
   *
   * Access not loaded yet -> let the page open, as every guard here does
   * (canEnterPage): the map resolves moments after app start, and blocking on
   * it would bounce real users. Save is the last line: it checks again.
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
          message: 'Creating equipment definitions needs full access to Equipment Master.',
          type: 'warning', displayMode: 'transient'
        });
        await Actions.navigateToPage(context, { page: 'equipment-master' });
      } catch (e) {
        console.error('[requireFullAccessChain] unexpected error', e);
      }
    }
  }

  return requireFullAccessChain;
});
