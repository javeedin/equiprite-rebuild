define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/fddModel',
  'resources/js/nav',
], (ActionChain, Actions, model, nav) => {
  'use strict';

  // The FDD page on entry: the requirements, the flows, the mapping's KPIs and lists, all from resources/js/fddCatalog.js
  // (no server call, nothing written). Which Next screens this user may open is read from page access (as the menu
  // does), so a step's "Open" button shows only for those. Waits a little for page access, as Help does.
  const TRIES = 60;
  const GAP_MS = 50;

  class loadChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const app = context.$application.variables;
      for (let i = 0; i < TRIES && !app.pageAccessLoaded; i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      const names = { nav: {}, open: {} };
      Object.keys(nav.ITEMS).forEach((id) => {
        const it = nav.ITEMS[id];
        names.nav[id] = it.label;
        names.open[id] = !!nav.itemVisible(it, app.pageAccessMap, app.pageAccessLoaded, app.featureFlags, app.flagsLoaded, app.buRateSources);
      });
      v.names = names;
      const all = model.requirementRows(names);
      const view = model.reqView(all, { text: v.reqText, module: v.reqModule, phase: v.reqPhase, kind: v.reqKind });
      v.reqAll = all;
      v.reqView = view;
      v.flows = model.flowList();
      v.flowInfo = model.flowInfo(v.flowId);
      v.kpis = model.kpis();
      v.byModule = model.breakdown('module');
      v.byPhase = model.breakdown('phase');
      v.pendingRows = model.pending(names);
      v.partlyView = model.partlyView(v.partlyKind, names);
      v.mapView = model.mapView(v.mapKind, v.mapStatus, v.mapText, names);
      if (v.tab === 'flows') await Actions.callChain(context, { chain: 'flowChain', params: { act: 'draw', key: '' } });
    }
  }

  return loadChain;
});
