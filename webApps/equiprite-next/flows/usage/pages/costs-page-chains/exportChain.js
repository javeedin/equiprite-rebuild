define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/shellBus',
], (ActionChain, exportKit, bus) => {
  'use strict';

  // Exports the requests as shown (chip, search, sort), with what is ready, posted and running for each.
  class exportChain extends ActionChain {
    async run(context, { format }) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      v.exportOpen = false;
      const chip = fns.listChips(v.list, v.breakdown).filter((c) => c.key === v.chip)[0];
      const res = await exportKit.run(format, {
        name: 'post-costs',
        title: 'Post costs',
        subtitle: [chip && chip.key !== 'all' ? chip.label : 'All requests', v.text ? '"' + v.text + '"' : '', 'Posting is done in New EquipRite'].filter(Boolean).join(' · '),
        rows: fns.shownRows(v.list, v.text, v.chip, v.breakdown, v.sortKey, v.sortDir),
        columns: fns.exportColumns('list'),
      });
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
