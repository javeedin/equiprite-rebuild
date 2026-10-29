define([], function () {
  'use strict';

  // Accordion layout — all data shaping happens in BillingDetailInitChain
  // (lines with nested invoices). The page module only needs the banner
  // date formatter.
  class PageModule {
    // Stop the table from hijacking the chevron click (proven pattern from
    // post-cost-test-detail / equipment-returns).
    stopEvent(event) {
      if (event && typeof event.stopPropagation === 'function') {
        event.stopPropagation();
      }
    }

    formatDate(value) {
      if (!value) return '—';
      const s = String(value).substring(0, 10);
      const parts = s.split('-');
      if (parts.length !== 3) return s;
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const m = parseInt(parts[1], 10), d = parseInt(parts[2], 10);
      if (isNaN(m) || isNaN(d)) return s;
      return months[m - 1] + ' ' + d + ', ' + parts[0];
    }
  }

  return PageModule;
});
