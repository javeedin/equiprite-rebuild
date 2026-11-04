define([
  'vb/action/actionChain',
  'resources/js/customerPortal',
  'resources/js/portalView',
  'resources/js/portalRedwood',
], (ActionChain, portal, V, R) => {
  'use strict';

  // What every view shows, worked out from what was read: the requests read from their equipment, what needs the
  // customer (New's todo), the tiles, what is on its way and on site, and each list filtered, searched and sorted.
  // Each view has rows of its own, so switching views never shows one view's rows in another's template.
  const RECENT = 6;

  class applyChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const now = Date.now();
      const rows = V.decorate(v.base, v.linesById, { quotingAllowed: v.quotingAllowed, now });
      const eq = V.equipmentRows(v.base, v.linesById, now);
      const totals = portal.invoiceTotals(v.invoiceBase);
      const inv = V.invoiceRows(v.invoiceBase, v.base, v.linesById);
      const needs = V.needs(v.base, v.linesById, v.billingShown ? totals : null,
        { quotingAllowed: v.quotingAllowed, overdueRequest: V.overdueRequest(v.invoiceBase, v.base) });

      v.rows = rows;
      v.totals = totals;
      v.needs = needs;
      v.tiles = V.tiles(rows, eq, totals, v.billingShown, now);
      v.customerName = V.customerOf(v.base);
      v.summary = V.summary(v.customerName, rows, needs.length, v.isLoading && !rows.length);
      v.recent = rows.slice().sort((a, b) => {
        const x = a.createdRaw ? new Date(a.createdRaw).getTime() : 0;
        const y = b.createdRaw ? new Date(b.createdRaw).getTime() : 0;
        return y - x || Number(b.id || 0) - Number(a.id || 0);
      }).slice(0, RECENT);
      v.onWay = eq.filter((e) => e.stage === 'out');
      v.onSite = eq.filter((e) => e.stage === 'onsite').sort((a, b) => (b.late ? 1 : 0) - (a.late ? 1 : 0) || String(a.end || '').localeCompare(String(b.end || '')));

      v.reqChips = V.requestChips(rows);
      v.reqShown = V.sortRequests(V.filterRequests(rows, v.reqGroup, v.reqText), v.reqSort, v.reqDir);
      v.eqChips = V.equipmentChips(eq);
      v.eqShown = V.filterEquipment(eq, v.eqChip, v.eqText);
      v.invChips = V.invoiceChips(inv);
      v.invShown = V.filterInvoices(inv, v.invChip, v.invText);

      // The Redwood view's requests (Smart Search over an oj-table): the same requests, then its column filters, which
      // the current look does not show and so never narrow it; and every filter's options with their counts.
      // Its Show is its own (rwGroup: nothing picked is every request, as in Old), so the current look keeps its own.
      v.rwShown = R.byColumns(V.sortRequests(V.filterRequests(rows, v.rwGroup, v.reqText), v.reqSort, v.reqDir), v.rwCols, now);
      v.rwRows = R.rows(v.rwShown, now);
      const opts = R.options(rows, v.reqChips, now);
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      [['rwNumbers', 'number'], ['rwDates', 'dates'], ['rwStatuses', 'status'], ['rwNext', 'next'], ['rwContracts', 'contract'], ['rwGroups', 'group']]
        .forEach(([name, key]) => { if (!same(v[name], opts[key])) v[name] = opts[key]; });
    }
  }

  return applyChain;
});
