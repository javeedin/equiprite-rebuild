define(['resources/js/customerPortal'], (portal) => {
  'use strict';

  // The customer's requests (wireframe: Portal requests; replaces customer-my-requests). Chips by what the request
  // needs from the customer (needs you, open, finished), a search, and a row per request with a small tracker.

  class PageModule {
    chips(rows) { return portal.groupChips(rows); }

    filterRows(rows, group, text) { return portal.filterRequests(rows, group, text); }

    steps(status, info) { return portal.trackSteps(status, [], info || {}); }

    statusText(s) { return portal.statusText(s); }

    statusClass(s) { return portal.statusClass(s); }

    dateRange(a, b) { return portal.dateRange(a, b); }

    hasQuote(status, quotingAllowed) { return portal.hasQuote(status, quotingAllowed); }

    oldLink(oldAppUrl) { return portal.oldLink(oldAppUrl, 'customer-my-requests'); }

    /** "Lone Star Paving · Maria Torres". */
    who(row) { return [row && row.customerName, row && row.customerContact].filter((v) => !!v).join(' · '); }

    /** The empty-list sentence for the chosen chip. */
    emptyText(group, text) {
      if (String(text || '').trim()) return 'No request matches “' + String(text).trim() + '”.';
      if (group === 'needs') return 'Nothing needs you right now.';
      if (group === 'open') return 'No open requests. Finished ones are under Finished.';
      if (group === 'done') return 'No finished requests yet.';
      return 'No requests yet.';
    }
  }

  return PageModule;
});
