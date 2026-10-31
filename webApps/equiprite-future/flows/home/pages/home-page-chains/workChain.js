define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestData',
  'resources/js/requestList',
  'resources/js/myWork',
  'resources/js/rules',
  'resources/js/nav',
  'resources/js/equipmentBoard',
  'resources/js/directReturn',
], (ActionChain, Actions, requestData, list, myWork, rules, nav, board, directReturn) => {
  'use strict';

  // My work for a persona (the user's own, or one an administrator picked): requests and their equipment (shared
  // load), and for those who run the fleet its summary (yard stock, units out, bookings), then what each persona needs.
  const TRIES = 200;
  const GAP_MS = 50;

  class workChain extends ActionChain {
    async run(context, { persona, refresh }) {
      const { $page, $application } = context;
      const v = $page.variables;
      const app = $application.variables;
      v.isLoading = true;
      try {
        for (let i = 0; i < TRIES && !(app.sessionRolesLoaded && app.pageAccessLoaded && app.flagsLoaded); i++) {
          await new Promise((r) => setTimeout(r, GAP_MS));
        }
        const own = rules.persona(app.fusionRoles, app.sessionRoles);
        v.personas = rules.personas(app.fusionRoles, app.sessionRoles);
        const allowed = v.personas.some((p) => p.code === persona);
        const who = allowed ? persona : (own || 'REQUESTOR');
        v.persona = who;
        const canOpen = (navId) => nav.itemVisible(nav.item(navId), app.pageAccessMap, app.pageAccessLoaded, app.featureFlags, app.flagsLoaded, app.buRateSources);
        const fleetWanted = myWork.wantsFleet(who) && canOpen('fleet');
        const [data, fleet] = await Promise.all([
          requestData.load(context, Actions, { refresh: !!refresh }),
          fleetWanted ? this.fleet(context) : Promise.resolve(null),
        ]);
        v.error = data.error || '';
        const now = Date.now();
        const items = list.decorate(data.rows, data.linesByRequest, now);
        v.work = myWork.build(who, items, data.rows, data.linesByRequest, fleet, canOpen, now);
      } catch (e) {
        console.error('[workChain] failed', e);
        v.error = 'Your work could not be loaded.';
      } finally {
        v.isLoading = false;
      }
    }

    /** The fleet's summary (in the yard, out, due back, overdue), or null when it cannot be read. */
    async fleet(context) {
      try {
        const [stock, deployed, lines] = await Promise.all([
          Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1ViewsYardStock', uriParams: { page: 0, size: 10000 } }).catch(() => null),
          directReturn.findDeployedUnits(context, Actions, { size: 2000, lineStatus: 'SHIP_TO_SITE,DEPLOYED,RETURN_INITIATED' }).catch(() => ({ ok: false, rows: [] })),
          Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1ViewsWorkbenchLines', uriParams: { page: 0, size: 2000 } }).catch(() => null),
        ]);
        if (!stock || !stock.ok) return null;
        const rows = (r) => (r && r.ok && r.body && Array.isArray(r.body.data)) ? r.body.data : [];
        return board.summary(board.build(rows(stock), (deployed && deployed.rows) || [], rows(lines), Date.now()));
      } catch (e) {
        return null;
      }
    }
  }

  return workChain;
});
