define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/switchExpTypeScopeChain.js, unchanged.

  // The add form's second dropdown follows its first: Equipment / Subclass /
  // Class each have their own list. Swapping the scope type also CLEARS the
  // chosen scope, because the ids are from different tables and keeping one
  // would silently point at an unrelated row of the new type -- the backend
  // would accept it if that id happens to exist at the new scope, and the
  // mapping would be attached to the wrong thing with nothing on screen to show
  // it.
  class switchExpTypeScopeChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const { scopeType } = params || {};
      const st = (scopeType || 'MASTER').toUpperCase();

      $page.variables.ExpTypeScopeOptions =
        (st === 'SUBCLASS') ? ($page.variables.ExpTypeSubclassOptions || [])
      : (st === 'CLASS')    ? ($page.variables.ExpTypeClassOptions || [])
      :                       ($page.variables.ExpTypeMasterOptions || []);

      const draft = $page.variables.NewExpTypeMap || {};
      // Reassign whole -- VBCS tracks the object by reference.
      $page.variables.NewExpTypeMap = {
        scopeType:       st,
        scopeId:         null,
        expenditureType: draft.expenditureType || ''
      };
    }
  }

  return switchExpTypeScopeChain;
});
