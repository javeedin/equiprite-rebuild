define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Requests or Equipment. The status chips count different things in each, so the group starts again at All.
  class setViewChain extends ActionChain {
    async run(context, { view }) {
      const { $page } = context;
      const next = view === 'equipment' ? 'equipment' : 'requests';
      if ($page.variables.view === next) return;
      $page.variables.group = 'all';
      $page.variables.limit = 40;
      $page.variables.view = next;
    }
  }

  return setViewChain;
});
