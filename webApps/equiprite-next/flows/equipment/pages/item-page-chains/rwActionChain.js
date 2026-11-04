define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The Redwood header's actions (Oracle's general overview page gives the clicked one's id), each through the chains
  // the current look's buttons call:
  //   refresh              read the item again (loadRecordChain)
  //   units, docs, wos     Export: that list (menuChain picks it, as the menu's switch does), as Excel
  const LISTS = ['units', 'docs', 'wos'];

  class rwActionChain extends ActionChain {
    async run(context, { id }) {
      if (id === 'refresh') {
        await Actions.callChain(context, { chain: 'loadRecordChain' });
      } else if (LISTS.indexOf(id) !== -1) {
        await Actions.callChain(context, { chain: 'menuChain', params: { what: id } });
        await Actions.callChain(context, { chain: 'exportChain', params: { format: 'xlsx' } });
      }
    }
  }

  return rwActionChain;
});
