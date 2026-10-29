define([
  'vb/action/actionChain',
  'vb/action/actions',
], function(ActionChain, Actions) {
  'use strict';

  // Opens the Templates dialog. Template HEADERS are fetched LAZILY here (the
  // first time the dialog opens) and cached in templatesArray — NOT in
  // CatalogInitChain — so the catalog's initial load makes no template call.
  // Template lines stay lazier still: fetched per-template only on preview
  // (CatalogPreviewTemplateChain). templatesArray is the only consumer; the
  // filter/preview triggers that read it all live behind this dialog, so
  // deferring the fetch is safe.
  class CatalogTemplatesChain extends ActionChain {
    async run(context) {
      var $page = context.$page;

      // Reset search each time the dialog opens.
      var input = document.getElementById('tmplSearchInput');
      if (input) { input.value = ''; }

      var cached = Array.isArray($page.variables.templatesArray) && $page.variables.templatesArray.length > 0;

      // Open the dialog IMMEDIATELY so the click gives instant feedback. On the
      // first open the headers aren't cached yet, so show a spinner (gated by
      // isTemplatesLoading) while the fetch runs, then render the list. On later
      // opens the cache is warm → no spinner, list shows at once.
      $page.variables.isTemplatesLoading = !cached;
      $page.variables.filteredTemplatesArray = cached ? $page.variables.templatesArray.slice() : [];

      var dialog = document.getElementById('equipTemplatesDialog');
      if (dialog) { dialog.open(); }

      if (!cached) {
        try {
          var headers = await fetchTemplateHeaders(context);
          $page.variables.templatesArray = headers;
          $page.variables.filteredTemplatesArray = headers.slice();
        } finally {
          $page.variables.isTemplatesLoading = false;
        }
      }
    }
  }

  // Template headers (id, name, description). Lines are NOT fetched here.
  // EQR_REQUEST_TEMPLATE has no template-type column, so there is no
  // Project/Requisition split — every template lands in one flat list.
  async function fetchTemplateHeaders(context) {
    try {
      var resp = await Actions.callRest(context, { endpoint: 'eqp-v1/getRequestTemplates' });
      if (!resp || !resp.ok || !resp.body) { return []; }
      var rows = Array.isArray(resp.body.data)
        ? resp.body.data
        : (Array.isArray(resp.body.items) ? resp.body.items : []);
      return rows.map(function(r) {
        return {
          templateId:   r.id != null ? ('tmpl-srv-' + r.id) : ('tmpl-srv-' + (r.templateName || '')),
          serverId:     r.id != null ? Number(r.id) : null,
          templateName: r.templateName || '(unnamed)',
          description:  r.templateDescription || r.description || '',
          items:        []
        };
      });
    } catch (e) {
      console.warn('[CatalogTemplates] header load failed:', e);
      return [];
    }
  }

  return CatalogTemplatesChain;
});
