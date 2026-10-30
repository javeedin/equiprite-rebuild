define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // Escape or a click outside: close whichever popup is open.
  class dismissChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      v.bellOpen = false;
      v.profileOpen = false;
      v.cartOpen = false;
      v.tabMenuOpen = false;
      v.showResults = false;
      v.navOpen = false;
    }
  }

  return dismissChain;
});
