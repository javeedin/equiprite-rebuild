define(['resources/js/exportKit', 'resources/js/fmt', 'resources/js/customerPortal', 'resources/js/portalView', 'resources/js/rentalTerms'],
  (exportKit, fmt, portal, V, terms) => {
  'use strict';

  // A customer request's tab: binding helpers. The logic is resources/js/portalView.js on New's customerPortal.js.
  class PageModule {
    formats() { return exportKit.FORMATS; }
    range(a, b) { return fmt.range(a, b); }
    date(v) { return fmt.date(v); }
    money(v) { return fmt.money(v) || '$0'; }

    lineWords(status) { return V.lineWords(status); }
    lineStage(status) { return V.lineStage(status); }
    rateText(line) { return V.rateText(line); }

    /** New's rule: line actions (accept, refuse, return) only once the request is in operations. */
    isConfirmed(status) { return portal.headerIsConfirmed(status); }

    /** New's selection state over the ticked pieces. */
    sel(lines, ticks) { return V.selection(lines, ticks); }

    /** How many pieces are in a status. */
    countIn(lines, status) { return (Array.isArray(lines) ? lines : []).filter((l) => l && l.lineStatus === status).length; }

    /** "2 of 3 here", "All past", "Some past" under a stop of the journey. */
    stopNote(stop, total) {
      if (!stop) return '';
      if (stop.state === 'here') return total > 1 ? stop.count + ' of ' + total + ' here' : 'Here';
      if (stop.state === 'done') return 'All past';
      if (stop.state === 'passed') return 'Some past';
      return '';
    }

    /** The delivery button of the next step: "Accept all 2" or "Accept the 1 ticked" (New's words, in pieces). */
    acceptLabel(lines, ticks) {
      const s = V.selection(lines, ticks);
      const n = s.count || (Array.isArray(lines) ? lines : []).filter((l) => l && l.lineStatus === 'SHIP_TO_SITE').length;
      return s.count ? 'Accept the ' + n + ' ticked' : 'Accept all ' + n;
    }

    contract(contractNumber, quotingAllowed) { return V.contractState(contractNumber, quotingAllowed); }
    value(lines) { return V.contractValue(lines); }
    termsIntro() { return terms.INTRO; }
    termsSections() { return terms.SECTIONS; }

    /** This request in New EquipRite's customer portal, or ''. */
    newUrl(newBase, head) { return head && head.id ? V.newRequestPage(newBase, 'customer-request', head.requestNumber, head.id) : ''; }

    /** "3 pieces · 1 consumable", for the facts. */
    pieces(lines) {
      const list = Array.isArray(lines) ? lines : [];
      const n = list.reduce((s, l) => s + (Number(l.quantity) || 1), 0);
      return list.length ? n + (n === 1 ? ' piece' : ' pieces') + ' on ' + list.length + (list.length === 1 ? ' line' : ' lines') : 'None yet';
    }
  }

  return PageModule;
});
