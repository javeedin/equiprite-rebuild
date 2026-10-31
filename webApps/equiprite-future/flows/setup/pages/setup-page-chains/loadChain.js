define(['vb/action/actionChain', 'resources/js/future/fxPage', 'resources/js/future/fxSetup'], (ActionChain, fx, fxSetup) => {
  'use strict';

  // Companies & agreements' view model: fxSetup.setup() over fxViews.setup (the companies, BUs, orgs, people,
  // relationships, agreements and decisions, with what each change does). Runs on vbEnter and on every fxRefresh;
  // replaces v, never mutates it; never throws.
  class loadChain extends ActionChain {
    async run(context) {
      let v;
      try {
        v = Object.assign({ ready: true, error: '' }, fxSetup.setup(fx.store.get()));
      } catch (e) {
        v = { ready: true, error: 'The setup could not be shown: ' + String((e && e.message) || e), canEdit: false, whyNot: '', today: '', me: fx.view('me'), companies: [], bus: [], orgs: [],
          people: [], relations: [], agreements: [], settings: [], fixed: [], counts: {}, gr6: '' };
      }
      context.$page.variables.v = v;
    }
  }

  return loadChain;
});
