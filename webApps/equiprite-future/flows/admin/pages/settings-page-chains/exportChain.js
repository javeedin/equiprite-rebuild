define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/settingsKit',
  'resources/js/shellBus',
], (ActionChain, exportKit, kit, bus) => {
  'use strict';

  // Exports one list as shown: the settings (with what each does and changes), the business units, or the change
  // history (its search).
  class exportChain extends ActionChain {
    async run(context, { list, format }) {
      const v = context.$page.variables;
      v.exportOpen = '';
      const spec = kit.exportOf(list);
      const rows = list === 'bu' ? v.vm.bu : (list === 'history' ? v.vm.history : kit.settingExportRows(v.vm.sections));
      const q = list === 'history' ? v.hq : (list === 'settings' ? v.q : '');
      const res = await exportKit.run(format, {
        name: spec.name,
        title: spec.title,
        subtitle: [q ? '"' + q + '"' : '', list === 'settings' && v.vm.pending.count ? v.vm.pending.count + ' unsaved' : ''].filter((x) => !!x).join(' · '),
        rows,
        columns: spec.columns,
      });
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
