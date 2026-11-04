define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The Redwood look's header (your menu, Look): each of its actions does what the current look's does.
  //   refresh   Refresh (loadChain)
  //   record    Record in New EquipRite: New's Direct cost & inventory on this request, in this window, as the current
  //             look's link opens it
  class rwActionChain extends ActionChain {
    async run(context, { id }) {
      const { $page, $application } = context;
      const v = $page.variables;
      if (id === 'refresh') {
        await Actions.callChain(context, { chain: 'loadChain', params: { refresh: true } });
        return;
      }
      if (id === 'record' && v.current) {
        const urls = ($application && $application.variables && $application.variables.appUrls) || {};
        const url = $page.functions.newUrl(urls.new, v.current.requestNumber);
        if (url) window.location.assign(url);
      }
    }
  }

  return rwActionChain;
});
