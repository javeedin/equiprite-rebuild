define(['resources/js/future/fxPage', 'resources/js/exportKit'], (fx, exportKit) => {
  'use strict';

  // Receive, hours, moves: the page module. fx.Base subscribes the page to the store (fxRefresh → loadChain) and gives
  // the shared binding helpers (money, date, plural, …). These are the screen's own (no `this`: bindings call them detached).
  class PageModule extends fx.Base {
    constructor(context) {
      super(context);
    }

    /** The export formats (Excel, CSV, PDF, Copy). */
    formats() { return exportKit.FORMATS; }

    /** A confirmation's field shows (a field may show only for one answer of another). */
    shown(field, form) { return !field || !field.showIf || String((form || {})[field.showIf.key]) === String(field.showIf.value); }

    /** A choice field's option is the one chosen. */
    isOn(form, key, value) { return String((form || {})[key]) === String(value); }

    /** The confirm button's colour (fxOps.ask def.tone). */
    confirmClass(tone) { return 'nx-btn' + ({ ok: ' nx-btn--primary nx-btn--ok', danger: ' nx-btn--primary nx-btn--danger', secondary: '' }[tone] != null ? { ok: ' nx-btn--primary nx-btn--ok', danger: ' nx-btn--primary nx-btn--danger', secondary: '' }[tone] : ' nx-btn--primary'); }

    /** A day of the hours grid: approved, waiting for approval, nothing recorded, or the site's weekend. */
    dayClass(g) { return 'fx-day fx-day--' + ((g && g.state) || 'empty') + (g && g.weekend ? ' fx-day--we' : ''); }

    /** A section's count: amber when something waits. */
    countClass(n) { return 'fx-count' + (n > 0 ? ' fx-count--on' : ''); }

    /** The export list of a unit's hours. */
    hoursList(id) { return 'hours:' + id; }

    /** Whether any move is the persona's to make. */
    anyMove(can, h) { return !!can && !!h && (can.breakdown || can.offHire || (can.redeploy && !h.rental) || (can.handover && !h.rental) || can.loss); }

    /** A row of the final timesheet: its state as typed (New, Changed, Approved, Waiting, Check; Planned after today). */
    retState(view, date) { return ((view && view.states) || {})[date] || { text: '—', tone: 'na' }; }

    /** Whether the final bill can be shown (a return date that the engine takes). */
    billShown(bill) { return !!bill && !!bill.started && !bill.error; }

    /** Why the final bill is not shown yet. */
    billWhy(bill) { return bill && bill.modeText ? bill.modeText : 'Pick a return date to see the final bill.'; }

    /** A line of the bill: expected (the transport back), a credit. */
    billRowClass(row) {
      return 'nx-row fx-bill-row' + (row && row.expected ? ' fx-bill-row--expected' : '') + (row && row.credit ? ' fx-bill-row--credit' : '') + (row && row.planned ? ' fx-bill-row--planned' : '');
    }

    /** Whether an estimated bill splits the actual days from the planned ones. */
    hasSplit(bill) { return !!bill && !!bill.split; }

    /** The VAT line of a customer's bill. */
    vatText(bill) { return bill && bill.vat ? bill.vat.text : ''; }
    vatAmount(bill) { return bill && bill.vat ? bill.vat.amountText : ''; }
  }

  return PageModule;
});
