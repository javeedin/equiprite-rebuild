define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestData',
  'resources/js/mobileApprove',
  'resources/js/offlineSnapshot',
  'resources/js/currentUser',
  'resources/js/rules',
], (ActionChain, Actions, requestData, ma, snapshot, cu, rules) => {
  'use strict';

  // Loads the queue: the requests and their equipment (requestData: shared with the other tabs for half a minute;
  // Refresh and every write load anew). Reads only. Who may act is EQR_WORKBENCH, as in Next's Approve & allocate:
  // FULL approves, sends back and assigns units (the tab is only there for FULL); anything else is refused (fail
  // closed). With no connection, the queue this phone saved last time is shown, saying when (offlineSnapshot), and
  // nothing can be decided. What was read is kept for applyChain, which builds the queue, keeps it on the phone and
  // sets the tab's count.
  const TRIES = 60;
  const GAP_MS = 50;

  class loadChain extends ActionChain {
    async run(context, { refresh }) {
      const { $page, $application } = context;
      const pv = $page.variables;
      const app = $application.variables;
      const user = cu.auditActor(context) || ($application.user || {}).username || '';
      let fresh = false;
      pv.isLoading = true;
      try {
        for (let i = 0; i < TRIES && !(app.flagsLoaded && app.pageAccessLoaded); i++) {
          await new Promise((r) => setTimeout(r, GAP_MS));
        }
        pv.access = rules.pageAccess(app.pageAccessMap, app.pageAccessLoaded, 'EQR_WORKBENCH');
        pv.canAct = pv.access === 'FULL';
        if (!pv.canAct) {
          pv.all = [];
          pv.error = 'Approving needs full access to Approve & allocate.';
          return;
        }
        const data = await requestData.load(context, Actions, { refresh: !!refresh });
        if (data.error) {
          const kept = snapshot.read('approve', user);
          if (kept && Array.isArray(kept.data)) {
            pv.all = ma.restore(kept.data);
            pv.saved = snapshot.savedText(kept.at, Date.now());
            pv.error = '';
          } else {
            pv.all = [];
            pv.saved = '';
            pv.error = data.error;
          }
        } else {
          $page.functions.setData(data);
          pv.saved = '';
          pv.error = '';
          fresh = true;
        }
      } finally {
        pv.isLoading = false;
      }
      if (!pv.canAct) return;
      await Actions.callChain(context, { chain: 'applyChain', params: { rebuild: fresh } });
      await Actions.callChain(context, { chain: 'focusChain' });
    }
  }

  return loadChain;
});
