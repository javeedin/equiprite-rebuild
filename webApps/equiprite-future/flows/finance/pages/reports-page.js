define(['resources/js/future/fxPage', 'resources/js/exportKit'], (fx, exportKit) => {
  'use strict';

  // Reports: the page module. fx.Base subscribes the page to the store (fxRefresh → loadChain) and gives the shared
  // binding helpers; the view model is resources/js/future/fxFinance.js (reports).
  class PageModule extends fx.Base {
    constructor(context) {
      super(context);
    }

    /** The export formats (Excel, CSV, PDF, Copy). */
    formats() { return exportKit.FORMATS; }

    /** aria-expanded as VB wants it. */
    pressed(on) { return on ? 'true' : 'false'; }

    /** A bar's width: at least a sliver when something is out, so 0 % and 3 % look different. */
    barWidth(pct) { const p = Number(pct) || 0; return (p > 0 ? Math.max(3, Math.min(100, p)) : 0) + '%'; }
  }

  return PageModule;
});
