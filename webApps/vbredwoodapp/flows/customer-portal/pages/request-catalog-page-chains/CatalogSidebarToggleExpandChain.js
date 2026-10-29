define([
  'vb/action/actionChain',
], function(ActionChain) {
  'use strict';

  class CatalogSidebarToggleExpandChain extends ActionChain {
    async run(context, params) {
      var $page = context.$page;
      var event = params && params.event;
      if (event && typeof event.stopPropagation === 'function') {
        event.stopPropagation();
      }
      var className = params && params.className ? String(params.className) : '';
      if (!className) return;

      var expanded = ($page.variables.expandedClasses || []).slice();
      var idx = expanded.indexOf(className);
      if (idx >= 0) {
        expanded.splice(idx, 1);
      } else {
        expanded.push(className);
      }
      $page.variables.expandedClasses = expanded;
    }
  }

  return CatalogSidebarToggleExpandChain;
});
