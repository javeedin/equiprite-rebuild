define(['vb/action/actionChain', 'resources/js/future/fxPage', 'resources/js/future/fxFdd2'], (ActionChain, fx, fxFdd2) => {
  'use strict';

  // FDD 2.0's view model: who is played (store.view('me')), the document's address and its PDF's under this app
  // ($application.path), and its chapters. Runs on vbEnter and on every fxRefresh; the iframe's src is set the first
  // time only, so a change in the store (the persona, the demo clock) never reloads or moves the document.
  class loadChain extends ActionChain {
    async run(context) {
      const base = context.$application.path || '';
      context.$page.variables.v = Object.assign(fx.view('me'), fxFdd2.doc(base));
      if (!context.$page.variables.src) {
        context.$page.variables.src = fxFdd2.src(base, context.$page.variables.chapter);
      }
    }
  }

  return loadChain;
});
