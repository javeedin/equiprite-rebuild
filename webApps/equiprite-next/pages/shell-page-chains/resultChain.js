define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class resultChain extends ActionChain {
    async run(context, { index }) {
      const { $page } = context;
      const r = ($page.variables.results || [])[Number(index)];
      $page.variables.showResults = false;
      $page.variables.query = '';
      const box = document.getElementById('nxCommand');
      if (box) { box.value = ''; box.blur(); }
      if (!r) return;
      await Actions.callChain(context, { chain: 'openChain', params: r.kind === 'record' ? { record: r.record, params: r.params } : { navId: r.navId } });
    }
  }

  return resultChain;
});
