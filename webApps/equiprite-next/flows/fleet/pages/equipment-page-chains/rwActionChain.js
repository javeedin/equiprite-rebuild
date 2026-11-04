define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The Redwood header's actions (Oracle's general overview page gives the clicked one's id), each through the chain the
  // current look's buttons call:
  //   refresh            read everything again (loadChain)
  //   history, units     Export: the history as shown, or the units with their state in the window, as Excel
  class rwActionChain extends ActionChain {
    async run(context, { id }) {
      if (id === 'refresh') await Actions.callChain(context, { chain: 'loadChain' });
      else if (id === 'history' || id === 'units') await Actions.callChain(context, { chain: 'exportChain', params: { what: id, format: 'xlsx' } });
    }
  }

  return rwActionChain;
});
