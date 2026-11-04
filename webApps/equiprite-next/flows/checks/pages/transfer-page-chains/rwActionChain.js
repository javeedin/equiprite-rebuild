define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/nav',
], (ActionChain, Actions, nav) => {
  'use strict';

  // The Redwood view's header actions (the general overview page's secondary actions; the clicked one's id is the event's
  // secondaryItem), each what the current look's button does: 'refresh' reads the transfer again, 'export' exports what
  // is on it (Excel), 'new' opens its work in New EquipRite (release, ship, receive, the inter-org transfer).
  class rwActionChain extends ActionChain {
    async run(context, { item }) {
      const id = item && typeof item === 'object' ? item.id : item;
      const v = context.$page.variables;
      if (id === 'refresh') {
        await Actions.callChain(context, { chain: 'loadRecordChain' });
      } else if (id === 'export') {
        await Actions.callChain(context, { chain: 'exportUnitsChain', params: { format: 'xlsx' } });
      } else if (id === 'new') {
        const head = v.head || {};
        const url = head.newNav ? nav.newUrl(context.$application.variables.appUrls.new, head.newNav) : '';
        if (url) window.location.assign(url);
      }
    }
  }

  return rwActionChain;
});
