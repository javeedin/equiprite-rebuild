define([], () => {
  'use strict';

  class PageModule {
    mapRequestData(r) {
      return {
        id:              r.eqrEquipmentRequestId || r.rowId,
        requestNumber:   r.requestNumber         || '',
        customerName:    r.customerName          || '',
        customerContact: r.customerContact       || '',
        agreementType:   r.agreementType         || '',
        status:          r.requestStatus         || '',
        startDate:       r.startDate  ? r.startDate.substring(0, 10)  : '',
        endDate:         r.endDate    ? r.endDate.substring(0, 10)    : '',
        lines:           r.lines      || 0,
        createdDate:     r.createdDate ? r.createdDate.substring(0, 10) : ''
      };
    }
  }

  return PageModule;
});
