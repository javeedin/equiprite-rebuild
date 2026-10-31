define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/directReturn',
  'resources/js/equipmentBoard',
], (ActionChain, Actions, directReturn, board) => {
  'use strict';

  // The fleet, unit by unit, from three views at once (one failing leaves the others):
  //   views/yard-stock        every unit and its status
  //   views/deployed-units    units out, with request, dates and the server's overdue flag (Direct Return's search,
  //                           widened to units on their way to site)
  //   views/workbench-lines   allocated lines: each unit's current and next booking
  // joined by equipmentBoard.build. Reads only.
  const OUT_LINE_STATUSES = 'SHIP_TO_SITE,DEPLOYED,RETURN_INITIATED';

  class loadFleetChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;
      v.isLoading = true;
      try {
        const [stock, deployed, lines] = await Promise.all([
          Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1ViewsYardStock', uriParams: { page: 0, size: 10000 } }).catch(() => null),
          directReturn.findDeployedUnits(context, Actions, { size: 2000, lineStatus: OUT_LINE_STATUSES }).catch(() => ({ ok: false, rows: [] })),
          Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1ViewsWorkbenchLines', uriParams: { page: 0, size: 2000 } }).catch(() => null),
        ]);
        const rows = (r) => (r && r.ok && r.body && Array.isArray(r.body.data)) ? r.body.data : [];
        const missing = [];
        if (!stock || !stock.ok) missing.push('the unit list (yard stock)');
        if (!deployed || !deployed.ok) missing.push('units out on rent');
        if (!lines || !lines.ok) missing.push('bookings');
        v.units = board.build(rows(stock), (deployed && deployed.rows) || [], rows(lines), Date.now());
        v.error = missing.length ? (missing.length === 3 ? 'The fleet could not be loaded.' : 'Not loaded: ' + missing.join(', ') + '. The rest is shown.') : '';
      } catch (e) {
        console.error('[loadFleetChain] failed', e);
        v.units = [];
        v.error = 'The fleet could not be loaded.';
      } finally {
        v.isLoading = false;
      }
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return loadFleetChain;
});
