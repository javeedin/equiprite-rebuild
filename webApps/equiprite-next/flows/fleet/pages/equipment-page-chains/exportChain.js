define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/equipment360',
  'resources/js/shellBus',
], (ActionChain, exportKit, e3, bus) => {
  'use strict';

  // Exports exactly what is shown: the history (the unit chip's entries, newest first) or the units (with their state
  // in the window), and toasts the result.
  class exportChain extends ActionChain {
    async run(context, { what, format }) {
      const v = context.$page.variables;
      v.exportOpen = false;
      const head = v.head || {};
      const title = head.title || head.name || 'equipment';
      let res;
      if (what === 'units') {
        res = await exportKit.run(format, {
          name: title + ' units',
          title: 'Units of ' + (head.name || title),
          subtitle: (v.view && v.view.answer) || '',
          rows: (v.view && v.view.units) || [],
          columns: e3.unitColumns(),
        });
      } else {
        const chip = (v.hv && v.hv.chip) || 'all';
        res = await exportKit.run(format, {
          name: title + ' history',
          title: 'History of ' + title + (chip !== 'all' ? ' · ' + chip : ''),
          subtitle: (v.hist && v.hist.note) || '',
          rows: (v.hv && v.hv.rows) || [],
          columns: e3.historyColumns(),
        });
      }
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
