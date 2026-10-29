define(['resources/js/customerPortal'], (portal) => {
  'use strict';

  // The invoices of one billed request (replaces customer-billing-detail): the figures first, then each piece of
  // equipment with its invoices. Mapping and totals: customerPortal (the old BillingDetailInitChain's rules).

  class PageModule {
    money(n) { return portal.money(n); }

    dateRange(a, b) { return portal.dateRange(a, b); }

    invoiceText(s) { return portal.invoiceText(s); }

    invoiceClass(s) { return portal.invoiceClass(s); }

    statusText(s) { return portal.statusText(s); }

    statusClass(s) { return portal.statusClass(s); }

    /** "Excavators · Qty 2 · $1,400 / DAY" under a line. */
    lineSub(ln) {
      if (!ln) return '';
      const bits = [];
      if (ln.equipmentClass) bits.push(ln.equipmentClass);
      if (ln.quantity !== '' && ln.quantity != null) bits.push('Qty ' + ln.quantity);
      if (ln.billRate !== '' && ln.billRate != null) bits.push(portal.money(ln.billRate) + (ln.billFrequency ? ' / ' + ln.billFrequency : ''));
      return bits.join(' · ');
    }

    /** "Re-billed as WEEKLY" etc. for an adjustment row. */
    adjustmentNote(inv) {
      if (!inv || !inv.isAdjustment) return '';
      return inv.txnType === 'CREDIT' ? 'Credit for an earlier invoice' : 'Re-billed' + (inv.periodType ? ' as ' + inv.periodType.toLowerCase() : '');
    }

    oldLink(oldAppUrl, requestNumber, numericId) {
      return portal.oldLink(oldAppUrl, 'customer-billing-detail', requestNumber, numericId);
    }
  }

  return PageModule;
});
