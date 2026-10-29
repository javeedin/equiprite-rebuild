define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The page's question card: OK runs the chain that asked, confirmed; Cancel just closes the card.
  class answerChain extends ActionChain {
    async run(context, { answer }) {
      const { $page } = context;
      const ask = $page.variables.ask;
      if (answer !== 'ok' || !ask) {
        $page.variables.ask = null;
        return;
      }
      if (ask.kind === 'select') {
        await Actions.callChain(context, { chain: 'selectScheduleChain', params: { id: ask.target, confirmed: true } });
      } else if (ask.kind === 'removeLine') {
        await Actions.callChain(context, { chain: 'removeLineChain', params: { key: ask.target, confirmed: true } });
      } else if (ask.kind === 'deleteSchedule') {
        await Actions.callChain(context, { chain: 'deleteScheduleChain', params: { confirmed: true } });
      } else {
        $page.variables.ask = null;
      }
    }
  }

  return answerChain;
});
