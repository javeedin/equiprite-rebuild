define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // TYPE changed in the Add drawer. Both pickers below it are now meaningless —
  // a FINANCE major category is not a valid INVENTORY catalog — so clear the
  // selections AND the lists before reloading, then fetch the new CLASS list.
  //
  // Clearing the SELECTED IDS matters as much as clearing the lists: leaving a
  // stale classLovId behind would let a subsequent save send a class id that
  // belongs to a different Fusion classification entirely, which nothing
  // downstream would catch.
  class onTrackingTypeChangedChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const form = $page.variables.newClassSubclass || {};
      $page.variables.newClassSubclass = {
        ...form,
        classLovId: null,
        subclassLovId: null,
        className: '',
        subclassName: ''
      };

      $page.variables.SubclassLovArray = [];
      $page.variables.subclassLovLoaded = false;

      await Actions.callChain(context, { chain: 'loadClassLovChain' });
    }
  }

  return onTrackingTypeChangedChain;
});
