define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class onSubclassSelectedChain extends ActionChain {
    async run(context, { detail } = {}) {
      const { $page } = context;

      const subclassName = detail && detail.itemContext && detail.itemContext.data
        ? detail.itemContext.data.label
        : '';
      $page.variables.currentLine.subclassName = subclassName;

      // Reset the equipment selection — subclass change reloads the names list,
      // and the previous master_id may not be in the new list.
      $page.variables.currentLine.equipmentMasterId = null;
      $page.variables.currentLine.equipmentName = '';
      await Actions.callChain(context, { chain: 'loadEquipmentNamesByClassChain' });
    }
  }

  return onSubclassSelectedChain;
});
