define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/availability',
  'resources/js/availabilityPivot',
  'resources/js/shellBus',
], (ActionChain, exportKit, av, pivot, bus) => {
  'use strict';

  // Exports what the card shows. The timeline: the bookings shown, the units in the filters (every one, not only the
  // rows on screen), their bookings and planned maintenance in the days the timeline shows. The yard grid: the grid
  // as shown, equipment (or units) by yard with the ticks, every row in the filters (folded or not), then the totals.
  // As Excel, CSV, PDF or rows to paste.
  class exportChain extends ActionChain {
    async run(context, { format }) {
      const v = context.$page.variables;
      v.exportOpen = false;
      if (!v.model) return;
      const view = v.view || {};
      const chip = (view.chips || []).filter((c) => c.key === v.chip)[0];
      const yard = (v.yards || []).filter((y) => y.key === v.yard)[0];
      const filters = [v.cls || 'All classes', yard ? yard.label : '', chip && chip.key !== 'all' ? chip.label + ' (' + view.win.text + ')' : '',
        v.text ? '"' + v.text + '"' : ''];
      let res;
      if (v.layout === 'grid') {
        const units = v.grain === 'units';
        const table = pivot.exportTable(v.model, pivot.optionsFrom(v, view.ordered || []));
        res = await exportKit.run(format, {
          name: 'availability-yard-grid',
          title: 'Availability: ' + (units ? 'units' : 'equipment') + ' by yard',
          subtitle: ['Free in your window ' + (view.win ? view.win.text : '')].concat(filters).filter(Boolean).join(' · '),
          rows: table.rows,
          columns: table.columns,
        });
      } else {
        res = await exportKit.run(format, {
          name: 'availability',
          title: 'Availability: bookings',
          subtitle: [view.range && view.range.label].concat(filters).filter(Boolean).join(' · '),
          rows: av.exportRows(v.model, view.ordered || [], view.range),
          columns: av.exportColumns(),
        });
      }
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
