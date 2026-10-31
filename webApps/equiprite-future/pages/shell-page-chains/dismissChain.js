define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // Escape or a click outside: close whichever popup is open (Reset the demo's question keeps the story).
  class dismissChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      v.bellOpen = false;
      v.profileOpen = false;
      v.personaOpen = false;
      v.clockOpen = false;
      v.tabMenuOpen = false;
      v.resetAsk = false;
      v.navOpen = false;
    }
  }

  return dismissChain;
});
