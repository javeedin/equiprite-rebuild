define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The filter row: Item class, Item type, Status chips and the search box. Each sets the variable the old
  // dialog's dropdown was bound to, then runs ClearImportWarningChain exactly as the dropdown's value-changed did
  // (it asks before discarding ticks and edits, and snaps the filter back on Cancel). Clicking the chip that is on
  // turns it off. Typing in the search waits for a pause. itemClassQuery only narrows the item class list, and
  // panel / showAll open the "What to map next" list; none of those three reload anything.
  const PAUSE_MS = 400;
  let typing = 0;

  class setStagingFilterChain extends ActionChain {
    async run(context, { kind, value }) {
      const { $page } = context;
      const v = $page.variables;
      const val = value == null ? '' : String(value);
      switch (kind) {
        case 'panel':
          v.unmatchedOpen = !v.unmatchedOpen;
          return;
        case 'showAll':
          v.unmatchedShowAll = !v.unmatchedShowAll;
          return;
        case 'itemClassQuery':
          v.itemClassQuery = val;
          return;
        default:
      }
      if ($page.functions.isBusy(v)) return;
      switch (kind) {
        case 'itemClass':
          v.selectedItemClass = v.selectedItemClass === val || !val ? null : val;
          break;
        case 'itemType':
          v.selectedItemType = v.selectedItemType === val || !val ? null : val;
          break;
        case 'status':
          v.selectedImportStatus = v.selectedImportStatus === val || !val ? null : val;
          break;
        case 'search': {
          v.stagingSearch = val;
          const mine = ++typing;
          await new Promise((r) => setTimeout(r, PAUSE_MS));
          if (mine !== typing) return;
          break;
        }
        default:
          return;
      }
      await Actions.callChain(context, { chain: 'ClearImportWarningChain' });
    }
  }

  return setStagingFilterChain;
});
