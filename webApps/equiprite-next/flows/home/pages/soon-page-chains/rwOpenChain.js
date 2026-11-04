define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // The Redwood look's header on a screen not built yet: its actions are the current look's two links, and go where they
  // go (in this window, as the links do): new, the same screen in New EquipRite; old, Old EquipRite.
  class rwOpenChain extends ActionChain {
    async run(context, { id }) {
      const { $page, $application } = context;
      const urls = $application.variables.appUrls || {};
      const url = id === 'new' ? $page.functions.newUrl(urls.new, $page.variables.navId) : (id === 'old' ? urls.old : '');
      if (url) window.location.assign(url);
    }
  }

  return rwOpenChain;
});
