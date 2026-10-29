define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Reset the add-class/subclass form and open the right-side drawer.
  class openAddClassDrawerChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      // This object literal REPLACES the variable wholesale, so every field the
      // form binds must be listed -- an omitted one comes back undefined, not
      // defaulted, and an undefined trackingType would leave the TYPE select
      // unbindable and the Class LOV with nothing to query on.
      $page.variables.newClassSubclass = {
        className: '',
        subclassName: '',
        trackingType: 'INVENTORY',
        classLovId: null,
        subclassLovId: null,
        consumableFlag: 'N',
        autoConsumeFlag: 'N'
      };
      $page.variables.SubclassLovArray = [];
      $page.variables.subclassLovLoaded = false;
      $page.variables.isAddClassDrawerOpen = true;

      // Load the CLASS list for the default TYPE so the drawer opens ready to
      // use rather than with an empty picker.
      await Actions.callChain(context, { chain: 'loadClassLovChain' });
    }
  }

  return openAddClassDrawerChain;
});
