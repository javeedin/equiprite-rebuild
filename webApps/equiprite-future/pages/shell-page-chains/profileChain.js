define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // Opens or closes your menu (the EquipRite version, colours, Reset the demo); the other popups close.
  class profileChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      v.profileOpen = !v.profileOpen;
      v.bellOpen = false;
      v.personaOpen = false;
      v.clockOpen = false;
      v.tabMenuOpen = false;
    }
  }

  return profileChain;
});
