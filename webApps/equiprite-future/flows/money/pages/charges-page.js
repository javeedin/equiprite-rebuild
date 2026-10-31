define(['resources/js/future/fxPage', 'resources/js/exportKit', 'resources/js/future/fxMoney'], (fx, exportKit, money) => {
  'use strict';

  // Charges & statements: fx.Base subscribes the page to the store (fxRefresh → loadChain) and gives the shared
  // binding helpers (money, date, label, canOpen, …). The screen's own helpers are below (no `this`).
  class PageModule extends fx.Base {
    constructor(context) {
      super(context);
    }

    /** The export menu's formats. */
    formats() { return exportKit.FORMATS; }

    /** How many rows a list exports (as shown). */
    count(list, v) { return money.exportCount('charges', list, v); }

    /** Who the persona is on this screen, in a sentence. */
    whoText(v) {
      const x = v || {};
      const name = (x.me && x.me.name) || '';
      if (x.canOwner && x.canUser) return 'Playing ' + name + ': you see both sides. The owner releases, the user agrees or disputes, intercompany finance invoices.';
      if (x.canOwner) return 'Playing ' + name + ': you run the charges and release the owner’s statements; the user agrees or disputes them; intercompany finance invoices.';
      if (x.canUser) return 'Playing ' + name + ': you agree or dispute the statements your business units receive; the owner resolves disputes.';
      return 'Playing ' + name + ': you see the statements of your business units.';
    }

    /** Whether the last failure belongs here: a statement or the run (ref), or a charge's form. */
    failedAt(failure, ref) { return !!(failure && failure.text && failure.ref === ref); }
    failedLine(failure, chargeId) { return !!(failure && failure.text && failure.chargeId === chargeId); }
  }

  return PageModule;
});
