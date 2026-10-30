define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/analyticsData',
  'resources/js/requestData',
  'resources/js/requestList',
  'resources/js/insightsModel',
], (ActionChain, Actions, analyticsData, requestData, list, model) => {
  'use strict';

  // Loads the data behind one question, then shows it (applyChain).
  //   fleet  analyticsData.loadActiveTab on the 'equipment-master' tab: yard-stock?groupBy=unitStatus (the fleet
  //          tiles and status mix), yard-stock?size=2000 (the units), yard-stock?groupBy=className. New EquipRite's
  //          module, unchanged, so the calls, their order and every number are New's.
  //   use    analyticsData.loadActiveTab on 'equip-utilization': yard-utilization?size=2000&fromDate&toDate, then
  //          yard-stock?groupBy=unitStatus.
  //   late, flow  requestData.load (views/my-requests and views/my-request-lines, shared with Requests and the bell).
  //   cost   views/project-cost-detail?page=0&size=2000, the call Old EquipRite's Reports page makes for Project cost
  //          detail with no filter (reportsData.loadTab).
  // loadActiveTab writes its results onto the $page it is handed; it gets a page of its own here, so this page's
  // variables stay this page's. Its calls go through a recorder (as New's loadReportChain does) because the module
  // only logs a failed call, and the page should say when a figure is missing.
  // One sequence per data set (late and flow share the requests): a slower, older load of the same data never
  // overwrites a newer one, and a load of another question is kept for when it is picked.
  const seq = { fleet: 0, use: 0, req: 0, cost: 0 };
  let pending = 0;
  const GROUP = { fleet: 'fleet', use: 'use', late: 'req', flow: 'req', cost: 'cost' };

  function scratch(tab, win) {
    return {
      variables: {
        useMockData: false, analyticsActiveTab: tab, analyticsFilterCriterion: null, selectedYard: null, selectedUnitStatus: null,
        selectedLineStatus: null, selectedUnitType: null, utilFromDate: win.fromDate, utilToDate: win.toDate,
      },
    };
  }

  class loadChain extends ActionChain {
    async run(context, { report, refresh }) {
      const { $page } = context;
      const v = $page.variables;
      const key = report || v.report;
      if (!key || !GROUP[key]) return;
      const group = GROUP[key];
      const mySeq = ++seq[group];
      pending++;
      const failed = [];
      const recording = {
        async callRest(ctx, options) {
          let res = null;
          try {
            res = await Actions.callRest(ctx, options);
          } catch (e) {
            res = null;
          }
          if (!res || !res.ok) failed.push({ endpoint: options && options.endpoint, status: res ? res.status : 0 });
          return res;
        },
      };
      v.isLoading = true;
      let raw = {};
      let error = '';
      const done = {};
      try {
        if (key === 'fleet') {
          const p = scratch('equipment-master', v.win);
          await analyticsData.loadActiveTab(p, context, recording);
          raw = { stockRows: p.variables.stockRows || [], kpis: p.variables.analyticsKpis || {}, mixGroups: p.variables.chartDonutGroups || [],
            mixSeries: p.variables.chartDonutSeries || [], classGroups: p.variables.chartBarGroups || [] };
          done.fleet = true;
        } else if (key === 'use') {
          const p = scratch('equip-utilization', v.win);
          await analyticsData.loadActiveTab(p, context, recording);
          raw = { utilRows: p.variables.utilExportRows || [], utilKpis: p.variables.analyticsKpis || {}, utilWin: Object.assign({}, v.win) };
          done.use = true;
        } else if (key === 'late' || key === 'flow') {
          const data = await requestData.load(context, Actions, { refresh: !!refresh });
          error = data.error || '';
          raw = { rows: data.rows || [], linesByRequest: data.linesByRequest || {}, linesLoaded: !!data.linesLoaded, reqAt: data.at || Date.now() };
          done.late = true;
          done.flow = true;
        } else if (key === 'cost') {
          const res = await recording.callRest(context, {
            endpoint: 'eqp-v1/getEquipriteV1ViewsProjectCostDetail2',
            uriParams: { page: 0, size: analyticsData.PAGE_SIZE },
          });
          raw = { costRows: res && res.ok && res.body && Array.isArray(res.body.data) ? res.body.data : [] };
          done.cost = true;
        }
      } catch (e) {
        console.error('[analytics loadChain] failed', e);
        error = 'This report could not be loaded. Try Refresh in a minute.';
      }
      pending = Math.max(0, pending - 1);
      // A newer load of the same data (Refresh, a new period) started while this one ran: it owns the result.
      if (mySeq !== seq[group]) return;
      v.raw = Object.assign({}, v.raw, raw);
      const errors = Object.assign({}, v.errors);
      Object.keys(done).forEach((k) => { errors[k] = error || model.loadErrorText(failed); });
      v.errors = errors;
      v.loaded = Object.assign({}, v.loaded, done);
      v.checkedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      v.isLoading = pending > 0;
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return loadChain;
});
