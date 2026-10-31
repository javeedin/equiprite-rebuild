define(['resources/js/future/fxPage', 'resources/js/exportKit'], (fx, exportKit) => {
  'use strict';

  // A request's tab: the page module. fx.Base subscribes the page to the store (fxRefresh → loadChain) and gives the
  // shared binding helpers; the view model is resources/js/future/fxRequests.js request().
  const TABS = [
    { key: 'equipment', label: 'Equipment', icon: 'oj-ux-ico-truck' },
    { key: 'money', label: 'Money', icon: 'oj-ux-ico-currency-dollar' },
    { key: 'accounting', label: 'Accounting (shown)', icon: 'oj-ux-ico-tables-basic' },
    { key: 'history', label: 'History', icon: 'oj-ux-ico-clock-history' }
  ];

  class PageModule extends fx.Base {
    constructor(context) {
      super(context);
    }

    /** The inner tabs, each with what it holds ("4 of 7" for Money). */
    tabs(v) {
      const x = v || {};
      const count = {
        equipment: (x.lines || []).length,
        money: x.finance ? x.finance.done + ' of ' + x.finance.total : '',
        accounting: x.accCount || 0,
        history: (x.history || []).length
      };
      return TABS.map((t) => Object.assign({}, t, { count: count[t.key] }));
    }

    /** The export formats (Excel, CSV, PDF, Copy). */
    formats() { return exportKit.FORMATS; }

    /** What the export takes: the tab shown. */
    exportNote(tab) {
      return { equipment: 'The equipment lines', money: 'The charges', accounting: 'The accounting lines', history: 'The history' }[tab] || 'This tab';
    }
  }

  return PageModule;
});
