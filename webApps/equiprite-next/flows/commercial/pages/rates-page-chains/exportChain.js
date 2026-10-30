define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/rateRules',
  'resources/js/shellBus',
], (ActionChain, exportKit, R, bus) => {
  'use strict';

  // Exports what is shown: the schedules (the chip and the search, in their order) or the open schedule's rates
  // (Class -> Subclass -> Equipment), as Excel, CSV, PDF or rows to paste.
  class exportChain extends ActionChain {
    async run(context, { what, format }) {
      const v = context.$page.variables;
      v.exportOpen = '';
      let res;
      if (what === 'lines') {
        const name = v.formData.scheduleName || 'Rate schedule';
        res = await exportKit.run(format, {
          name: 'rates-' + name,
          title: name,
          subtitle: [R.taggedTo(v.formData), R.windowText(v.formData), v.formData.currency].filter(Boolean).join(' · '),
          rows: R.sortLines(v.lines || []),
          columns: R.linesExportColumns(),
        });
      } else {
        const chip = (v.chips || []).filter((c) => c.key === v.listChip)[0];
        res = await exportKit.run(format, {
          name: 'rate-schedules',
          title: 'Rate schedules',
          subtitle: [chip && chip.key !== 'all' ? chip.label : 'All', v.listText ? '"' + v.listText + '"' : ''].filter(Boolean).join(' · '),
          rows: v.shown || [],
          columns: R.listExportColumns(),
        });
      }
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
