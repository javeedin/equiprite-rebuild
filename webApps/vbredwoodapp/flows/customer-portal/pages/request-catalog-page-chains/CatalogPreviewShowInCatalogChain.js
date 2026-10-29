define([
  'vb/action/actionChain',
], function(ActionChain) {
  'use strict';

  // "Show in catalog" from the preview dialog. Sets activeTemplateId, bound into
  // the catalog SDP's templateId uriParameter — the grid re-queries server-side
  // to show only the template's equipment. A custom removable chip in the search
  // slot reflects it. Closes the preview (and the templates list dialog if open).
  class CatalogPreviewShowInCatalogChain extends ActionChain {
    async run(context) {
      var $page = context.$page;
      var serverId = $page.variables.previewTemplateServerId;
      if (serverId == null) { return; }

      $page.variables.activeTemplateId   = Number(serverId);
      $page.variables.activeTemplateName = $page.variables.previewTemplateName || '';

      var preview = document.getElementById('templatePreviewDialog');
      if (preview && typeof preview.close === 'function') preview.close();
      var list = document.getElementById('equipTemplatesDialog');
      if (list && typeof list.close === 'function') list.close();
    }
  }

  return CatalogPreviewShowInCatalogChain;
});
