define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/fddModel',
  'resources/js/shellBus',
], (ActionChain, exportKit, model, bus) => {
  'use strict';

  // Exports what the open tab shows (Excel, CSV, PDF or rows to paste): the requirements the filters keep, the open
  // flow's steps, or on Mapping the drill when one is open (exactly its rows, as narrowed; To reach 100% then lists the
  // integrations and decision points not done), else the mapping rows shown (one kind or everything, with their status,
  // Next screens, phone, tests and evidence). Both the page's Export and the drill's call it.
  class exportChain extends ActionChain {
    async run(context, { format }) {
      const v = context.$page.variables;
      v.exportOpen = false;
      v.drillExportOpen = false;
      let opts;
      if (v.tab === 'flows') {
        opts = {
          name: 'equiprite-fdd-flow-' + v.flowId,
          title: 'EquipRite FDD · ' + ((v.flowInfo && v.flowInfo.title) || 'Flow'),
          subtitle: 'Every step: who, the FDD section and status, the integrations, and how far EquipRite Next has it',
          rows: model.flowRows(v.flowId, v.names),
          columns: model.exportColumns('flows'),
        };
      } else if (v.tab === 'mapping' && v.drill && v.drill.open) {
        const d = v.drill;
        const x = model.drillExport(d);
        const path = (d.crumbs || []).filter((c) => c.key !== 'mapping').map((c) => c.label).join(' › ');
        opts = {
          name: 'equiprite-fdd-' + String((v.drillSpec && v.drillSpec.source) || 'drill').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
            + (d.status !== 'all' ? '-' + d.status : '') + (d.module !== 'all' ? '-' + d.module : ''),
          title: 'EquipRite FDD · Mapping › ' + path,
          subtitle: [d.summary, d.text ? '"' + d.text + '"' : '', 'EquipRite Next with its phone app, as checked on 31 Oct 2026'].filter(Boolean).join(' · '),
          rows: x.rows,
          columns: x.columns,
        };
      } else if (v.tab === 'mapping') {
        const kind = (v.mapView.kinds || []).filter((k) => k.key === v.mapKind)[0];
        opts = {
          name: 'equiprite-fdd-mapping',
          title: 'EquipRite FDD mapped to EquipRite Next',
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
