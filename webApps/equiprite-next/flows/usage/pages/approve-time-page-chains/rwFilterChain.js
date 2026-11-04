define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/usageRedwood',
], (ActionChain, Actions, rw) => {
  'use strict';

  // The Redwood look's Smart Search (your menu, Look). The page's own filters go through the current look's filterChain,
  // so both looks show the same week and lines: Week (the week chips), Status (the status buttons), what was typed (the
  // search) and Hours "Needs a look" ("Needs a look only"). Each is passed on only when it changed in Smart Search
  // (rwPage keeps what Smart Search last said), so picking another filter leaves a week chosen on the current look alone;
  // one taken off goes back to the page's default (the newest week with lines waiting; To approve). The other filters,
  // one per column, narrow the Redwood table only (rwCols, rwApplyChain). Smart Search applies a picked filter as its
  // list closes, as Oracle's (and Old's) does.
  class rwFilterChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      const filter = (action, value) => Actions.callChain(context, { chain: 'filterChain', params: { action, value } });
      const c = rw.readCriterion(v.rwCriterion);
      const prev = Object.assign({ text: '', week: '', status: '', hours: '' }, JSON.parse(JSON.stringify(v.rwPage || {})));
      const now = { text: c.text, week: c.picks.week || '', status: c.picks.status || '', hours: c.picks.hours || '' };
      v.rwPage = now;
      v.rwCols = rw.colsOf(c.picks, rw.TA_COLS);
      if (now.week !== prev.week) {
        const week = now.week || fns.defaultWeek(v.rowsAll);
        if (week && week !== v.weekKey) await filter('week', week);
      }
      if (now.status !== prev.status && (now.status || 'SUBMITTED') !== v.statusKey) await filter('status', now.status || 'SUBMITTED');
      if (now.text !== prev.text && now.text !== String(v.searchText || '').trim()) await filter('text', now.text);
      if ((now.hours === 'look') !== (prev.hours === 'look') && (now.hours === 'look') !== !!v.onlyLook) await filter('onlyLook');
      await Actions.callChain(context, { chain: 'rwApplyChain' });
    }
  }

  return rwFilterChain;
});
