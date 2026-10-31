define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // Opens or closes the bell (the persona's notifications, kept current by refreshChain); the other popups close.
  class bellChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      v.bellOpen = !v.bellOpen;
      v.tabMenuOpen = false;
      v.profileOpen = false;
      v.personaOpen = false;
      v.clockOpen = false;
    }
  }

  return bellChain;
});
