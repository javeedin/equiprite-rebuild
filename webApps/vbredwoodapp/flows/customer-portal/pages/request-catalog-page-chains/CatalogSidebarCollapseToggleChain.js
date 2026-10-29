define([
  'vb/action/actionChain',
], function(ActionChain) {
  'use strict';

  class CatalogSidebarCollapseToggleChain extends ActionChain {
    async run(context) {
      var $page = context.$page;
      $page.variables.sidebarCollapsed = !$page.variables.sidebarCollapsed;
    }
  }

  return CatalogSidebarCollapseToggleChain;
});
