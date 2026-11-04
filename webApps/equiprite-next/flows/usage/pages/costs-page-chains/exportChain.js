define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/shellBus',
], (ActionChain, exportKit, bus) => {
  'use strict';

  // Exports the requests as shown (chip, search, sort), with what is ready, posted and running for each. The Redwood
  // look's table (redwood) exports what it shows, its column filters included (rwApplyChain's rwKeys).
  class exportChain extends ActionChain {
    async run(context, { format, redwood }) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      v.exportOpen = false;
      const chip = fns.listChips(v.list, v.breakdown).filter((c) => c.key === v.chip)[0];
      const keys = redwood ? (v.rwKeys || []).slice() : null;
      const res = await exportKit.run(format, {
        name: 'post-costs',
        title: 'Post costs',
        subtitle: [chip && chip.key !== 'all' ? chip.label : 'All requests', v.text ? '"' + v.text + '"' : ''].filter(Boolean).join(' · '),
        rows: fns.shownRows(v.list, v.text, v.chip, v.breakdown, v.sortKey, v.sortDir).filter((r) => !keys || keys.indexOf(r.requestNumber) !== -1),
        columns: fns.exportColumns('list'),
      });
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
