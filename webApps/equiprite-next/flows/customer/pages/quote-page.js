define(['resources/js/exportKit', 'resources/js/fmt', 'resources/js/portalView', 'resources/js/rentalTerms', 'resources/js/portalRedwood'],
  (exportKit, fmt, V, terms, R) => {
  'use strict';

  // A customer quote's tab: binding helpers. The line totals are New's quote page's (portalView.quoteLine).
  class PageModule {
    formats() { return exportKit.FORMATS; }
    range(a, b) { return fmt.range(a, b); }
    money(v) { return fmt.money(v) || '$0'; }
    rateText(line) { return V.rateText(line); }
    termsIntro() { return terms.INTRO; }
    termsSections() { return terms.SECTIONS; }

    /** New EquipRite's quote page for this request, where accepting creates the contract; or ''. */
    acceptUrl(newBase, quote, requestId) {
      return requestId ? V.newRequestPage(newBase, 'customer-quote', quote && quote.requestNumber, requestId) : '';
    }

    // ── The Redwood view (your menu, Look): Oracle's general overview page as the header. ──

    /** The header's subtitle: the current look's kicker (which request) and its line (the customer, the dates). */
    rwSubtitle(quote, loading) {
      const q = quote || {};
      if (!q.requestNumber) return loading ? 'Loading your quote…' : '';
      return ['Quote for ' + q.requestNumber, q.customerName, fmt.range(q.startDate, q.endDate)].filter((t) => !!t).join(' · ');
    }

    /** Where the quote stands, as Oracle's badge in the header. */
    rwBadge(text, tone) { return R.headerBadge(text, tone); }

    /** The header's buttons: the current look's Refresh, Export, Open the PDF, Download and The request (rwActChain). */
    rwActions(number, hasDoc, loading) {
      const doc = hasDoc && number ? 'on' : 'off';
      return [
        { id: 'refresh', label: 'Refresh', icon: 'oj-ux-ico-refresh', display: loading ? 'disabled' : 'on' },
        { id: 'export', label: 'Export to Excel', icon: 'oj-ux-ico-download', display: number ? 'on' : 'off' },
        { id: 'pdf', label: 'Open the PDF', icon: 'oj-ux-ico-file-pdf', display: doc },
        { id: 'download', label: 'Download', icon: 'oj-ux-ico-download', display: doc },
        { id: 'request', label: 'The request', icon: 'oj-ux-ico-customer-request', display: number ? 'on' : 'off' },
      ];
    }

    /** "26 days": the rental's length, both ends counted (as the quote's day count). */
    days(start, end) {
      const s = fmt.dayMs(start);
      const e = fmt.dayMs(end);
      if (s == null || e == null || e < s) return '';
      const n = Math.round((e - s) / 86400000) + 1;
      return n + (n === 1 ? ' day' : ' days');
    }
  }

  return PageModule;
});
