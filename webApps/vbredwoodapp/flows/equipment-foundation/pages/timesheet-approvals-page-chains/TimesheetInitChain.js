define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The approvals endpoint is PAGED. Calling it with no parameters returns
  // Spring's default first page of 20 rows out of 34, and because this chain
  // sorts client-side, any week outside that first page is invisible -- a
  // freshly submitted timesheet simply never appeared in the queue. The
  // response envelope carries recordCount / page / pageSize / totalPages /
  // hasMore, so drain it explicitly instead of trusting one call.
  const PAGE_SIZE  = 200;   // one call covers the current estate (34 rows)
  const MAX_PAGES  = 50;    // runaway guard: 10k rows

  class TimesheetInitChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const rows = [];
      let page = 0;

      while (page < MAX_PAGES) {
        const response = await Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1ViewsTimesheetApprovals',
          // Query params MUST go under uriParams -- `parameters` is silently
          // dropped in this VB project, which is how the un-paged call above
          // ended up capped at Spring's default size=20.
          uriParams: { page: page, size: PAGE_SIZE }
        });

        if (!response || !response.ok || !response.body || !Array.isArray(response.body.data)) {
          console.warn('[TimesheetInitChain] Failed to load approval queue page', page,
                       response && response.status);
          // Keep whatever earlier pages returned rather than blanking the queue:
          // a partial list is still usable, an empty one looks like "nothing to approve".
          break;
        }

        rows.push(...response.body.data);

        // hasMore is authoritative. Fall back to a short-page test for safety in
        // case an older service build omits it.
        const more = response.body.hasMore === true ||
                     (response.body.hasMore === undefined &&
                      response.body.data.length === PAGE_SIZE);
        if (!more) break;
        page += 1;
      }

      if (page >= MAX_PAGES) {
        console.warn('[TimesheetInitChain] Stopped at page guard; queue may be truncated.');
      }

      const data = rows.map(r => ({
        // Carried purely to sort by. EQP_P_TS_APPROVALS exposes no submitted-at
        // timestamp, so the entry id -- a sequence -- is the only recency signal
        // available, and it was being dropped here.
        eqrTimeEntryId:  Number(r.eqrTimeEntryId) || 0,
        requestNumber:   r.requestNumber    || '',
        weekStartDate:   r.weekStartDate    || '',
        request_id:      r.requestNumber    || '—',
        project:         r.projectName      || '—',
        week_label:      r.weekStartDate && r.weekEndDate
                           ? r.weekStartDate + ' – ' + r.weekEndDate
                           : '—',
        week_start:      r.weekStartDate    || '',
        equipment_count: r.equipCount       || 0,
        total_hours:     r.totalHours       || 0,
        bill_amount:     r.billAmount       || 0,
        status:          r.status           || '—'
      }));

      // Newest submission first, matching the Post Cost list, which sorts on
      // eqrEquipmentRequestId descending for the same reason.
      //
      // This used to sort on weekStartDate alone. That is the week the WORK happened,
      // not when it was sent for approval, and the queue is full of rows sharing one
      // week -- 42 rows across a handful of weeks live -- so within a week the order
      // fell back to whatever the API returned, which is oldest id first. The newest
      // thing to approve sat at the bottom of its group.
      //
      // Entry id descending is the only recency signal this view offers: it has no
      // submitted-at column. It is a proxy, not the truth -- the id is assigned when
      // the entry is CREATED (find-or-create on line + ISO week), so a timesheet
      // opened weeks ago and submitted today still sorts by its creation. Strictly
      // correct ordering needs EQR_TIME_ENTRY.LAST_UPDATED_DATE exposed on
      // EQP_P_TS_APPROVALS; see MD/Post Cost for the pending backend item.
      data.sort(function (a, b) {
        return (b.eqrTimeEntryId || 0) - (a.eqrTimeEntryId || 0);
      });

      $page.variables.TimesheetAllArray      = data;
      $page.variables.TimesheetFilteredArray = data;
      // The subtitle says "pending reviews", so count only what is actually
      // pending. It previously showed the loaded row count, which included
      // APPROVED weeks -- and, with the un-paged call above, happened to equal
      // Spring's default page size of 20 rather than any real total.
      $page.variables.pendingCount = data.filter(r => r.status === 'SUBMITTED').length;
    }
  }

  return TimesheetInitChain;
});
