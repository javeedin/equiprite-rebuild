define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/fddModel',
], (ActionChain, Actions, model) => {
  'use strict';

  // A tab, a filter, a search, a row opened or closed, or the export menu. Each view is worked out first and set in one
  // step (fddModel.reqView / mapView / partlyView), so the page never shows a filter with the old rows.
  const REQ = { reqText: 1, reqModule: 1, reqPhase: 1, reqKind: 1 };
  const MAP = { mapKind: 1, mapStatus: 1, mapText: 1 };

  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const v = context.$page.variables;
      if (field === 'exportOpen') { v.exportOpen = value === 'toggle' ? !v.exportOpen : !!value; return; }
      if (field === 'tab') {
        v.exportOpen = false;
        v.tab = value || 'requirements';
        if (v.tab === 'flows') await Actions.callChain(context, { chain: 'flowChain', params: { act: 'draw', key: '' } });
        return;
      }
      if (field === 'reqOpen' || field === 'mapOpen') {
        v[field] = v[field] === value ? '' : (value || '');
        return;
      }
      if (REQ[field]) {
        const f = { text: v.reqText, module: v.reqModule, phase: v.reqPhase, kind: v.reqKind };
        f[{ reqText: 'text', reqModule: 'module', reqPhase: 'phase', reqKind: 'kind' }[field]] = field === 'reqText' ? String(value || '') : (value || 'all');
        const view = model.reqView(v.reqAll, f);
        v[field] = field === 'reqText' ? String(value || '') : (value || 'all');
        v.reqView = view;
        return;
      }
      if (MAP[field]) {
        const kind = field === 'mapKind' ? (value || 'requirements') : v.mapKind;
        const status = field === 'mapStatus' ? (value || 'all') : (field === 'mapKind' ? 'all' : v.mapStatus);
        const text = field === 'mapText' ? String(value || '') : v.mapText;
        const view = model.mapView(kind, status, text, v.names);
        v.mapKind = kind;
        v.mapStatus = status;
        v.mapText = text;
        v.mapOpen = '';
        v.mapView = view;
        return;
      }
      if (field === 'partlyKind') {
        const view = model.partlyView(value || 'requirements', v.names);
        v.partlyKind = value || 'requirements';
        v.partlyView = view;
      }
    }
  }

  return setChain;
});
