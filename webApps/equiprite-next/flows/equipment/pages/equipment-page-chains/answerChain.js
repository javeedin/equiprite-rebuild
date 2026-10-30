define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The page's question card (New EquipRite's, in place of the old browser confirm()): OK runs the chain that asked,
  // confirmed; Cancel just closes the card. Sync from Fusion and Clear fetch ask here.
  const CHAINS = { sync: 'SyncFromFusionChain', clear: 'ClearStagingChain' };

  class answerChain extends ActionChain {
    async run(context, { answer }) {
      const { $page } = context;
      const ask = $page.variables.ask;
      if (answer !== 'ok' || !ask || !CHAINS[ask.kind]) {
        $page.variables.ask = null;
        return;
      }
      await Actions.callChain(context, { chain: CHAINS[ask.kind], params: { confirmed: true } });
    }
  }

  return answerChain;
});
