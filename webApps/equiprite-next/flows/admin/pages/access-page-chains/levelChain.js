define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/accessMatrix',
], (ActionChain, Actions, access) => {
  'use strict';

  // One cell changed: New EquipRite's setLevelChain for that role (accessMatrix.setLevel): only FULL, READ_ONLY or
  // HIDDEN; a locked row refuses; the saved level again drops the pending edit; a new object every time. Nothing is
  // written until Save.
  class levelChain extends ActionChain {
    async run(context, { roleId, pageCode, accessLevel }) {
      const v = context.$page.variables;
      if (!v.canEdit || v.isSaving || !roleId) return;
      const rows = v.rowsByRole[roleId] || [];
      if (!rows.some((r) => r.pageCode === pageCode)) return;
      const before = v.dirty[roleId] || {};
      const after = access.setLevel(rows, before, pageCode, accessLevel);
      if (after === before) return;
      const dirty = Object.assign({}, v.dirty);
      if (Object.keys(after).length) dirty[roleId] = after;
      else delete dirty[roleId];
      v.dirty = dirty;
      const errs = Object.assign({}, v.saveErrors);
      delete errs[roleId];
      v.saveErrors = errs;
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return levelChain;
});
