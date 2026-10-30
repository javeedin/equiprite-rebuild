define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/mobileApprove',
], (ActionChain, Actions, ma) => {
  'use strict';

  // Opens a request of the queue (its key), or goes back to the queue (no key). What was chosen, half written or
  // staged on the previous request is dropped with it (Next's selectChain). Online, the request is read in full
  // (recordChain: reads only); from the phone's saved copy (no connection), what the card knew is shown, with nothing
  // to act on.
  const EMPTY_SUGG = { loading: false, byLine: {}, plan: { count: 0, lines: [], none: [], label: '' } };

  class openChain extends ActionChain {
    async run(context, { key }) {
      const { $page } = context;
      const pv = $page.variables;
      if (pv.busy) return;
      pv.recSeq = (pv.recSeq || 0) + 1;
      pv.ticks = [];
      pv.sheet = '';
      pv.reason = '';
      pv.formError = '';
      pv.result = null;
      pv.pickNote = '';
      pv.picker = { lineId: '' };
      $page.functions.clearPicker();
      $page.functions.setSuggestions({});
      pv.sugg = JSON.parse(JSON.stringify(EMPTY_SUGG));
      const card = key ? (pv.all || []).filter((c) => c.key === String(key))[0] : null;
      if (!card) {
        pv.view = 'list';
        pv.current = { key: '' };
        pv.position = '';
        pv.rec = { loading: false, error: '', offline: false, head: {}, rows: [], verdict: { tone: '', text: '', next: '' } };
        pv.lines = [];
        return;
      }
      // A plain copy: the page's variables are proxies, and current is replaced on every read.
      const cur = JSON.parse(JSON.stringify(card));
      pv.current = cur;
      pv.position = ma.position(pv.shown, cur.key);
      pv.lines = [];
      pv.view = 'detail';
      if (typeof window !== 'undefined' && window.scrollTo) window.scrollTo(0, 0);
      if (pv.saved || cur.offline) {
        pv.rec = ma.offlineRec(cur, pv.saved);
        return;
      }
      pv.rec = { loading: true, error: '', offline: false, head: {}, rows: [], verdict: { tone: '', text: '', next: '' } };
      await Actions.callChain(context, { chain: 'recordChain', params: {} });
    }
  }

  return openChain;
});
