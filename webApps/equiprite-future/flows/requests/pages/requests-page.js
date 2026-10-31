define(['resources/js/exportKit', 'resources/js/fmt', 'resources/js/shellBus'], (exportKit, fmt, bus) => {
  'use strict';

  // Requests: binding helpers. The logic is resources/js/requestList.js.
  class PageModule {
    constructor(context) {
      // Another screen may hand over a stage to show (shellBus.focus, from Help): focusChain takes it.
      const helper = context && typeof context.getEventHelper === 'function' ? context.getEventHelper() : null;
      bus.onFocus('requests', () => { if (helper) helper.fireCustomEvent('focusRequest', {}); });
    }

    /** The export menu's formats. */
    formats() { return exportKit.FORMATS; }

    /** Sort arrow for a column header. */
    sortMark(key, sortKey, sortDir) { return key === sortKey ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''; }

    /** aria-sort for a column header. */
    ariaSort(key, sortKey, sortDir) { return key === sortKey ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'; }

    range(a, b) { return fmt.range(a, b); }

    /** An array, or an empty one (no array literals in bindings). */
    arr(a) { return Array.isArray(a) ? a : []; }

    // ── The popup on a request (popChain) ───────────────────────────────────────────────────────────────
    popKicker(pop) {
      if (!pop || pop.kind === 'history') return 'Timeline: start to end';
      return pop.step === 'done' ? 'Decided' : (pop.external ? 'Customer request' : 'Project request');
    }

    popSub(pop) {
      if (!pop) return '';
      return [pop.party + (pop.task ? ' · ' + pop.task : ''), pop.dates, pop.requestor ? 'requested by ' + pop.requestor : ''].filter((t) => !!t).join(' · ');
    }

    approveLabel(pop) {
      const n = pop && pop.waiting;
      return n > 1 ? 'Approve all ' + n : 'Approve';
    }

    /** What approving will do, before it is done. */
    approveNote(pop) {
      const n = (pop && pop.waiting) || 0;
      const who = (pop && pop.requestor) || 'the requester';
      return (n > 1 ? 'The ' + n + ' pieces still waiting are approved together' : 'The piece waiting is approved')
        + ': all or nothing. A piece that already has its unit goes straight to the yard for picking; the others wait for a unit '
        + '(Assign units). Sending back asks for a reason, which ' + who + ' gets.';
    }

    /** A step's state in words, beside its label. */
    stepState(m) {
      return { done: '', partly: 'in progress', here: 'now', todo: '', stopped: '', skipped: 'not reached' }[m && m.state] || '';
    }

    /** When a step was reached and by whom; says so when it was reached but not recorded. */
    stepWhen(m) {
      if (!m || m.state === 'todo' || m.state === 'skipped') return '';
      if (m.when) return m.when + (m.who ? ' · ' + m.who : '');
      return m.missing ? 'Reached; the date was not recorded' : (m.state === 'here' ? 'Waiting' : '');
    }

    /** An event's when, who and where it comes from. */
    eventMeta(e) {
      if (!e) return '';
      return [e.when || 'Date not recorded', e.who || '', e.recorded ? 'recorded' : 'from its dates'].filter((t) => !!t).join(' · ');
    }

    /** Where today is in the rental: "Starts in 5 days", "Ends today", "Ended 3 days ago". */
    when(start, end) {
      const t = fmt.today();
      const s = fmt.dayMs(start);
      const e = fmt.dayMs(end);
      if (s != null && t < s) return 'Starts ' + fmt.relative(start);
      if (e != null && t <= e) return 'Ends ' + fmt.relative(end);
      if (e != null) return 'Ended ' + fmt.relative(end);
      return '';
    }
  }

  return PageModule;
});
