define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/future/fxStore',
], (ActionChain, Actions, store) => {
  'use strict';

  // Playing as: open or close the list (action toggle), or play someone else (id). The store says who is played;
  // its change reaches the shell and every open screen as fxRefresh (refreshChain: the menu, the badges, the bell,
  // the tabs they may not open, the toast).
  class personaChain extends ActionChain {
    async run(context, { action, id }) {
      const v = context.$page.variables;
      if (action === 'toggle' || !id) {
        v.personaOpen = !v.personaOpen;
        v.bellOpen = false;
        v.profileOpen = false;
        v.clockOpen = false;
        v.tabMenuOpen = false;
        return;
      }
      v.personaOpen = false;
      if (v.me && v.me.id === id) return;
      const res = store.act('setPersona', { id });
      if (!res.ok) Actions.callChain(context, { chain: 'toastChain', params: { message: res.error, tone: 'error' } });
    }
  }

  return personaChain;
});
