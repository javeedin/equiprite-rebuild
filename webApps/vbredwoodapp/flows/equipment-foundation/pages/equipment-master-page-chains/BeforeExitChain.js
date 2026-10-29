define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  /**
   * vbBeforeExit: leaving the page while Sync, Fetch or Import runs stops it
   * part-way. A Sync left mid-run stages the stock but never applies it, and
   * its run log stays RUNNING until the next Sync. Ask first; returning
   * { cancelled: true } keeps the user on the page.
   *
   * Covers in-app navigation. Closing or reloading the tab is covered by the
   * browser's own prompt (setLeaveGuard in the page module).
   */
  class BeforeExitChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const msg = $page.functions.busyLeaveMessage($page.variables);
      if (msg && !window.confirm(msg + '\n\nLeave anyway? It will stop part-way.')) {
        return { cancelled: true };
      }
      return undefined;
    }
  }

  return BeforeExitChain;
});
