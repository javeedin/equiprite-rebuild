define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestData',
  'resources/js/requestHistory',
  'resources/js/trackList',
], (ActionChain, Actions, requestData, requestHistory, trackList) => {
  'use strict';

  // Opens a request (number) on its equipment and its history, or goes back to the list (no number). The equipment
  // comes from the shared request list; the history is read when the request opens (requestHistory.load: reads only).
  class openChain extends ActionChain {
    async run(context, { number }) {
      const pv = context.$page.variables;
      if (!number) {
        pv.view = 'list';
        pv.sel = {};
        return;
      }
      // Plain copies: the page's variables are proxies, and sel is replaced below.
      const card = (pv.all || []).filter((c) => c.number === String(number))[0];
      if (!card) return;
      const sel = JSON.parse(JSON.stringify(card));
      pv.sel = sel;
      pv.view = 'detail';
      pv.hist = { loading: true, error: '', milestones: [], note: '' };
      if (typeof window !== 'undefined' && window.scrollTo) window.scrollTo(0, 0);
      let lines = [];
      try {
        const data = await requestData.load(context, Actions, {});
        lines = (data.linesByRequest || {})[sel.number] || [];
      } catch (e) {
        lines = [];
      }
      pv.equipment = trackList.equipment(lines, sel.external);
      if (!sel.id) {
        pv.hist = { loading: false, error: 'The history needs a connection.', milestones: [], note: '' };
        return;
      }
      try {
        const h = await requestHistory.load(context, Actions, {
          id: sel.id,
          head: { status: sel.status, external: sel.external, number: sel.number, requestor: sel.requestor, start: sel.start, end: sel.end },
          lines: lines.map((l) => ({ lineStatus: l.lineStatus, start: l.start, end: l.end })),
          now: Date.now(),
        });
        if (!pv.sel || pv.sel.number !== sel.number) return;
        pv.hist = h.error ? { loading: false, error: h.error, milestones: [], note: '' }
          : { loading: false, error: '', milestones: h.milestones, note: h.note };
      } catch (e) {
        if (pv.sel && pv.sel.number === sel.number) pv.hist = { loading: false, error: 'The history could not be read.', milestones: [], note: '' };
      }
    }
  }

  return openChain;
});
