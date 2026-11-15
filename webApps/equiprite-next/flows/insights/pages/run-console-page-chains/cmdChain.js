define(['vb/action/actionChain', 'vb/action/actions'], (ActionChain, Actions) => {
  'use strict';

  // The command line's keys: Enter sends what is typed; ↑ and ↓ go back and forth through what was typed before.
  class cmdChain extends ActionChain {
    async run(context, { key, value }) {
      const v = context.$page.variables;
      const set = (t) => { try { const el = document.getElementById('rcCmd'); if (el) { el.value = t; el.setSelectionRange(t.length, t.length); } } catch (e) { /* no DOM */ } };
      const hist = v.hist || [];
      if (key === 'Enter') { await Actions.callChain(context, { chain: 'actChain', params: { act: 'go', key: String(value || '') } }); return; }
      if (key === 'ArrowUp' && hist.length) {
        v.histAt = v.histAt < 0 ? hist.length - 1 : Math.max(0, v.histAt - 1);
        set(hist[v.histAt]);
        return;
      }
      if (key === 'ArrowDown' && v.histAt >= 0) {
        v.histAt = v.histAt + 1;
        if (v.histAt >= hist.length) { v.histAt = -1; set(''); } else set(hist[v.histAt]);
      }
    }
  }
  return cmdChain;
});
