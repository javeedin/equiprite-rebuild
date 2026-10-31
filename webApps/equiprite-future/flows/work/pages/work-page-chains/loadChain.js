define(['vb/action/actionChain', 'resources/js/future/fxPage', 'resources/js/future/fxGuide', 'resources/js/future/fxReturn'], (ActionChain, fx, fxGuide, fxReturn) => {
  'use strict';

  // My work's view model: store.view('work'), with the Guide's steps decorated for the persona played (who plays the
  // next step, the button that plays it) and its queues in the screens' words (the return on a date: fxReturn.words).
  // Runs on vbEnter and on every fxRefresh; replaces v, never mutates it.
  class loadChain extends ActionChain {
    async run(context) {
      const base = fx.view('work');
      const v = Object.assign({}, base, {
        items: (base.items || []).map((it) => Object.assign({}, it, { label: fxReturn.words(it.label) })),
        myRequests: (base.myRequests || []).map((r) => Object.assign({}, r, { words: fxReturn.words(r.words) }))
      });
      v.story = fxGuide.story(v.guide, v.me ? v.me.id : '');
      context.$page.variables.v = v;
    }
  }

  return loadChain;
});
