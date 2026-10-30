define(['resources/js/exportKit', 'resources/js/fmt', 'resources/js/portalView'], (exportKit, fmt, V) => {
  'use strict';

  // A request's invoices: binding helpers. The mapping and totals are New's (customerPortal, via portalView).
  class PageModule {
    formats() { return exportKit.FORMATS; }
    range(a, b) { return fmt.range(a, b); }
    money(v) { return fmt.money(v) || '$0'; }
    lineWords(status) { return V.lineWords(status); }
    lineStage(status) { return V.lineStage(status); }

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
