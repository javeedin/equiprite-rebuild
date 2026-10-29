define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class vbEnterChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      // The view fans one row per (request × ISO week) — 770+ rows across 180+
      // requests. The endpoint is paginated (page/size) and defaults small, so
      // without an explicit size only the first page comes back and requests are
      // silently dropped. The page filters and groups client-side, so pull them
      // all in one page.
      // NOTE: query params (page/size) MUST go through `uriParams`, not
      // `parameters` — `parameters` is silently ignored by this REST action, so
      // the backend applied its default page size and the list truncated. Every
      // other working paginated call here uses uriParams.
      const response = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getEquipriteV1ViewsPostCost',
        uriParams: { page: 0, size: 10000 }
      });

      if (!response || !response.ok || !response.body || !Array.isArray(response.body.data)) {
        console.warn('[vbEnterChain] Failed to load post-cost data:', response && response.status);
        $page.variables.PostCostAllArray      = [];
        $page.variables.PostCostFilteredArray = [];
        return;
      }

      const data = response.body.data.map(r => ({
        rowKey:                (r.requestNumber || '') + '_' + (r.weekStartDate || ''),
        eqrEquipmentRequestId: r.eqrEquipmentRequestId,
        requestNumber:         r.requestNumber         || '',
        projectName:           r.projectName           || '—',
        taskName:              r.taskName              || '—',
        agreementNumber:       r.agreementNumber       || '—',
        weekStartDate:         r.weekStartDate ? String(r.weekStartDate).slice(0, 10) : '—',
        weekEndDate:           r.weekEndDate   ? String(r.weekEndDate).slice(0, 10)   : '—',
        startDate:             r.requestedStartDate    ? String(r.requestedStartDate).slice(0, 10) : '—',
        endDate:               r.requestedEndDate      ? String(r.requestedEndDate).slice(0, 10)   : '—',
        timesheets:            r.timesheets            || 0,
        totalHours:            r.totalHours            || 0,
        totalBillCost:         r.totalBillCost         || 0,
        ppmProjectNumber:      r.ppmProjectNumber      || '',
        ppmTaskNumber:         r.ppmTaskNumber         || '',
        ppmBusinessUnit:       r.ppmBusinessUnit       || '',
        ppmProjectRefId:       r.ppmProjectRefId       || 0,
        ppmTaskRefId:          r.ppmTaskRefId          || 0,
        rateScheduleId:        r.rateScheduleId        || 0
      }));

      // Newest record first. eqrEquipmentRequestId is the surrogate key — a higher
      // id means a more recently created request. (The PostCost view does not return
      // a week/creation date, so the request id is the reliable creation-order field.)
      data.sort((a, b) => (Number(b.eqrEquipmentRequestId) || 0) - (Number(a.eqrEquipmentRequestId) || 0));

      $page.variables.PostCostAllArray      = data;
      $page.variables.PostCostFilteredArray = data;
    }
  }

  return vbEnterChain;
});
