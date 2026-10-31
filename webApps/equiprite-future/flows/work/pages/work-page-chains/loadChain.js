define(['vb/action/actionChain', 'resources/js/future/fxPage', 'resources/js/future/fxGuide'], (ActionChain, fx, fxGuide) => {
  'use strict';

  // My work's view model: store.view('work'), with the Guide's steps decorated for the persona played (who plays the
  // next step, the button that plays it). Runs on vbEnter and on every fxRefresh; replaces v, never mutates it.
  class loadChain extends ActionChain {
    async run(context) {
      const v = fx.view('work');
      v.story = fxGuide.story(v.guide, v.me ? v.me.id : '');
      context.$page.variables.v = v;
    }
  }

  return loadChain;
});
