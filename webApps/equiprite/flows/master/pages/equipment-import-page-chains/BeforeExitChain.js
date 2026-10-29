define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  /**
   * vbBeforeExit: the old BeforeExitChain plus the old dialog's Close prompt (CancelImportDialogChain), since
   * leaving this page is what closing the dialog was.
   *
   *   - a Fetch or Import still running stops part-way if the page is left: ask first (old BeforeExitChain).
   *     The old dialog could close during a Fetch and let it run on behind; a page that is left cannot.
   *   - ticked rows and class edits are lost on leaving: ask first (old CancelImportDialogChain).
   * Returning { cancelled: true } keeps the user on the page.
   */
  class BeforeExitChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;
      const msg = $page.functions.busyLeaveMessage(v);
      if (msg) {
        return window.confirm(msg + '\n\nLeave anyway? It will stop part-way.') ? undefined : { cancelled: true };
      }
      if ($page.functions.pendingWorkCount(v) > 0) {
        const ok = window.confirm(
          'Close Import From Fusion?\n\n' + $page.functions.pendingWorkText(v) +
          ' will be discarded. Click Import first to keep them.');
        if (!ok) return { cancelled: true };
      }
      return undefined;
    }
  }

  return BeforeExitChain;
});
