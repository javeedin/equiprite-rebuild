define(['resources/js/customerPortal'], (portal) => {
  'use strict';

  // The quote for a customer request (replaces customer-quote): the PDF the manager sent, what it adds up to, and
  // Accept, which creates the Fusion rental contract (acceptQuoteChain, the old AcceptQuoteChain).

  const NOUNS = { DAILY: 'DAY', WEEKLY: 'WEEK', MONTHLY: 'MONTH', HOURLY: 'HOUR', YEARLY: 'YEAR' };

  class PageModule {
    /**
     * One request-detail-lines row as a quote line, exactly as Old EquipRite's QuoteInitChain maps it. The total:
     *   1 estimatedCost, the line total stored at submit (what the cart showed)
     *   2 rate × qty × days, only for a daily rate (or no unit, the legacy shape)
     *   3 rate × qty for a period- or unit-priced line without a stored total (the amount covers its period)
     */
    quoteLine(r) {
      const startStr = r.startDate ? r.startDate.substring(0, 10) : '';
      const endStr = r.endDate ? r.endDate.substring(0, 10) : '';
      let days = 0;
      if (startStr && endStr) {
        const s = new Date(startStr);
        const e = new Date(endStr);
        days = Math.max(0, Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1);
      }
      const qty = r.quantity != null ? r.quantity : 1;
      const rate = r.billRate != null ? r.billRate : 0;
      const uom = String(r.priceUom || '').toUpperCase();
      const isPerDay = !uom || uom === 'DAY' || uom === 'DAILY';
      let lineTotal;
      if (r.estimatedCost != null) {
        lineTotal = Number(r.estimatedCost);
      } else if (isPerDay) {
        lineTotal = rate * qty * days;
      } else {
        lineTotal = rate * qty;
      }
      return {
        equipmentName:  r.equipmentName  || '',
        equipmentClass: r.className      || r.equipmentClass || '',
        quantity:       qty,
        startDate:      startStr,
        endDate:        endStr,
        billRate:       rate,
        priceUom:       r.priceUom || null,
        lineTotal:      lineTotal
      };
    }

    /** "$3,200 / WEEK", as quoted. */
    rateText(line) {
      if (!line) return '';
      const u = String(line.priceUom || '').trim().toUpperCase();
      return portal.money(line.billRate) + (u ? ' / ' + (NOUNS[u] || u) : '');
    }

    money(n) { return portal.money(n); }

    dateRange(a, b) { return portal.dateRange(a, b); }

    statusText(s) { return portal.statusText(s); }

    statusClass(s) { return portal.statusClass(s); }

    /** Accept is open only while there is no contract yet, nothing is running, and ENABLE_QUOTES allows it (old rule). */
    canAccept(quoteData, isAccepting, acceptAllowed) {
      return !(quoteData && quoteData.contractNumber) && !isAccepting && !!acceptAllowed;
    }

    /** The Accept button's words, the old button's states in plain words. */
    acceptLabel(quoteData, isAccepting, acceptAllowed) {
      if (quoteData && quoteData.contractNumber) return 'Accepted · contract ' + quoteData.contractNumber;
      if (isAccepting) return 'Creating your contract…';
      if (!acceptAllowed) return 'Accepting online is switched off';
      return 'Accept quote';
    }

    oldLink(oldAppUrl, requestNumber, numericId) {
      return portal.oldLink(oldAppUrl, 'customer-quote', requestNumber, numericId);
    }
  }

  return PageModule;
});
