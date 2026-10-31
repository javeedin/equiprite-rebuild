define([
  'vb/action/actionChain',
  'resources/js/accessMatrix',
], (ActionChain, access) => {
  'use strict';

  // The matrix, what the search and chip leave of it, and what Save would do to each changed role's menu (with the
  // app's own flags, so it is the menu people would really get).
  class applyChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const v = $page.variables;
      const av = $application.variables;
      const rows = access.matrix(v.roles, v.rowsByRole, v.dirty);
      v.rows = rows;
      v.shown = access.visible(rows, v.text, v.only);
      v.cons = access.consequences(v.roles, v.rowsByRole, v.dirty, {
        flags: av.featureFlags, flagsLoaded: av.flagsLoaded, buRateSources: av.buRateSources, sessionRoles: av.sessionRoles,
      });
      v.dirtyCount = access.count(v.dirty);
    }
  }

  return applyChain;
});
