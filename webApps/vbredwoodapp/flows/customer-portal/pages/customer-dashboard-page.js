define([], () => {
  'use strict';

  const STATUS_LABELS = {
    'DRAFT':                   'DRAFT',
    'SUBMITTED':               'SUBMITTED',
    'QUOTE_GENERATED':         'QUOTE GENERATED',
    'QUOTE_ACCEPTED':          'QUOTE ACCEPTED',
    'IN_PROCESS':              'IN PROCESS',
    'EQP_INSPECTION_COMPLETE': 'INSPECTION COMPLETE',
    'PICK_INITIATED':          'PICKING IN PROGRESS',
    'PICK_RELEASED':           'PICKING COMPLETE',
    'SHIPPED':                 'SHIPPED',
    'DEPLOYED':                'DEPLOYED',
    'REJECTED':                'REJECTED',
    'RETURNED':                'RETURNED',
    'CLOSED':                  'CLOSED'
  };

  class PageModule {
    getStatusLabel(status) {
      return STATUS_LABELS[status] || status;
    }
  }

  return PageModule;
});
