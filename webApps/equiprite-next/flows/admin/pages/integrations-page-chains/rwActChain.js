define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/integrationsView',
], (ActionChain, Actions, view) => {
  'use strict';

  // The Redwood header's buttons (Oracle's general overview page), each what the current look's does: Check again reads
  // every integration again; Run syncs in New EquipRite goes there, as the current look's link does.
  class rwActChain extends ActionChain {
    async run(context, { id }) {
      if (id === 'check') await Actions.callChain(context, { chain: 'loadChain' });
      else if (id === 'inNew') {
        const url = view.newLink((context.$application.variables.appUrls || {}).new);
        if (url) window.location.assign(url);
      }
    }
  }

  return rwActChain;
});
