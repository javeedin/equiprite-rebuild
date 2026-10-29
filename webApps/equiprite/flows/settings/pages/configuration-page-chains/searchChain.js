define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // New EquipRite: the settings search. The sections, the index counts and the rows all filter on `query`
  // (configuration-page.js sectionHits / rows), so this only records the text.
  class searchChain extends ActionChain {
    async run(context, { text }) {
      context.$page.variables.query = text == null ? '' : String(text);
    }
  }

  return searchChain;
});
