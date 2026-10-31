define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/future/fxStore',
  'resources/js/future/fxShell',
], (ActionChain, Actions, store, fxShell) => {
  'use strict';

  // The demo clock: open or close its panel (toggle), or move the group's today on: one day (day), a week (week) or
  // to the month end (month; from a month end, the next one). Days pass for everyone (fxEngine: statements accepted
  // by silence, the cut-off's accruals, alerts); the toast says the new day and what happened on the way.
  const MOVES = { day: ['advance', { days: 1 }], week: ['advance', { days: 7 }], month: ['toMonthEnd', {}] };

  class clockChain extends ActionChain {
    async run(context, { action }) {
      const v = context.$page.variables;
      if (!MOVES[action]) {
        v.clockOpen = !v.clockOpen;
        v.bellOpen = false;
        v.profileOpen = false;
        v.personaOpen = false;
        v.tabMenuOpen = false;
        return;
      }
      v.clockOpen = false;
      const before = store.get();
      const notesBefore = store.view('notifications');
      const res = store.act(MOVES[action][0], MOVES[action][1]);
      if (!res.ok) {
        Actions.callChain(context, { chain: 'toastChain', params: { message: res.error, tone: 'error' } });
        return;
      }
      const news = fxShell.clockNews(before, store.get(), notesBefore, store.view('notifications'), store.view('me'));
      Actions.callChain(context, { chain: 'toastChain', params: { message: news.text, tone: 'info' } });
    }
  }

  return clockChain;
});
