define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/onColumnMapGroupChangedChain.js, unchanged.

  // A FIELD GROUP changed: the column picked under the old group does not
  // belong to the new one, so clear it. params.level: 'CLASS' | 'SUBCLASS'.
  class onColumnMapGroupChangedChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const level = params && params.level;
      const draft = $page.variables.ColumnMapDraft || {};
      $page.variables.ColumnMapDraft = level === 'SUBCLASS'
        ? { ...draft, subclassColumn: null }
        : { ...draft, classColumn: null };
    }
  }

  return onColumnMapGroupChangedChain;
});
