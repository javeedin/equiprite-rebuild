define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Loads the approval lines: views/timesheet-approval-details, the old detail page's call (uriParams page 0,
  // size 1000), carried on to further pages while the view says hasMore, because this page shows every request at
  // once where the old one filtered a single request out of the first page. Then, non-fatal: the audit trail
  // (adjusted lines show their submitted hours) and the cost so far of the week's requests.
  const PAGE_SIZE = 1000;
  const MAX_PAGES = 20;

  class loadApprovalsChain extends ActionChain {
    async run(context, { week }) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      v.isLoading = true;
      v.loadError = '';
      try {
        const rows = [];
        for (let page = 0; page < MAX_PAGES; page++) {
          const res = await Actions.callRest(context, {
            endpoint: 'eqp-v1/getEquipriteV1ViewsTimesheetApprovalDetails',
            uriParams: { page, size: PAGE_SIZE },
          });
          if (!res || !res.ok || !res.body || !Array.isArray(res.body.data)) {
            if (page === 0) v.loadError = 'The timesheets could not be loaded (HTTP ' + (res && res.status) + ').';
            break;
          }
          rows.push(...res.body.data);
          const more = res.body.hasMore === true || (res.body.hasMore === undefined && res.body.data.length === PAGE_SIZE);
          if (!more) break;
        }
        const mapped = fns.mapRows(rows);
        v.rowsAll = mapped;
        const wanted = week && mapped.some((r) => r.week === week) ? week : fns.defaultWeek(mapped);
        v.weekKey = wanted;
        v.weekDays = fns.weekDays(wanted);
        v.picked = {};
        v.adjust = null;
      } catch (e) {
        console.error('[loadApprovalsChain] failed', e);
        v.loadError = 'The timesheets could not be loaded.';
      } finally {
        v.isLoading = false;
      }

      try {
        const audit = await Actions.callRest(context, { endpoint: 'eqp-v1/getAuditTrail' });
        const list = audit && audit.ok && audit.body ? (Array.isArray(audit.body.data) ? audit.body.data : (Array.isArray(audit.body) ? audit.body : [])) : [];
        v.auditByEntry = fns.auditMap(list);
      } catch (e) {
        console.warn('[loadApprovalsChain] audit trail not read:', e && e.message);
      }
      await Actions.callChain(context, { chain: 'loadCostChain' });
    }
  }

  return loadApprovalsChain;
});
