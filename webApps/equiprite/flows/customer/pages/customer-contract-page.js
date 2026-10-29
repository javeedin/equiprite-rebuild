define(['resources/js/customerPortal', 'resources/js/rentalTerms'], (portal, terms) => {
  'use strict';

  // The rental contract of a customer request (replaces customer-rental-contract, which in Old EquipRite shows fixed
  // sample data and has no working button). Here it is the request's real contract: the Fusion contract number the
  // quote accept or the submit stamped on the request, who it is for, the equipment, and the terms the customer
  // accepted (the cart's terms text, resources/js/rentalTerms.js).

  const NOUNS = { DAILY: 'DAY', WEEKLY: 'WEEK', MONTHLY: 'MONTH', HOURLY: 'HOUR', YEARLY: 'YEAR' };

  class PageModule {
    termsIntro() { return terms.INTRO; }

    termsSections() { return terms.SECTIONS; }

    /** { total, priced, lines }: the sum of the line totals stored on the request (estimatedCost), where there is one. */
    value(lines) {
      const list = Array.isArray(lines) ? lines : [];
      let total = 0;
      let priced = 0;
      list.forEach((l) => {
        if (l && l.estimatedCost != null && l.estimatedCost !== '' && !isNaN(Number(l.estimatedCost))) {
          total += Number(l.estimatedCost);
          priced += 1;
        }
      });
      return { total: Math.round(total * 100) / 100, priced, lines: list.length };
    }

    /** Where the contract stands, in plain words. */
    contractState(contractNumber, quotingAllowed) {
      if (contractNumber) {
        return { title: 'Contract ' + contractNumber, text: 'Created in Oracle Fusion for this request.' };
      }
      return {
        title: 'No contract yet',
        text: quotingAllowed
          ? 'Your rental contract is created when you accept the quote for this request.'
          : 'Your rental contract is created when the request is submitted. If it is missing, your equipment manager can raise it.',
      };
    }

    rateText(line) {
      if (!line || line.billRate === '' || line.billRate == null) return '—';
      const u = String(line.priceUom || '').trim().toUpperCase();
      return portal.money(line.billRate) + (u ? ' / ' + (NOUNS[u] || u) : '');
    }

    money(n) { return portal.money(n); }

    dateRange(a, b) { return portal.dateRange(a, b); }

    statusText(s) { return portal.statusText(s); }

    statusClass(s) { return portal.statusClass(s); }

    oldLink(oldAppUrl) { return portal.oldLink(oldAppUrl, 'customer-rental-contract'); }
  }

  return PageModule;
});
