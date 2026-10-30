define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/accessMatrix',
  'resources/js/shellBus',
], (ActionChain, exportKit, access, bus) => {
  'use strict';

  // Exports the matrix as shown: a row per page, a column per role (an unsaved level says so).
  class exportChain extends ActionChain {
    async run(context, { format }) {
      const v = context.$page.variables;
      v.exportOpen = false;
      const res = await exportKit.run(format, {
        name: 'access',
        title: 'Access by role and page',
        subtitle: [v.only === 'changed' ? 'Changed pages' : (v.only === 'locked' ? 'Locked pages' : 'Every page'), v.text ? '"' + v.text + '"' : '',
          v.dirtyCount ? v.dirtyCount + ' unsaved' : ''].filter(Boolean).join(' · '),
        rows: v.shown,
        columns: access.exportColumns(v.roles),
      });
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
