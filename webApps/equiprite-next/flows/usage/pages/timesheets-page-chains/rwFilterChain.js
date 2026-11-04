define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/usageRedwood',
], (ActionChain, Actions, rw) => {
  'use strict';

  // The Redwood look's Smart Search (your menu, Look): what was typed becomes the page's own search and Status its own
  // chip, through the current look's editChain, so both looks show the same requests. Each is passed on only when it
  // changed in Smart Search (rwPage keeps what Smart Search last said), so picking another filter leaves a chip chosen
  // on the current look alone; Status taken off is All again. The other filters, one per column, narrow the Redwood
  // table only (rwCols, rwApplyChain). Smart Search applies a picked filter as its list closes, as Oracle's (and Old's)
  // does.
  class rwFilterChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const edit = (action, value) => Actions.callChain(context, { chain: 'editChain', params: { action, value } });
      const c = rw.readCriterion(v.rwCriterion);
      const prev = Object.assign({ text: '', status: '' }, JSON.parse(JSON.stringify(v.rwPage || {})));
      const now = { text: c.text, status: c.picks.status || '' };
      v.rwPage = now;
      v.rwCols = rw.colsOf(c.picks, rw.TS_COLS);
      if (now.text !== prev.text && now.text !== String(v.queueText || '').trim()) await edit('queueText', now.text);
      if (now.status !== prev.status && (now.status || 'all') !== v.queueKind) await edit('queueKind', now.status || 'all');
      await Actions.callChain(context, { chain: 'rwApplyChain' });
    }
  }

  return rwFilterChain;
});
