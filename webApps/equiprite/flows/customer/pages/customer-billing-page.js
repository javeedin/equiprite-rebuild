define(['resources/js/customerPortal'], (portal) => {
  'use strict';

  // Billing (wireframe: Portal requests › Billing; replaces customer-my-billing). The balance first, then the billed
  // requests (the old page's list: requests with a contract number) with what each has been invoiced, paid and still
  // owes, then every invoice. Totals follow the old billing detail's rules (customerPortal.invoiceTotals).

  class PageModule {
    /**
     * The billed requests with their own figures: [{ ...request, invoiced, paid, outstanding, overdue, invoiceCount }].
     * @param {Array} billed   requests with a contract number (mapped customer-my-requests rows)
     * @param {Array} invoices mapped invoices (customerPortal.mapInvoices)
     */
    summaries(billed, invoices) {
      const byRequest = {};
      (Array.isArray(invoices) ? invoices : []).forEach((inv) => {
        (byRequest[inv.requestId] = byRequest[inv.requestId] || []).push(inv);
      });
      return (Array.isArray(billed) ? billed : []).map((r) => {
        const list = byRequest[String(r.id)] || [];
        const t = portal.invoiceTotals(list);
        return Object.assign({}, r, {
          invoiceCount: list.filter((i) => i.status !== 'CANCELLED').length,
          invoiced: t.totalInvoiced,
          paid: t.paidAmount,
          outstanding: t.outstandingAmount,
          overdue: t.overdueCount,
        });
      });
    }

    /** The balance across every invoice. */
    totals(invoices) {
      return portal.invoiceTotals(invoices);
    }

    /** The request number of an invoice's request, from the billed list (or the id). */
    requestOf(invoice, requests) {
      const r = (Array.isArray(requests) ? requests : []).find((x) => String(x.id) === String(invoice && invoice.requestId));
      return r ? r.requestNumber : '';
    }

    money(n) { return portal.money(n); }

    dateRange(a, b) { return portal.dateRange(a, b); }

    invoiceText(s) { return portal.invoiceText(s); }

    invoiceClass(s) { return portal.invoiceClass(s); }

    oldLink(oldAppUrl) { return portal.oldLink(oldAppUrl, 'customer-my-billing'); }
  }

  return PageModule;
});
