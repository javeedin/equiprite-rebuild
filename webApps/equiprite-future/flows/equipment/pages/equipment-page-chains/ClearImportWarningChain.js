define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Carried over unchanged from the old equipment-master-page-chains/ClearImportWarningChain.js (the filter row of
  // this page calls it after setting a filter, as the old dropdowns' value-changed did).
  /**
   * Runs when Item Class, Item Type, Status or the search changes in the
   * import dialog.
   *
   * Those dropdowns FILTER THE REVIEW GRID — they do not filter the Fusion
   * extract, which always pulls every item (OIC has no channel to pass a
   * filter to BIP; see LoadStagingChain). So a change reloads the rows from
   * page 0 with the new filter. Page 0 because the old page number means
   * nothing against a differently sized result.
   *
   * A reload replaces the rows on screen, so pending ticks and class edits
   * would be lost. With any pending, the user is asked first; Cancel puts the
   * dropdowns back to the filters the grid is actually showing
   * (stagingAppliedFilters, recorded by LoadStagingChain). Putting them back
   * fires value-changed again -- the "nothing really changed" check below
   * makes that second call a no-op instead of a second prompt.
   *
   * It also clears the dialog's inline caution: a message about the previous
   * selection should not outlive that selection.
   */
  class ClearImportWarningChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;

      v.importWarning = '';

      // A run reloads the grid itself when it finishes; the filters are also
      // disabled while one is in progress.
      if ($page.functions.isBusy(v)) {
        return;
      }

      const applied = v.stagingAppliedFilters || {};
      const now = {
        itemClass:    v.selectedItemClass    || null,
        itemType:     v.selectedItemType     || null,
        importStatus: v.selectedImportStatus || null,
        search:       (v.stagingSearch || '').trim() || null
      };
      const unchanged = (applied.itemClass    || null) === now.itemClass &&
                        (applied.itemType     || null) === now.itemType &&
                        (applied.importStatus || null) === now.importStatus &&
                        (applied.search       || null) === now.search;
      if (unchanged && v.stagingAppliedFilters) {
        return;
      }

      if ($page.functions.pendingWorkCount(v) > 0) {
        const ok = window.confirm(
          'Change the filter?\n\n' + $page.functions.pendingWorkText(v) +
          ' will be discarded. Click Import first to keep them.');
        if (!ok) {
          v.selectedItemClass    = applied.itemClass    || null;
          v.selectedItemType     = applied.itemType     || null;
          v.selectedImportStatus = applied.importStatus || null;
          v.stagingSearch        = applied.search       || '';
          return;
        }
      }

      v.stagingPage = 0;
      await Actions.callChain(context, { chain: 'LoadStagingChain' });
    }
  }

  return ClearImportWarningChain;
});
