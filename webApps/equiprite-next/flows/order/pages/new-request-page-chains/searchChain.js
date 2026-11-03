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
  const seq = { project: 0, customer: 0, extCustomer: 0, contact: 0 };

  // An external customer's project (Old's Customer Type EXTERNAL): the customer from EquipRite's customer list
  // (EQR_CUSTOMER_REF) and their contact (EQR_CUSTOMER_PORTAL_USER), as Old's pickers and Next's customer order read
  // them. Each list is read once (kept a few minutes) and narrowed here, by name, number, e-mail or user name.
  const LOCAL = {
    extCustomer: { endpoint: 'eqp-v1/getCustomerRefs',
      row: (c) => (c && c.id != null ? { id: Number(c.id), label: c.customerName || ('Customer ' + c.id), sub: c.customerNumber || c.accountNumber || '' } : null) },
    contact: { endpoint: 'eqp-v1/getCustomerPortalUsers',
      row: (u) => (u && u.id != null ? { id: Number(u.id), label: u.contactName || u.username || ('User ' + u.id), sub: [u.email, u.username].filter((x) => !!x).join(' · ') } : null) },
  };
  const local = { extCustomer: null, contact: null };

  // buildSoapBody puts values straight into XML, so a typed & or < would break the envelope.
  const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  class searchChain extends ActionChain {
    async run(context, { kind, text }) {
      const { $page } = context;
      if (LOCAL[kind]) {
        await this.local(context, kind, text);
        return;
      }
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

    /** An EquipRite list (external customers, contacts): read once, narrowed here. */
    async local(context, kind, text) {
      const v = context.$page.variables;
      const q = String(text || '').trim();
      v[kind + 'Query'] = q;
      const mine = ++seq[kind];
      if (!local[kind] || Date.now() - local[kind].at > KEEP_MS) {
        v[kind + 'Searching'] = true;
        let rows = [];
        try {
          const res = await Actions.callRest(context, { endpoint: LOCAL[kind].endpoint });
          rows = ((res && res.ok && res.body && Array.isArray(res.body.data)) ? res.body.data : []).map(LOCAL[kind].row).filter((r) => !!r)
            .sort((a, b) => a.label.localeCompare(b.label));
          if (res && res.ok) local[kind] = { rows, at: Date.now() };
        } catch (e) {
          console.error('[searchChain]', kind, e);
        }
        if (mine !== seq[kind]) return;
        if (!local[kind]) {
          v[kind + 'Results'] = [];
          v[kind + 'Searching'] = false;
          return;
        }
      }
      const low = q.toLowerCase();
      v[kind + 'Results'] = local[kind].rows.filter((r) => !low || (r.label + ' ' + r.sub).toLowerCase().indexOf(low) !== -1).slice(0, MAX_ROWS);
      v[kind + 'Searching'] = false;
    }
  }

  return searchChain;
});
