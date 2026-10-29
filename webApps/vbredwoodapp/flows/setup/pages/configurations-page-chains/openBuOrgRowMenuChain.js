define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Kebab (⋮) button on a BU & Org mapping row: stash which row it was and open
  // the shared row menu anchored to that button. The menu's selection is handled
  // by buOrgMenuActionChain (Edit / Delete). Mirrors the cart page's row-menu pattern.
  class openBuOrgRowMenuChain extends ActionChain {
    async run(context, { event } = {}) {
      const { $page } = context;
      if (!event) return;

      const launcher = event.currentTarget;
      const rowKey = launcher ? launcher.getAttribute('data-row-key') : null;
      if (rowKey == null) return;

      $page.variables.BuOrgMenuRowKey = rowKey;

      const menu = document.getElementById('buOrgRowMenu');
      if (menu) {
        menu.open(event.detail && event.detail.originalEvent, { launcher: launcher });
      }
    }
  }

  return openBuOrgRowMenuChain;
});
