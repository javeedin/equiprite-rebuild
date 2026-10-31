define(['vb/action/actionChain', 'resources/js/future/fxStore', 'resources/js/shellBus'], (ActionChain, store, bus) => {
  'use strict';

  // Reset the demo, as the shell's menu does: ask first (ask), then keep the story (cancel) or start it again (confirm:
  // fxStore.reset(), the persona kept). The requests' tabs close, since their requests are gone; every screen
  // refreshes through fxRefresh.
  class resetChain extends ActionChain {
    async run(context, { action }) {
      const pv = context.$page.variables;
      if (action === 'ask') {
        pv.resetAsk = true;
        return;
      }
      pv.resetAsk = false;
      if (action !== 'confirm') return;
      const tabs = (store.get().requests || []).map((r) => 'request:' + r.id);
      store.reset();
      tabs.forEach((id) => bus.close(id));
      pv.drafts = {};
      pv.failure = '';
      const me = store.view('me');
      bus.toast(`The demo starts again on ${me.weekday} ${me.todayText}: the group as it was set up, no requests yet. Still playing as ${me.name}.`, 'info');
    }
  }

  return resetChain;
});
