define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  const VALID = { FULL: 1, READ_ONLY: 1, HIDDEN: 1 };

  // Records one pending access-level change.
  //
  // Writes to dirtyMap, NOT to matrixArray: matrixArray stays the clean
  // server baseline so Cancel is a no-op and Save can send only what actually
  // changed. Selecting a value back to its original clears the entry, so a
  // no-op round trip does not mark the grid dirty.
  //
  // Reassigns a NEW object — VB change detection is by reference, so an
  // in-place property write would not repaint the row.
  class setLevelChain extends ActionChain {

    /**
     * @param {Object} context
     * @param {Object} params
     * @param {string} params.pageCode
     * @param {string} params.accessLevel - FULL | READ_ONLY | HIDDEN
     */
    async run(context, { pageCode, accessLevel }) {
      const { $page } = context;

      if (!pageCode || !accessLevel || !VALID[accessLevel]) {
        console.warn('[setLevelChain] ignoring invalid change', pageCode, accessLevel);
        return;
      }

      const row = ($page.variables.matrixArray || []).find(function (r) {
        return r && r.pageCode === pageCode;
      });

      // A locked row must not be editable. The UI disables it, but the guard
      // is repeated here so a stray event cannot bypass it.
      if (row && row.isLocked === 'Y') {
        console.warn('[setLevelChain] refusing to edit locked page', pageCode);
        return;
      }

      const next = Object.assign({}, $page.variables.dirtyMap || {});

      if (row && row.accessLevel === accessLevel) {
        delete next[pageCode];   // back to its original value — no longer dirty
      } else {
        next[pageCode] = accessLevel;
      }

      $page.variables.dirtyMap = next;
    }
  }

  return setLevelChain;
});
