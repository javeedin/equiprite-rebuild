define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Back to Equipment (the list reads the server again, so items just imported are there). BeforeExitChain asks
  // first when a run is going or ticks and edits would be lost.
  class backChain extends ActionChain {
    async run(context) {
      await Actions.navigateToPage(context, { page: 'equipment' });
    }
  }

  return backChain;
});
