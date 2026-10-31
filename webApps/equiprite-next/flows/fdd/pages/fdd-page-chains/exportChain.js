define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/fddModel',
  'resources/js/shellBus',
], (ActionChain, exportKit, model, bus) => {
  'use strict';

  // Exports what the open tab shows (Excel, CSV, PDF or rows to paste): the requirements the filters keep, the open
  // flow's steps, or the mapping rows shown (one kind or everything, with their status, screens, tests and evidence).
  class exportChain extends ActionChain {
    async run(context, { format }) {
      const v = context.$page.variables;
      v.exportOpen = false;
      let opts;
      if (v.tab === 'flows') {
        opts = {
          name: 'equiprite-fdd-flow-' + v.flowId,
          title: 'EquipRite FDD · ' + ((v.flowInfo && v.flowInfo.title) || 'Flow'),
          subtitle: 'Every step: who, the FDD section and status, the integrations, and how far the development has it',
          rows: model.flowRows(v.flowId, v.names),
          columns: model.exportColumns('flows'),
        };
      } else if (v.tab === 'mapping') {
        const kind = (v.mapView.kinds || []).filter((k) => k.key === v.mapKind)[0];
        opts = {
          name: 'equiprite-fdd-mapping',
          title: 'EquipRite FDD mapped to the development',
          subtitle: [(kind && kind.label) || 'Requirements', v.mapStatus !== 'all' ? model.statusLabel(v.mapStatus) : '', v.mapText ? '"' + v.mapText + '"' : '',
            (v.kpis && v.kpis.headline) || ''].filter(Boolean).join(' · '),
          rows: v.mapView.rows,
          columns: model.exportColumns('mapping'),
        };
      } else {
        opts = {
          name: 'equiprite-fdd-requirements',
          title: 'EquipRite FDD requirements',
          subtitle: [v.reqView.summary, v.reqText ? '"' + v.reqText + '"' : ''].filter(Boolean).join(' · '),
          rows: model.exportRequirements(v.reqView.shown),
          columns: model.exportColumns('requirements'),
        };
      }
      const res = await exportKit.run(format, opts);
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
