define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The search box's keys: ↑ ↓ move through the matches, across the groups (Screens, Requests, Equipment…), Enter
  // opens the one chosen ("N more" shows more of its group), Escape clears, closes and leaves the box (on a phone the
  // box, spread over the toolbar while in use, gives it back). Typed faster than the pause the matches wait for, or
  // with the list closed, the matches are worked out first.
  function clearBox() {
    const box = typeof document !== 'undefined' ? document.getElementById('nxCommand') : null;
    if (box) { box.value = ''; box.blur(); }
  }

  class commandKeyChain extends ActionChain {
    async run(context, { key }) {
      const pv = context.$page.variables;
      if (key === 'Escape') {
        pv.showResults = false;
        pv.query = '';
        clearBox();
        return;
      }
      if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Enter') return;
      if (!(pv.query || '').trim()) return;
      const wasOpen = pv.showResults;
      if (!wasOpen || (pv.search || {}).forQuery !== pv.query) {
        await Actions.callChain(context, { chain: 'searchChain', params: {} });
        if (!wasOpen && key !== 'Enter') return;
      }
      const n = (pv.search || {}).count || 0;
      if (!n) return;
      if (key === 'Enter') {
        await Actions.callChain(context, { chain: 'resultChain', params: { index: pv.resultIndex } });
        return;
      }
      pv.resultIndex = key === 'ArrowDown' ? (pv.resultIndex + 1) % n : (pv.resultIndex - 1 + n) % n;
      setTimeout(() => {
        const el = document.querySelector('#nxResults .nx-result--on');
        if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
      }, 30);
    }
  }

  return commandKeyChain;
});
