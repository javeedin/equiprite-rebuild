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

      $page.variables.currentLine.equipmentName = null;
      await Actions.callChain(context, { chain: 'loadEquipmentNamesChain' });
    }
  }

  return onSubclassSelectedChain;
});
