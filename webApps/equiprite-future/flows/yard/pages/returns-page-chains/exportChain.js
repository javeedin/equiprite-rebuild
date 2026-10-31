define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/yardWork',
  'resources/js/shellBus',
], (ActionChain, exportKit, yw, bus) => {
  'use strict';

  // Exports what is shown: the list as one row per piece (its stage, yard and search, in the list's order), the open
  // request's pieces, or the units a search found. Excel, CSV, PDF or rows to paste.
  class exportChain extends ActionChain {
    async run(context, { format, what }) {
      const v = context.$page.variables;
      v.exportOpen = '';
      let opts;
      if (what === 'lines') {
        const number = (v.work.req && v.work.req.requestNumber) || 'request';
        opts = { name: number + '-returns', title: 'Returns ' + number, subtitle: [v.work.req && v.work.req.party, v.work.yards ? 'back to ' + v.work.yards : '']
          .filter((x) => !!x).join(' · '), rows: v.work.lines, columns: yw.exportColumns('lines-returns') };
      } else if (what === 'found') {
        opts = { name: 'units-in-the-field', title: 'Units in the field', subtitle: v.findQuery ? '"' + v.findQuery + '"' : '', rows: v.found, columns: yw.exportColumns('found') };
      } else {
        const tile = (v.tiles || []).filter((t) => t.key === v.stage)[0];
        opts = {
          name: 'returns',
          title: 'Receiving & returns',
          subtitle: [tile ? tile.label : 'Every stage', v.yard !== 'all' ? v.yard : '', v.text ? '"' + v.text + '"' : ''].filter((x) => !!x).join(' · '),
          rows: yw.shownPieces([].concat(...yw.sections('returns', v.shown, {}).map((s) => s.items)), { stage: v.stage, yard: v.yard }),
          columns: yw.exportColumns('returns'),
        };
      }
      const res = await exportKit.run(format, opts);
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
