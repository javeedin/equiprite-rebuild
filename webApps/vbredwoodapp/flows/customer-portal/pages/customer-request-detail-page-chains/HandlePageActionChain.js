define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Dispatcher — routes the functionalPrimaryAction button click to the correct
   * chain based on the actionId emitted by oj-sp-collection-container-advanced.
   */
  class HandlePageActionChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const actionId = params && params.actionId;

      switch (actionId) {
        case 'receive':
          await Actions.fireCustomEvent(context, { name: 'receiveRequest', payload: {} });
          break;
        case 'reject':
          await Actions.fireCustomEvent(context, { name: 'rejectRequest', payload: {} });
          break;
        case 'return':
          await Actions.fireCustomEvent(context, { name: 'initiateReturn', payload: {} });
          break;
        case 'cancel':
          await Actions.fireCustomEvent(context, { name: 'cancelRequest', payload: {} });
          break;
        default:
          break;
      }
    }
  }

  return HandlePageActionChain;
});
