define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The toolbar search, as it is typed: the words are kept at once, and the matches (searchChain: screens, requests,
  // equipment, units, transfers) are worked out once typing pauses (DEBOUNCE_MS), so typing never waits for them.
  // Enter and the arrow keys do not wait for the pause (commandKeyChain asks for the matches at once).
  const DEBOUNCE_MS = 80;
  let seq = 0;

  class commandChain extends ActionChain {
    async run(context, { text }) {
      const pv = context.$page.variables;
      const q = String(text || '');
      const search = pv.search || {};
      pv.query = q;
      const mine = ++seq;
      if (!q.trim()) {
        pv.showResults = false;
        pv.results = [];
        pv.search = Object.assign({}, search, { forQuery: '', expanded: '', count: 0 });
        return;
      }
      await new Promise((r) => setTimeout(r, DEBOUNCE_MS));
      if (mine !== seq) return;
      // "N more" opened a group for the words before: new words start from the groups' first rows again.
      if ((pv.search || {}).expanded) pv.search = Object.assign({}, pv.search, { expanded: '' });
      await Actions.callChain(context, { chain: 'searchChain', params: {} });
    }
  }

  return commandChain;
});
