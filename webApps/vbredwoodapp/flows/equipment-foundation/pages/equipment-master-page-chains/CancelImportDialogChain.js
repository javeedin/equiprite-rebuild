define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Close the Import From Fusion dialog -- the Close button, the X, and Esc.
   *
   * Bound to oj-dialog's oj-close as well as the Close button, so it runs
   * AFTER the X / Esc has already closed the dialog. It therefore re-opens
   * the dialog whenever closing should not have happened:
   *
   *   * while Fetch, Import or Clear is running (isBusy). Closing then threw
   *     away the run's result message, and reopening started a second load
   *     racing the run's own. (The Close button is disabled then; the X and
   *     Esc were not.)
   *   * when there are ticked rows or class edits and the user cancels the
   *     discard prompt. These were dropped silently before (review,
   *     2026-10-05): the next open reloads the grid and resets both.
   *
   * On OK the pending work is cleared before closing, so the oj-close that
   * close() itself fires finds nothing pending and does not prompt again.
   *
   * Closing refreshes the Equipment Master list: rows the dialog merged were
   * otherwise missing from it until a page reload.
   *
   * ojClose BUBBLES. The dialog's on-oj-close passes its event, and an
   * ojClose from anything inside the dialog (the "What to map next" popup,
   * a select's dropdown) is ignored -- closing the popup used to close the
   * whole dialog. The Close button passes no event.
   */
  class CancelImportDialogChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const v = $page.variables;
      const ev = params && params.event;
      if (ev && ev.target && ev.target.id !== 'importFusionDialog') return;
      const dlg = document.getElementById('importFusionDialog');
      const isOpen = !!(dlg && typeof dlg.isOpen === 'function' && dlg.isOpen());
      const reopen = () => {
        if (dlg && typeof dlg.open === 'function' && !isOpen) dlg.open();
      };

      // Import / Clear take seconds: stay until they finish. A Fetch may run
      // on in the background (canCloseImportDialog); it announces itself and
      // refreshes the list when it is done.
      if (!$page.functions.canCloseImportDialog(v)) {
        reopen();
        return;
      }
      const fetching = !!(v.isImporting || v.isImportingUnits);

      if (!fetching && $page.functions.pendingWorkCount(v) > 0) {
        const ok = window.confirm(
          'Close Import From Fusion?\n\n' + $page.functions.pendingWorkText(v) +
          ' will be discarded. Click Import first to keep them.');
        if (!ok) {
          reopen();
          return;
        }
        v.stagingSelectedRows = {};
        v.stagingChangedRows = {};
      }

      // Once per close: the oj-close that close() fires re-enters here with
      // importDialogOpen already false.
      const wasOpen = v.importDialogOpen;
      v.importDialogOpen = false;
      if (dlg && typeof dlg.close === 'function' && isOpen) {
        dlg.close();
      }
      if (wasOpen && fetching) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Fetch continues in the background',
          message: 'You will be told when it finishes. Stay on this page; Import From Fusion reopens it.',
          type: 'info', displayMode: 'transient'
        });
        return;
      }
      if (wasOpen) {
        await Actions.callChain(context, { chain: 'RefreshEquipmentListChain' });
      }
    }
  }

  return CancelImportDialogChain;
});
