define([
  'vb/action/actionChain',
], function(ActionChain) {
  'use strict';

  // Clicking a template name FILTERS the catalog to that template's equipment.
  // The filter is driven by activeTemplateId, bound into the catalog SDP's
  // templateId uriParameter — so it re-queries SERVER-SIDE, independent of the
  // smart-search's filterCriterion (which the component owns exclusively; its
  // filter-criterion is read-only write-back and won't ingest an external set).
  // A custom removable chip in the search slot reflects activeTemplateId. This
  // does NOT add anything to the cart. Closes the templates dialog.
  class CatalogFilterByTemplateChain extends ActionChain {
    async run(context, { templateId } = {}) {
      var $page = context.$page;

      var templates = $page.variables.templatesArray || [];
      var template = templates.find(function(t) {
        return t.templateId === templateId || String(t.templateId) === String(templateId);
      });
      if (!template || template.serverId == null) { return; }

      $page.variables.activeTemplateId   = Number(template.serverId);
      $page.variables.activeTemplateName = template.templateName || '';

      var dialog = document.getElementById('equipTemplatesDialog');
      if (dialog && typeof dialog.close === 'function') { dialog.close(); }
    }
  }

  return CatalogFilterByTemplateChain;
});
