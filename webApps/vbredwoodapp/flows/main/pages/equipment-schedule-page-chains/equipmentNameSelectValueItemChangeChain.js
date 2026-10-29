define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class equipmentNameSelectValueItemChangeChain extends ActionChain {
    async run(context, { key, data, metadata }) {
      // Placeholder — wire equipment name filter when real service is connected
    }
  }

  return equipmentNameSelectValueItemChangeChain;
});
