define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/shellTabs',
  'resources/js/future/fxStore',
], (ActionChain, Actions, shellTabs, store) => {
  'use strict';

  // Reset the demo, from your menu: ask first (ask), then either keep the story (cancel) or start it again (confirm:
  // fxStore.reset(), the persona kept). The requests' tabs close, since their requests are gone.
  class resetChain extends ActionChain {
    async run(context, { action }) {
      const v = context.$page.variables;
      if (action === 'ask') {
        v.profileOpen = false;
        v.resetAsk = true;
        return;
      }
      v.resetAsk = false;
      if (action !== 'confirm' && action !== 'erase') return;
      store.reset({ erase: action === 'erase' });
      await shellTabs.update(context, Actions, (st) => {
        const keep = st.tabs.filter((t) => String(t.id).indexOf(':') === -1);
        if (keep.length === st.tabs.length) return null;
        return { tabs: keep, current: keep.some((t) => t.id === st.current) ? st.current : (keep[0] ? keep[0].id : '') };
      });
      const me = store.view('me');
      Actions.callChain(context, { chain: 'toastChain', params: {
        message: action === 'erase'
          ? `Everything erased (the story, its history and the snapshots). Fresh start on ${me.weekday} ${me.todayText}: no requests yet. Still playing as ${me.name}.`
          : `Fresh start on ${me.weekday} ${me.todayText}: the group as it was set up, no requests yet (the old story is kept as a snapshot). Still playing as ${me.name}.`, tone: 'info' } });
    }
  }

  return resetChain;
});
