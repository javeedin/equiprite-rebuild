define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Arrow keys move through the matches, Enter opens one, Escape clears.
  class commandKeyChain extends ActionChain {
    async run(context, { key }) {
      const { $page } = context;
      const n = ($page.variables.results || []).length;
      if (key === 'ArrowDown' && n) $page.variables.resultIndex = ($page.variables.resultIndex + 1) % n;
      else if (key === 'ArrowUp' && n) $page.variables.resultIndex = ($page.variables.resultIndex - 1 + n) % n;
      else if (key === 'Enter' && n && $page.variables.showResults) await Actions.callChain(context, { chain: 'resultChain', params: { index: $page.variables.resultIndex } });
      else if (key === 'Escape') {
        $page.variables.showResults = false;
        $page.variables.query = '';
      }
    }
  }

  return commandKeyChain;
});
