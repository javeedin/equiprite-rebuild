define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class onClassSelectedChain extends ActionChain {
    async run(context, { detail } = {}) {
      const { $page } = context;

      const className = detail && detail.itemContext && detail.itemContext.data
        ? detail.itemContext.data.label
        : '';
      $page.variables.currentLine.className = className;

      await Actions.callChain(context, { chain: 'loadEquipmentSubclassesByClassChain' });
    }
  }

  return onClassSelectedChain;
});
