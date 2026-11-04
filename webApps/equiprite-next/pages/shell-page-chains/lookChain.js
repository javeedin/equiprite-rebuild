define([
  'vb/action/actionChain',
  'resources/js/look',
  'resources/js/currentUser',
], (ActionChain, look, currentUser) => {
  'use strict';

  // Your look, Redwood or Current (resources/js/look.js), on every screen. With nothing: the look kept for you on this
  // computer (the shell opening, once it knows who you are). With a look (your menu): that, shown at once on every
  // screen and kept for you.
  class lookChain extends ActionChain {
    async run(context, { look: want }) {
      const v = context.$page.variables;
      const user = currentUser.auditActor(context);
      if (want) look.save(user, want);
      v.look = look.apply(want || look.load(user));
    }
  }

  return lookChain;
});
