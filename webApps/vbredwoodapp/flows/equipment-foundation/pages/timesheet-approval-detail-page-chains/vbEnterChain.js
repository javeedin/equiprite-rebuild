define([
  'vb/action/actionChain',
  'vb/action/actions',
  'ojs/ojarraydataprovider'
], (ActionChain, Actions, ArrayDataProvider) => {
  'use strict';

  var MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  class vbEnterChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const requestNumber = $page.variables.requestNumber || '';
      const weekStartDate = $page.variables.weekStartDate || '';

      if (!requestNumber || !weekStartDate) {
        console.warn('[vbEnterChain approval] Missing requestNumber or weekStartDate');
        return;
      }

      const response = await Actions.callRest(context, {
        endpoint:  'eqp-v1/getEquipriteV1ViewsTimesheetApprovalDetails',
        // The view is PAGED and holds every request's rows, and this chain
        // filters client-side -- so page 0 (Spring default size=20 of 54 rows)
        // could omit the very week being opened. uriParams, NOT parameters:
        // `parameters` is silently dropped in this VB project.
        uriParams: { page: 0, size: 1000 }
      });

      if (!response || !response.ok || !response.body || !Array.isArray(response.body.data)) {
        console.warn('[vbEnterChain approval] Failed to fetch approval details');
        return;
      }

      const allRows = response.body.data;

      // Filter by requestNumber AND weekStartDate
      const rows = allRows.filter(r => {
        const rowWeek = r.weekStartDate
          ? String(r.weekStartDate).slice(0, 10)
          : '';
        return r.requestNumber === requestNumber && rowWeek === weekStartDate;
      });

      if (!rows.length) {
        console.warn('[vbEnterChain approval] No rows found for', requestNumber, weekStartDate);
        return;
      }

      // Store all matched entry IDs for bulk approve/reject
      $page.variables.matchedEntryIds = rows.map(r => r.eqrTimeEntryId);

      // Build week header labels
      var dayHeaders = [];
      if (weekStartDate.length >= 10) {
        var MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        var base = new Date(weekStartDate + 'T00:00:00');
        for (var d = 0; d < 7; d++) {
          var day = new Date(base);
          day.setDate(base.getDate() + d);
          dayHeaders.push(
            MONTH_NAMES[day.getMonth()] + ' ' + day.getDate() + '-' +
            day.getFullYear().toString().slice(2) + '\nHours'
          );
        }
      }

      const lines = rows.map(r => ({
        request_number:     r.requestNumber      || '',
        class_name:         r.className          || '',
        equipment_name:     r.equipmentName      || '',
        eqr_time_entry_id:  r.eqrTimeEntryId     || null,
        hours_type:         r.hoursType          || '',
        status:             r.entryStatus        || '',
        task_name:          r.taskName           || '',
        start_date:         r.requestedStartDate ? r.requestedStartDate.slice(0, 10) : '',
        end_date:           r.requestedEndDate   ? r.requestedEndDate.slice(0, 10)   : '',
        non_labor_resource: r.nonLaborResource   || '',
        hours_day1:         r.day1Hours          || 0,
        hours_day2:         r.day2Hours          || 0,
        hours_day3:         r.day3Hours          || 0,
        hours_day4:         r.day4Hours          || 0,
        hours_day5:         r.day5Hours          || 0,
        hours_day6:         r.day6Hours          || 0,
        hours_day7:         r.day7Hours          || 0
      }));

      const provider = $page.functions.initProviderFromLinesReadOnly(lines, weekStartDate);
      $page.variables.dataGridProvider     = provider;
      $page.variables.selectedWeekStart    = weekStartDate;
      const allApproved  = rows.every(r => r.timesheetStatus === 'APPROVED');
      const anyRejected  = rows.some(r => r.timesheetStatus === 'REJECTED');
      const allSettled   = rows.every(r =>
        r.timesheetStatus === 'APPROVED' || r.timesheetStatus === 'REJECTED'
      );
      const anySubmitted = rows.some(r => r.timesheetStatus === 'SUBMITTED');

      $page.variables.headerStatus = allApproved           ? 'APPROVED'
        : anyRejected && allSettled                        ? 'REJECTED'
        : anySubmitted                                     ? 'SUBMITTED'
        : rows[0].timesheetStatus || '';
      $page.variables.submittedBy          = rows[0].submittedByName  || '';
      $page.variables.submittedByEmail     = rows[0].submittedByEmail || '';
      $page.variables.totalHours           = rows.reduce((s, r) => s + (r.totalHours || 0), 0);
      $page.variables.billAmount           = rows.reduce((s, r) => s + (r.totalBill   || 0), 0);
      // Use projectName from API if available, fall back to URL param
      if (rows[0].projectName) {
        $page.variables.projectName = rows[0].projectName;
      }
    }
  }

  return vbEnterChain;
});
