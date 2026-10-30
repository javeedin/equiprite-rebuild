define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Discard (New EquipRite's cancelEditsChain): the rows as loaded were never changed, so clearing the pending edits
  // puts every cell back.
  class discardChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      if (v.isSaving) return;
      v.dirty = {};
      v.saveErrors = {};
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return discardChain;
});
