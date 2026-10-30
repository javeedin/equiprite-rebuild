define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/availability',
  'resources/js/shellBus',
], (ActionChain, exportKit, av, bus) => {
  'use strict';

  // Exports the bookings shown: the units in the filters (every one, not only the rows on screen), their bookings
  // and planned maintenance in the days the timeline shows, as Excel, CSV, PDF or rows to paste.
  class exportChain extends ActionChain {
    async run(context, { format }) {
      const v = context.$page.variables;
      v.exportOpen = false;
      if (!v.model) return;
      const view = v.view || {};
      const chip = (view.chips || []).filter((c) => c.key === v.chip)[0];
      const yard = (v.yards || []).filter((y) => y.key === v.yard)[0];
      const res = await exportKit.run(format, {
        name: 'availability',
        title: 'Availability: bookings',
        subtitle: [view.range && view.range.label, v.cls || 'All classes', yard ? yard.label : '', chip && chip.key !== 'all' ? chip.label + ' (' + view.win.text + ')' : '',
          v.text ? '"' + v.text + '"' : ''].filter(Boolean).join(' · '),
        rows: av.exportRows(v.model, view.ordered || [], view.range),
        columns: av.exportColumns(),
      });
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
