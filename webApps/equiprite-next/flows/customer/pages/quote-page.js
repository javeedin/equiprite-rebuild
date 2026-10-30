define(['resources/js/exportKit', 'resources/js/fmt', 'resources/js/portalView', 'resources/js/rentalTerms'], (exportKit, fmt, V, terms) => {
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
