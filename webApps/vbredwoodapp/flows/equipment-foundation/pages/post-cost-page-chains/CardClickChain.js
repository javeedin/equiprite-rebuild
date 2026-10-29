define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';
  class CardClickChain extends ActionChain {
    async run(context, {
      requestNumber, eqrEquipmentRequestId, projectName,
      ppmProjectNumber, ppmTaskNumber, ppmBusinessUnit,
      ppmProjectRefId, ppmTaskRefId,
      rateScheduleId, weekStartDate, weekEndDate
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
        console.warn('[CardClickChain] No requestNumber — cannot navigate');
        return;
      }
      await Actions.navigateToPage(context, {
        page: 'post-cost-detail',
        params: {
          requestNumber:    String(requestNumber),
          // The DB request id — required by the settle step so posting can stamp
          // COST_POSTED_DATE on DIRECT/PR lines (patchRequestLine needs it in the
          // path). Without it internalRequestId defaults to 0 and the stamp is
          // skipped, leaving the line re-postable (double-cost). Sourced from the
          // list row's eqrEquipmentRequestId (post-cost-page vbEnterChain).
          internalRequestId: Number(eqrEquipmentRequestId) || 0,
          projectName:      projectName      || '',
          ppmProjectNumber: ppmProjectNumber || '',
          ppmTaskNumber:    ppmTaskNumber    || '',
          ppmBusinessUnit:  ppmBusinessUnit  || '',
          ppmProjectRefId:  Number(ppmProjectRefId) || 0,
          ppmTaskRefId:     Number(ppmTaskRefId)    || 0,
          rateScheduleId:   Number(rateScheduleId)  || 0,
          weekStartDate:    weekStartDate    || '',
          weekEndDate:      weekEndDate      || ''
        }
      });
    }
  }
  return CardClickChain;
});
