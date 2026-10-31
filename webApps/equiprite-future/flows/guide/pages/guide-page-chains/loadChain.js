define(['vb/action/actionChain', 'resources/js/future/fxPage', 'resources/js/future/fxGuide'], (ActionChain, fx, fxGuide) => {
  'use strict';

  // The Guide's view model: store.view('guide') (the steps done or not, the scenarios), who is played, and each
  // step's and scenario's player with the button that plays it. Runs on vbEnter and on every fxRefresh.
  class loadChain extends ActionChain {
    async run(context) {
      const v = fx.view('guide');
      v.me = fx.view('me');
      v.story = fxGuide.story(v, v.me.id);
      context.$page.variables.v = v;
    }
  }

  return loadChain;
});
