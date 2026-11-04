define(['resources/js/exportKit', 'resources/js/fmt', 'resources/js/portalView', 'resources/js/portalRedwood', 'ojs/ojarraydataprovider'],
  (exportKit, fmt, V, R, ArrayDataProvider) => {
  'use strict';

  // A request's invoices: binding helpers. The mapping and totals are New's (customerPortal, via portalView).
  class PageModule {
    formats() { return exportKit.FORMATS; }
    range(a, b) { return fmt.range(a, b); }
    money(v) { return fmt.money(v) || '$0'; }
    lineWords(status) { return V.lineWords(status); }
    lineStage(status) { return V.lineStage(status); }

    // ── The Redwood view (your menu, Look): Oracle's general overview page as the header. ──

    /** The header's subtitle: the current look's kicker (Invoices) and its line (the contract, the dates). */
    rwSubtitle(head, loading) {
      const h = head || {};
      if (!h.requestNumber) return loading ? 'Loading the invoices…' : '';
      return ['Invoices', h.contractNumber ? 'Contract ' + h.contractNumber : '', fmt.range(h.startDate, h.endDate)].filter((t) => !!t).join(' · ');
    }

    /**
     * A piece's invoices for the Redwood view's oj-table: what each cell says (the same rows as the current look's grid),
     * each status as Oracle's badge.
     */
    rwInvoices(invoices) {
      const rows = (Array.isArray(invoices) ? invoices : []).map((i, n) => ({
        key: n,
        number: i.invoiceNumber || 'Not numbered yet',
        note: i.note || ('Billed ' + i.billDate),
        period: i.periodLabel || '',
        due: i.dueDate || '',
        amount: fmt.money(i.amount) || '$0',
        words: i.words || '',
        status: i.status || '',
        badge: R.badge(i.tone),
      }));
      return new ArrayDataProvider(rows, { keyAttributes: 'key' });
    }

    /** The header's buttons: the current look's Refresh, Export and Track the request (rwActChain). */
    rwActions(number, loading) {
      return [
        { id: 'refresh', label: 'Refresh', icon: 'oj-ux-ico-refresh', display: loading ? 'disabled' : 'on' },
        { id: 'export', label: 'Export to Excel', icon: 'oj-ux-ico-download', display: number ? 'on' : 'off' },
        { id: 'request', label: 'Track the request', icon: 'oj-ux-ico-customer-request', display: number ? 'on' : 'off' },
      ];
    }

    /** "Excavators · Qty 2 · $1,400 / DAILY" under a piece, as New's invoice page writes it. */
    lineSub(g) {
      if (!g) return '';
      const bits = [];
      if (g.equipmentClass) bits.push(g.equipmentClass);
      if (g.quantity !== '' && g.quantity != null) bits.push('Qty ' + g.quantity);
      if (g.billRate !== '' && g.billRate != null) bits.push((fmt.money(g.billRate) || '$0') + (g.billFrequency ? ' / ' + String(g.billFrequency).toLowerCase() : ''));
      return bits.join(' · ');
    }
  }

  return PageModule;
});
