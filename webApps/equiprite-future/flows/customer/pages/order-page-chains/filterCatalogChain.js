define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Catalog search, class chip, "free on these dates only" and "Show more" (New's filterCatalogChain); then the list
  // shown is worked out again.
  const PAGE = 48;

  class filterCatalogChain extends ActionChain {
    async run(context, { text, cls, avail, more }) {
      const v = context.$page.variables;
      if (more) {
        v.catalogLimit = (v.catalogLimit || PAGE) + PAGE;
      } else {
        if (text !== undefined) v.catalogText = String(text || '');
        if (cls !== undefined) v.catalogClass = cls || 'all';
        if (avail !== undefined) v.catalogAvail = (avail === true || avail === 'true') ? 'free' : '';
        v.catalogLimit = PAGE;
      }
      await Actions.callChain(context, { chain: 'applyCatalogChain' });
    }
  }

  return filterCatalogChain;
});
