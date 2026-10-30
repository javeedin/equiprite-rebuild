define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/shellBus',
], (ActionChain, Actions, bus) => {
  'use strict';

  // Shows what another screen handed over (Help, "See them in Requests": a stage), once the list has loaded: the list
  // view, that stage's chip, the search cleared.
  class focusChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      for (let i = 0; i < 600 && v.isLoading; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      const what = bus.takeFocus('requests');
      if (!what || !what.stage) return;
      v.stage = String(what.stage);
      v.text = '';
      v.source = '';
      // A native input stops following its bound value once typed in: clear it too.
      const box = typeof document !== 'undefined' ? document.querySelector('.nx-requests .nx-search input') : null;
      if (box) box.value = '';
      await Actions.callChain(context, { chain: 'applyChain', params: { view: 'list' } });
    }
  }

  return focusChain;
});
