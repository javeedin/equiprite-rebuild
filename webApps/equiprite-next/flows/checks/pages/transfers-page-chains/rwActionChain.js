define(['vb/action/actionChain', 'resources/js/nav'], (ActionChain, nav) => {
  'use strict';

  // The Redwood view's header action (the Smart Search page's primary action): 'move' opens Transfers in New EquipRite,
  // as the current look's "Move equipment between projects (in New)" link does (recording a transfer writes a transfer
  // order, the inter-org transfer in Fusion).
  class rwActionChain extends ActionChain {
    async run(context, { item }) {
      if (item !== 'move') return;
      const url = nav.newUrl(context.$application.variables.appUrls.new, 'transfers');
      if (url) window.location.assign(url);
    }
  }

  return rwActionChain;
});
