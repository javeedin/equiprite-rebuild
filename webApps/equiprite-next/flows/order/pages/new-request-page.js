define(['resources/js/orderForm', 'resources/js/fmt'], (order, fmt) => {
  'use strict';

  // New request: binding helpers. The rules are resources/js/orderForm.js; the chains are new-request-page-chains.
  class PageModule {
    windowText(start, end) { return order.windowText(start, end); }
    lengths(start, end) { return order.lengths(start, end); }
    money(n) { return order.money(n); }
    date(v) { return fmt.date(v); }
    qtyIn(cart, id) { return order.qtyIn(cart, id); }
    ids(cart) { return order.cartIds(cart); }
    line(cart, id, form, hideRates) { return order.cartLine(cart, id, form, hideRates); }
    taskMatches(tasks, text) { return order.taskMatches(tasks, text); }
    stillNeeded(form, cart) { return order.stillNeeded(form, cart); }
    submitWords(cart, resume) { return order.submitWords(cart, resume); }
    draftWords(resume) { return order.draftWords(resume); }
    agreementText(a) { return order.agreementText(a); }
    customerUrl(newBase, draftId) { return order.customerRequestUrl(newBase, draftId); }
    same(a, b) { return (a == null ? '' : '' + a) === (b == null ? '' : '' + b); }
    picked(v) { return v != null && v !== ''; }

    /** Under the title: the dates and the project, or what to do first. */
    subline(form, requestFor) {
      const f = form || {};
      if (requestFor === 'customer') return 'Equipment for a customer, billed to them under a Fusion sell contract.';
      if (!f.startDate || !f.endDate) return 'The dates, the project, the equipment; then review and submit.';
      return [order.windowText(f.startDate, f.endDate), f.projectName].filter((x) => !!x).join(' · ');
    }

    /** "3 items · 4 pieces". */
    cartCount(cart) {
      const s = order.cartSummary(cart, '', '', true);
      if (!s.lines) return 'Empty';
      return s.lines + (s.lines === 1 ? ' item' : ' items') + (s.units !== s.lines ? ' · ' + s.units + ' pieces' : '');
    }

    /** The estimated total and how much of the cart it covers: { total, note }. */
    totals(cart, form, hideRates) {
      const f = form || {};
      const s = order.cartSummary(cart, f.startDate, f.endDate, hideRates);
      if (!s.priced) return { total: '—', note: f.startDate && f.endDate ? 'no prices yet' : 'once the dates are in' };
      return { total: order.money(s.total), note: s.priced < s.lines ? s.priced + ' of ' + s.lines + ' priced' : '' };
    }

    /** What the catalog shows, said once above it. */
    catalogNote(shown, count, all, form) {
      const f = form || {};
      const n = count === all ? all + (all === 1 ? ' item' : ' items') : count + ' of ' + all + ' items';
      return n + (f.startDate && f.endDate ? ' · free and priced for ' + order.windowText(f.startDate, f.endDate)
        : ' · pick the dates to see what is free');
    }

    /** "Still needed before Review: Project, Task and Customer." */
    missingText(missing) { return 'Still needed: ' + order.listWords(missing || []) + '.'; }

    /** The project on Review: "PRJ-2026-001 Pipeline North · EPC_US_BU". */
    projectText(form) {
      const f = form || {};
      return [[f.projectNumber, f.projectName].filter((x) => !!x).join(' '), f.projectBuName].filter((x) => !!x).join(' · ') || '—';
    }

    taskText(form) {
      const f = form || {};
      return [f.taskNumber, f.taskName].filter((x) => !!x).join(' ') || '—';
    }

    /** What the delivery line reads as on Review. */
    deliveryText(form) {
      const f = form || {};
      const where = f.location || '—';
      return f.locationType === 'PROJECT_SITE' ? where + ' (contract site)' : where;
    }
  }

  return PageModule;
});
