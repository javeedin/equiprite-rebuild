define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // Opens or closes the menu under your name (who you are, the EquipRite version); the bell and the tab menu close.
  class profileChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      v.profileOpen = !v.profileOpen;
      v.bellOpen = false;
      v.cartOpen = false;
      v.phoneOpen = false;
      v.tabMenuOpen = false;
      v.showResults = false;
    }
  }

  return profileChain;
});
