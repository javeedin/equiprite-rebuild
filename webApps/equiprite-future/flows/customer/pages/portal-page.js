define(['resources/js/exportKit', 'resources/js/fmt', 'resources/js/portalSignal'], (exportKit, fmt, signal) => {
  'use strict';

  // The customer portal's home: binding helpers. The logic is resources/js/portalView.js (and New's customerPortal.js).
  // A change made in one of the portal's record tabs reads the home again (portalSignal → the portalChanged event).

  /** First name, capitalised, from the identity fields (priya.raman@x → Priya), as New's portal home reads it. */
  function firstName(user) {
    const fields = ['fullName', 'displayName', 'name', 'login', 'userName', 'username', 'preferred_username', 'email'];
    let raw = '';
    for (let i = 0; i < fields.length && !raw; i++) {
      const v = user && user[fields[i]];
      if (v && typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'anonymous') raw = v.trim();
    }
    const word = raw.split('@')[0].split(/[\s._-]+/).filter((p) => /[a-z]/i.test(p))[0] || '';
    return word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : '';
  }

  class PageModule {
    constructor(context) {
      const helper = context && typeof context.getEventHelper === 'function' ? context.getEventHelper() : null;
      if (helper) signal.listen(() => helper.fireCustomEvent('portalChanged', {}));
    }

    formats() { return exportKit.FORMATS; }

    /** "Good morning, Maria"; "Welcome" without a name. */
    greeting(user, now) {
      const n = firstName(user);
      return n ? fmt.greeting(now) + ', ' + n : 'Welcome';
    }

    sortMark(key, sortKey, sortDir) { return key === sortKey ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''; }

    ariaSort(key, sortKey, sortDir) { return key === sortKey ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'; }

    money(v) { return fmt.money(v) || '$0'; }

    date(v) { return fmt.date(v, false); }

    /** "Due back 12 Nov", "Due on site 2 Nov": the date that matters for a piece where it is now. */
    pieceWhen(row) {
      if (!row) return '';
      if (row.stage === 'onsite') return row.end ? 'Due back ' + fmt.date(row.end, false) : '';
      if (row.stage === 'out') return row.start ? 'Needed from ' + fmt.date(row.start, false) : '';
      return row.dates || '';
    }

    /** What the export menu exports, in words. */
    exportNote(view, reqs, eq, inv, all) {
      if (view === 'equipment') return eq + (eq === 1 ? ' piece' : ' pieces') + ', as shown';
      if (view === 'invoices') return inv + (inv === 1 ? ' invoice' : ' invoices') + ', as shown';
      if (view === 'requests') return reqs + (reqs === 1 ? ' request' : ' requests') + ', as shown';
      return 'All ' + all + (all === 1 ? ' request' : ' requests');
    }

    /** The empty-list sentence for a view and its chip. */
    emptyText(view, chip, text) {
      if (String(text || '').trim()) return 'Nothing matches “' + String(text).trim() + '”.';
      if (view === 'requests') {
        if (chip === 'needs') return 'Nothing needs you right now.';
        if (chip === 'open') return 'No open requests. Finished ones are under Finished.';
        if (chip === 'done') return 'No finished requests yet.';
        return 'No requests yet.';
      }
      if (view === 'equipment') return chip === 'all' ? 'No equipment on your open requests.' : 'No piece of equipment is here. Try another chip.';
      return chip === 'all' ? 'No invoices yet. A request is billed once its equipment is on your site.' : 'No invoice is here. Try another chip.';
    }
  }

  return PageModule;
});
