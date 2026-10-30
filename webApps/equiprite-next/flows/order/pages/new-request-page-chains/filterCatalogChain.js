define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Catalog search, class chip, "free on these dates only" and "Show more": holds the choice, then applyCatalogChain
  // works out the rows.
  const PAGE = 40;

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
