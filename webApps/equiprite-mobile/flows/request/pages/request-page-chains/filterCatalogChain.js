define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Catalog search, class chip, "Free only" and "Show more": holds the choice, then applyCatalogChain works out the
  // rows (Next's filterCatalogChain; a phone shows 20 cards at a time).
  const PAGE = 20;

  class filterCatalogChain extends ActionChain {
    async run(context, { text, cls, avail, more }) {
      const { $page } = context;
      if (more) {
        $page.variables.catalogLimit = ($page.variables.catalogLimit || PAGE) + PAGE;
      } else {
        if (text !== undefined) {
          $page.variables.catalogText = String(text || '');
        }
        if (cls !== undefined) {
          $page.variables.catalogClass = cls || 'all';
        }
        if (avail !== undefined) {
          $page.variables.catalogAvail = avail === true || avail === 'true' ? 'free' : '';
        }
        $page.variables.catalogLimit = PAGE;
      }
      await Actions.callChain(context, { chain: 'applyCatalogChain' });
    }
  }

  return filterCatalogChain;
});
