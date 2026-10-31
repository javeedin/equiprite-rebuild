define(['resources/js/future/fxPage', 'resources/js/future/fxOps', 'resources/js/exportKit'], (fx, fxOps, exportKit) => {
  'use strict';

  // Approve & allocate: the page module. fx.Base subscribes the page to the store (fxRefresh → loadChain) and gives the
  // shared binding helpers (money, date, canOpen, …). These are the screen's own (no `this`: bindings call them detached).
  class PageModule extends fx.Base {
    constructor(context) {
      super(context);
    }

    /** The export formats (Excel, CSV, PDF, Copy). */
    formats() { return exportKit.FORMATS; }

    /** The lines under the relationship chip on. */
    filtered(rows, rel) { return fxOps.byRelation(rows, rel); }

    /** The unit chosen on a line: the one ticked, else the line's default (the preferred one when usable). */
    pickOf(picks, row) { return (picks && row && picks[row.id]) || (row ? row.defaultPick : '') || ''; }

    isPicked(picks, row, unitId) { return !!unitId && ((picks && row && picks[row.id]) || (row ? row.defaultPick : '')) === unitId; }

    /** The option chosen on a line (for the button's words and what approving sets off). */
    picked(picks, row) {
      const id = (picks && row && picks[row.id]) || (row ? row.defaultPick : '');
      return ((row && row.options) || []).filter((o) => o.unitId === id)[0] || null;
    }

    pickSerial(picks, row) {
      const id = (picks && row && picks[row.id]) || (row ? row.defaultPick : '');
      const o = ((row && row.options) || []).filter((x) => x.unitId === id)[0];
      return o ? o.serial : '';
    }

    pickSetsOff(picks, row) {
      const id = (picks && row && picks[row.id]) || (row ? row.defaultPick : '');
      const o = ((row && row.options) || []).filter((x) => x.unitId === id)[0];
      return o ? o.setsOff : [];
    }

    /** A confirmation's field shows (a field may show only for one answer of another, e.g. the damage amount). */
    shown(field, form) { return !field || !field.showIf || String((form || {})[field.showIf.key]) === String(field.showIf.value); }

    /** A choice field's option is the one chosen. */
    isOn(form, key, value) { return String((form || {})[key]) === String(value); }

    first(name) { return String(name || '').split(' ')[0]; }

    /** The confirm button's colour (fxOps.ask def.tone). */
    confirmClass(tone) { return 'nx-btn ' + ({ ok: 'nx-btn--primary nx-btn--ok', danger: 'nx-btn--primary nx-btn--danger' }[tone] || 'nx-btn--primary'); }
  }

  return PageModule;
});
