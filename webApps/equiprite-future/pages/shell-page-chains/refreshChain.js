define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/nav',
  'resources/js/shellTabs',
  'resources/js/future/fxStore',
  'resources/js/future/fxShell',
], (ActionChain, Actions, nav, shellTabs, store, fxShell) => {
  'use strict';

  // The store changed (fxRefresh), or the shell is opening: who is played, the menu for them with its badges (the
  // counts of fxViews.work per screen), Playing as and the bell. When someone else is played now (from Playing as,
  // the Guide, My work or another browser tab), the tabs they may not open close and a toast says who is played.
  class refreshChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const was = v.me && v.me.id;
      const me = store.view('me');
      const work = store.view('work');
      v.me = me;
      v.personas = store.view('personas');
      v.menu = nav.visibleGroups(me.roles, nav.badges(work.items));
      v.bell = store.view('notifications');
      if (!was || was === me.id) return;
      let closed = [];
      await shellTabs.update(context, Actions, (st) => {
        const p = fxShell.prune(st.tabs, me.roles);
        closed = p.closed;
        if (!closed.length) return null;
        return { tabs: p.keep, current: p.keep.some((t) => t.id === st.current) ? st.current : (p.keep[0] ? p.keep[0].id : '') };
      });
      Actions.callChain(context, { chain: 'toastChain', params: { message: fxShell.personaToast(me, closed), tone: 'info' } });
    }
  }

  return refreshChain;
});
