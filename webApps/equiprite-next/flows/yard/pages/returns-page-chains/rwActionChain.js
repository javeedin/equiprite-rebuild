define(['vb/action/actionChain', 'resources/js/nav'], (ActionChain, nav) => {
  'use strict';

  // The Redwood view's header actions (oj-sp-smart-search-page secondary actions; the clicked one's id is the event's
  // secondaryItem): 'new' opens Receipt & returns in New EquipRite, as the current look's "Open in New EquipRite" link
  // does (the steps that write to Fusion).
  class rwActionChain extends ActionChain {
    async run(context, { item }) {
      const id = item && typeof item === 'object' ? item.id : item;
      if (id !== 'new') return;
      const url = nav.newUrl(context.$application.variables.appUrls.new, 'returns');
      if (url) window.location.assign(url);
    }
  }

  return rwActionChain;
});
