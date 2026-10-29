define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';
  // Clone of post-cost-page CardClickChain — the ONLY difference is it navigates
  // to 'post-cost-test-detail' (the redesigned drill-down) instead of 'post-cost-detail'.
  class CardClickChain extends ActionChain {
    async run(context, {
      requestNumber, eqrEquipmentRequestId, projectName, taskName,
      ppmProjectNumber, ppmTaskNumber, ppmBusinessUnit,
      ppmProjectRefId, ppmTaskRefId,
      rateScheduleId, weekStartDate, weekEndDate,
      startDate, endDate
    }) {
      // oj-table fires firstSelectedRowChanged PART WAY THROUGH its own
      // select-and-focus sequence. Navigating synchronously from here tore the
      // page down mid-sequence, and the dying table then tried to resolve the
      // key of a row whose data was already gone:
      //   TypeError: Cannot read properties of undefined (reading 'key')
      //     at GetKey / _fireBeforeSelectEvent / HandleSelectionOption
      // reported by VB as "Fatal exception delivering binding updates", which
      // aborts the rest of that binding-delivery cycle. Yield one macrotask so
      // the table finishes selecting before the route changes. Navigation
      // behaviour is unchanged.
      await new Promise(resolve => setTimeout(resolve, 0));

      if (!requestNumber) {
        console.warn('[CardClickChain post-cost-test] No requestNumber — cannot navigate');
        return;
      }
      await Actions.navigateToPage(context, {
        page: 'post-cost-test-detail',
        params: {
          requestNumber:    String(requestNumber),
          internalRequestId: Number(eqrEquipmentRequestId) || 0,
          projectName:      projectName      || '',
          taskName:         taskName         || '',
          ppmProjectNumber: ppmProjectNumber || '',
          ppmTaskNumber:    ppmTaskNumber    || '',
          ppmBusinessUnit:  ppmBusinessUnit  || '',
          ppmProjectRefId:  Number(ppmProjectRefId) || 0,
          ppmTaskRefId:     Number(ppmTaskRefId)    || 0,
          rateScheduleId:   Number(rateScheduleId)  || 0,
          weekStartDate:    weekStartDate    || '',
          weekEndDate:      weekEndDate      || '',
          // Planned request dates (from the list's REQUESTED_START/END_DATE) so
          // the detail header shows the real rental period + can detect an early
          // return (last billed week < planned end).
          plannedStartDate: startDate        || '',
          plannedEndDate:   endDate          || ''
        }
      });
    }
  }
  return CardClickChain;
});
