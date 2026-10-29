define([
  'vb/action/actionChain',
], function(ActionChain) {
  'use strict';

  // Clear the active template filter → the catalog SDP drops the templateId
  // uriParameter and re-queries the FULL catalog. Triggered by the custom
  // "Template: <name> ✕" chip in the search slot.
  class CatalogClearTemplateFilterChain extends ActionChain {
    async run(context) {
      var $page = context.$page;
      $page.variables.activeTemplateId   = null;
      $page.variables.activeTemplateName = '';
    }
  }

  return CatalogClearTemplateFilterChain;
});
