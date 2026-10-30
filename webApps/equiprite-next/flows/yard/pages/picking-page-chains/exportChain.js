define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/yardWork',
  'resources/js/shellBus',
], (ActionChain, exportKit, yw, bus) => {
  'use strict';

  // Exports what is shown: the list as one row per piece (its stage, yard and search), or the open request's pieces in
  // picking with where to pick them. Excel, CSV, PDF or rows to paste.
  class exportChain extends ActionChain {
    async run(context, { format, what }) {
      const v = context.$page.variables;
      v.exportOpen = '';
      let res;
      if (what === 'lines') {
        const number = (v.work.req && v.work.req.requestNumber) || 'request';
        res = await exportKit.run(format, {
          name: number + '-picking',
          title: 'Picking ' + number,
          subtitle: [v.work.req && v.work.req.party, v.work.yards ? 'from ' + v.work.yards : ''].filter((x) => !!x).join(' · '),
          rows: v.work.lines,
          columns: yw.exportColumns('lines-picking'),
        });
      } else {
        const tile = (v.tiles || []).filter((t) => t.key === v.stage)[0];
        res = await exportKit.run(format, {
          name: 'picking',
          title: 'Picking & shipping',
          subtitle: [tile ? tile.label : 'Every stage', v.yard !== 'all' ? v.yard : '', v.text ? '"' + v.text + '"' : ''].filter((x) => !!x).join(' · '),
          // In the list's order (sections, late first), hidden sections included: they are part of what is filtered.
          rows: yw.shownPieces([].concat(...yw.sections('picking', v.shown, {}).map((s) => s.items)), { stage: v.stage, yard: v.yard }),
          columns: yw.exportColumns('picking'),
        });
      }
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
