define(['resources/js/customerOrder', 'resources/js/rentalTerms', 'resources/js/fmt'], (O, terms, fmt) => {
  'use strict';

  // A customer's new request: binding helpers. The rules are resources/js/customerOrder.js (New's customer New request).
  class PageModule {
    windowText(start, end) { return O.windowText(start, end); }
    ids(cart) { return O.ids(cart); }
    line(cart, id, form, hideRates) { return O.cartLine(cart, id, form, hideRates); }
    totals(cart, form, hideRates) { return O.totals(cart, form, hideRates); }
    missingText(list) { return O.missingText(list); }
    cartCount(cart) { return O.cartCount(cart); }
    qtyIn(cart, id) { return O.qtyIn(cart, id); }
    customers(list, text) { return O.partyMatches(list, text); }
    range(a, b) { return fmt.range(a, b); }
    termsIntro() { return terms.INTRO; }
    termsSections() { return terms.SECTIONS; }
    agreeLabel() { return terms.AGREE_LABEL; }

    /** "Lone Star Paving LLC · 2 Nov – 15 Dec · 44 days" under the title. */
    subline(form) {
      const f = form || {};
      return [f.customerName, f.startDate && f.endDate ? O.windowText(f.startDate, f.endDate) : ''].filter(Boolean).join(' · ') || 'Pick the dates, the equipment and where it goes';
    }

    /** What Submit does, in words, before it is pressed. */
    submitWords(hideRates, resume) {
      return (resume ? 'Sends draft ' + (resume.requestNumber || '') + ' to your equipment manager' : 'Sends it to your equipment manager')
        + (hideRates ? ', who prepares your quote. You accept the quote before anything is confirmed.' : '.');
    }

    /** What Save draft does. */
    draftWords(resume) {
      return resume ? 'Saves your changes to draft ' + (resume.requestNumber || '') + '. Nothing is reserved until you send it.'
        : 'Keeps it as a draft. Nothing is reserved until you send it.';
    }
  }

  return PageModule;
});
