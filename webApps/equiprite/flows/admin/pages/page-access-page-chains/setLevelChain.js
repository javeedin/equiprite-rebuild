define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  const VALID = { FULL: 1, READ_ONLY: 1, HIDDEN: 1 };

  // Records one pending access-level change. The old setLevelChain (setup/rbac-admin), unchanged: writes to
  // dirtyMap, never to matrixArray (the clean server baseline, so Discard is free and Save sends only what
  // changed); picking a row's original value clears its entry; locked rows refuse; a NEW object every time so
  // bindings repaint.
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

      if (row && row.isLocked === 'Y') {
        console.warn('[setLevelChain] refusing to edit locked page', pageCode);
        return;
      }

      const next = Object.assign({}, $page.variables.dirtyMap || {});

      if (row && row.accessLevel === accessLevel) {
        delete next[pageCode];
      } else {
        next[pageCode] = accessLevel;
      }

      $page.variables.dirtyMap = next;
      $page.variables.saveError = '';
    }
  }

  return setLevelChain;
});
