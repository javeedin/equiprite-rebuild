define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/yardLoad',
  'resources/js/offlineSnapshot',
  'resources/js/currentUser',
  'resources/js/rules',
  'resources/js/mobilePick',
], (ActionChain, Actions, yardLoad, snapshot, cu, rules, mp) => {
  'use strict';

  // Loads what has to go out, as Next's Picking & shipping does (its loadChain, the same calls in the same order): the
  // picking queue (views/workbench-requests?stage=INITIATE&size=1000), then each request's lines
  // (views/request-detail-lines), then the list; the yards follow (lookupYardsChain). Reads only. A newer load
  // (Refresh) makes an older one stop writing (loadToken).
  // Mobile's own: what this person's access lets them do (until access is known, nothing: fail closed), the yard they
  // chose (kept on this phone), and with no connection (or a failed read) the list this phone saved last, saying when.
  const TRIES = 60;
  const GAP_MS = 50;
  const WARM = [['openWorkChain', { id: '' }], ['closeWorkChain', { warm: true }], ['tickChain', { lineId: '' }], ['tickAllChain', { warm: true }],
    ['sheetChain', { sheet: '' }], ['releaseChain', { warm: true }], ['shipChain', { warm: true }], ['scanOpenChain', { warm: true }],
    ['scanCloseChain', {}], ['scanHitChain', { value: '' }], ['connectionChain', { warm: true }], ['torchChain', {}], ['refreshRowChain', { id: '' }]];
  let warmed = false;

  class loadChain extends ActionChain {
    async run(context, { refresh }) {
      const { $application } = context;
      const app = $application.variables;
      const v = context.$page.variables;
      const token = (v.loadToken || 0) + 1;
      v.loadToken = token;
      v.isLoading = true;
      v.error = '';
      const user = cu.auditActor(context) || ($application.user || {}).username || '';
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      let fromPhone = false;
      try {
        for (let i = 0; i < TRIES && !(app.pageAccessLoaded && app.flagsLoaded); i++) {
          await new Promise((r) => setTimeout(r, GAP_MS));
        }
        const flag = (key) => rules.isFeatureEnabled(app.featureFlags, app.flagsLoaded, key) === true;
        v.can = {
          act: rules.pageAccess(app.pageAccessMap, app.pageAccessLoaded, 'EQR_INITIATE_PICKING') === 'FULL',
          slip: flag('SHIPPING_DOCUMENTS_ENABLED'),
          sync: flag('MAINT_ASSET_LOCATION_SYNC_ENABLED'),
          known: !!app.pageAccessLoaded,
        };
        v.online = !offline;
        const kept = mp.read(snapshot, user);
        if (!v.yardKnown) {
          v.yard = kept.yard || 'all';
          v.yardKnown = true;
        }
        const q = offline ? { ok: false, rows: [], error: 'No connection.' } : await yardLoad.queue(context, Actions, 'picking');
        if (v.loadToken !== token) return;
        if (!q.ok) {
          const list = kept.list;
          if (list && Array.isArray(list.records)) {
            fromPhone = true;
            v.linesBy = list.linesBy || {};
            v.yards = list.yards || {};
            v.units = list.units || {};
            v.linesFailed = 0;
            v.records = list.records;
            v.saved = snapshot.savedText(list.at, Date.now());
          } else {
            v.error = 'What has to go out could not be loaded: ' + q.error;
            v.linesFailed = 0;
            v.records = [];
            v.saved = '';
          }
        } else {
          const res = await yardLoad.lines(context, Actions, q.rows);
          if (v.loadToken !== token) return;
          if (refresh) {
            v.yards = {};
            v.units = {};
          }
          v.linesBy = res.linesBy;
          v.linesFailed = res.failed;
          v.records = q.rows;
          v.saved = '';
          mp.keep(snapshot, user, (k, at) => mp.withList(k, q.rows, res.linesBy, v.yards, v.units, at));
        }
      } finally {
        if (v.loadToken === token) v.isLoading = false;
      }
      if (v.loadToken !== token) return;
      await Actions.callChain(context, { chain: 'applyChain' });
      if (v.view === 'work' && v.openId && refresh && !fromPhone) {
        await Actions.callChain(context, { chain: 'openWorkChain', params: { id: v.openId, keepBanner: true } });
      }
      // Not awaited: the list is usable while the yards come in.
      if (!fromPhone) Actions.callChain(context, { chain: 'lookupYardsChain', params: { token } });
      await Actions.callChain(context, { chain: 'focusChain' });
      if (!warmed) {
        warmed = true;
        // VB loads a chain the first time it runs: the steps a person may take with no connection are loaded now (each
        // returns at once), so ticking, the sheets and "No connection: nothing was sent" still work in a yard with no
        // signal.
        WARM.forEach((w) => Actions.callChain(context, { chain: w[0], params: w[1] }).catch(() => {}));
      }
    }
  }

  return loadChain;
});
