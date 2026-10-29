define([
  'vb/action/actionChain',
], function(ActionChain) {
  'use strict';

  class CatalogTemplateSearchChain extends ActionChain {
    async run(context, { searchValue } = {}) {
      var $page = context.$page;
      var all = $page.variables.templatesArray || [];
      var term = (searchValue || '').trim().toLowerCase();
      if (!term) {
        $page.variables.filteredTemplatesArray = all.slice();
      } else {
        $page.variables.filteredTemplatesArray = all.filter(function(t) {
          return (t.templateName && t.templateName.toLowerCase().includes(term)) ||
                 (t.description && t.description.toLowerCase().includes(term));
        });
      }
    }
  }

  return CatalogTemplateSearchChain;
});
