define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // New EquipRite: Cancel on an inline editor that stands in for an old dialog (the old dialogs' Cancel buttons
  // closed them without a chain). The three drawers keep their own close chains (closeEsDrawerChain…).
  const FLAGS = {
    isBuOrgEditOpen: true, isSubclassEditOpen: true, isAgrEditOpen: true, isAttEditOpen: true, isClassMapBulkOpen: true,
  };

  class closeEditorChain extends ActionChain {
    async run(context, { name }) {
      if (FLAGS[name]) {
        context.$page.variables[name] = false;
      }
    }
  }

  return closeEditorChain;
});
