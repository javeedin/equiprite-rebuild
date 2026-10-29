define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Catalog search, class chip, "free on these dates only" and "Show more". Filtering itself is
  // new-request-page.js filterCatalog; this only holds the choices.
  const PAGE = 48;

  class filterCatalogChain extends ActionChain {
    async run(context, { text, cls, avail, more }) {
      const { $page } = context;
      if (more) {
        $page.variables.catalogLimit = ($page.variables.catalogLimit || PAGE) + PAGE;
        return;
      }
      if (text !== undefined) {
        $page.variables.catalogText = String(text || '');
      }
      if (cls !== undefined) {
        $page.variables.catalogClass = cls || 'all';
      }
      if (avail !== undefined) {
        $page.variables.catalogAvail = avail ? 'free' : '';
      }
      $page.variables.catalogLimit = PAGE;
    }
  }

  return filterCatalogChain;
});
