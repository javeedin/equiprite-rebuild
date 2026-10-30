define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/bipLov',
], (ActionChain, Actions, bipLov) => {
  'use strict';

  // The Customer and Project lists, from the old pickers' BIP reports (ProjectTypeaheadChain, CustomerTypeaheadChain),
  // as New EquipRite's searchChain: case-insensitive over name and number, P_SEARCH_BY=ALL.
  //   nothing typed   the report's own starter list (a blank P_SEARCH: its first rows by name, the list Old EquipRite's
  //                   pickers show when the field is clicked), shown as soon as the Project step opens; read once and
  //                   kept for a few minutes
  //   typed text      narrows it; a short pause lets typing settle, and an answer for text already changed is dropped
  const PAUSE_MS = 250;
  const MAX_ROWS = 200;
  const KEEP_MS = 5 * 60 * 1000;
  const starter = { project: null, customer: null };
  const REPORTS = {
    project: {
      xdo: '/Custom/EquipRite/EQP_PROJECTS_LOV_RP.xdo',
      decode: (body) => bipLov.decodeReportRows(body, 'G_1', 'PROJECTID', 'PROJECTNAME', 'PROJECTNUMBER')
        .map((r) => ({ id: r.PROJECTID, label: r.PROJECTNAME, sub: r.PROJECTNUMBER })),
    },
    customer: {
      xdo: '/Custom/EquipRite/EQP_CUSTOMERS_LOV_RP.xdo',
      decode: (body) => bipLov.decodeReportRows(body, 'G_1', 'CUSTOMERID', 'CUSTOMER', 'CUSTOMERNUMBER')
        .map((r) => ({ id: r.CUSTOMERID, label: r.CUSTOMER, sub: r.CUSTOMERNUMBER })),
    },
  };
  const seq = { project: 0, customer: 0 };

  // buildSoapBody puts values straight into XML, so a typed & or < would break the envelope.
  const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  class searchChain extends ActionChain {
    async run(context, { kind, text }) {
      const { $page } = context;
      const rep = REPORTS[kind];
      if (!rep) {
        return;
      }
      const q = String(text || '').trim();
      $page.variables[kind + 'Query'] = q;
      const mine = ++seq[kind];
      if (!q && starter[kind] && Date.now() - starter[kind].at < KEEP_MS) {
        $page.variables[kind + 'Results'] = starter[kind].rows;
        $page.variables[kind + 'Searching'] = false;
        return;
      }
      $page.variables[kind + 'Searching'] = true;
      if (q) {
        await new Promise((r) => setTimeout(r, PAUSE_MS));
        if (mine !== seq[kind]) {
          return;
        }
      }
      let rows = [];
      let ok = false;
      try {
        const res = await Actions.callRest(context, {
          endpoint: 'bipService/runBIPReport',
          body: bipLov.buildSoapBody(rep.xdo, [
            { name: 'P_SEARCH', value: xmlEscape(q) },
            { name: 'P_SEARCH_BY', value: 'ALL' },
          ]),
        });
        rows = rep.decode(res && res.body).slice(0, MAX_ROWS);
        ok = !!(res && res.ok);
      } catch (e) {
        console.error('[searchChain]', kind, e);
      }
      if (!q && ok && rows.length) starter[kind] = { rows, at: Date.now() };
      if (mine !== seq[kind]) {
        return;
      }
      $page.variables[kind + 'Results'] = rows;
      $page.variables[kind + 'Searching'] = false;
    }
  }

  return searchChain;
});
