define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestData',
  'resources/js/trackList',
  'resources/js/offlineSnapshot',
  'resources/js/currentUser',
  'resources/js/rules',
  'resources/js/mobileRecent',
], (ActionChain, Actions, requestData, trackList, snapshot, cu, rules, recent) => {
  'use strict';

  // Loads the requests and their equipment (requestData: shared with the other tabs for half a minute; Refresh loads
  // anew) and makes a card of each of yours, or everyone's for a manager who asks. Which steps a card offers follows
  // page access, as on the tabs that take them; until access has loaded, none (fail closed).
  // With no connection, the cards this phone saved the last time are shown, saying so (offlineSnapshot). The list opens
  // on the chip that holds what needs you among the requests of the period shown (the last few days: mobileRecent).
  const TRIES = 60;
  const GAP_MS = 50;

  class loadChain extends ActionChain {
    async run(context, { refresh, scope }) {
      const { $page, $application } = context;
      const app = $application.variables;
      const pv = $page.variables;
      if (scope === 'mine' || scope === 'all') pv.scope = scope;
      pv.isLoading = true;
      const user = cu.auditActor(context) || ($application.user || {}).username || '';
      const who = [user, cu.displayName(context), ($application.user || {}).username];
      try {
        for (let i = 0; i < TRIES && !app.pageAccessLoaded; i++) {
          await new Promise((r) => setTimeout(r, GAP_MS));
        }
        const access = (code) => rules.pageAccess(app.pageAccessMap, app.pageAccessLoaded, code);
        pv.can = { decide: access('EQR_WORKBENCH') === 'FULL', pick: access('EQR_INITIATE_PICKING') !== 'HIDDEN',
          request: access('EQR_PROJ_CREATE_REQUEST') === 'FULL' };
        const data = await requestData.load(context, Actions, { refresh: !!refresh });
        pv.manager = !!data.manager;
        if (!pv.manager) pv.scope = 'mine';
        if (data.error) {
          const kept = snapshot.read('track:' + pv.scope, user);
          if (kept && Array.isArray(kept.data)) {
            pv.all = trackList.restore(kept.data);
            pv.saved = snapshot.savedText(kept.at, Date.now());
            pv.error = '';
          } else {
            pv.all = [];
            pv.saved = '';
            pv.error = data.error;
          }
        } else {
          pv.all = trackList.cards(data.rows, data.linesByRequest, { who, scope: pv.scope, can: pv.can, now: Date.now() });
          pv.saved = '';
          pv.error = '';
          snapshot.save('track:' + pv.scope, user, trackList.keep(pv.all), Date.now());
        }
        if (!pv.chip) pv.chip = trackList.firstChip(recent.view(pv.all, pv.period, '', Date.now()).list);
      } finally {
        pv.isLoading = false;
      }
      await Actions.callChain(context, { chain: 'applyChain' });
      // An open request is shown again from the new list (its next step may have changed).
      if (pv.view === 'detail' && pv.sel && pv.sel.number) {
        const again = pv.all.filter((c) => c.number === pv.sel.number)[0];
        if (again) pv.sel = again;
      }
      await Actions.callChain(context, { chain: 'focusChain' });
    }
  }

  return loadChain;
});
