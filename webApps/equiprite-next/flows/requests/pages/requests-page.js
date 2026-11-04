define(['resources/js/exportKit', 'resources/js/fmt', 'resources/js/shellBus'], (exportKit, fmt, bus) => {
  'use strict';

  // Requests: binding helpers. The logic is resources/js/requestList.js.
  class PageModule {
    constructor(context) {
      // Another screen may hand over a stage to show (shellBus.focus, from Help): focusChain takes it.
      const helper = context && typeof context.getEventHelper === 'function' ? context.getEventHelper() : null;
      bus.onFocus('requests', () => { if (helper) helper.fireCustomEvent('focusRequest', {}); });
    }

    /** The look switch's two choices (Redwood view: oj-c-buttonset-single). */
    uiItems() { return [{ value: 'redwood', label: 'Redwood' }, { value: 'current', label: 'Current' }]; }

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
      if (pop.kind === 'road') return 'Getting it to site';
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
        + ': all or nothing. A piece that already has its unit waits for Confirm (its transfer order), then the yard picks it; the '
        + 'others wait for a unit first (Assign units). Sending back asks for a reason, which ' + who + ' gets.';
    }

    // ── Getting it to site (popChain road) ──────────────────────────────────────────────────────────────
    pieces(n) { return fmt.count(Number(n) || 0, 'piece'); }

    /** The row's Confirm N: what it is and who does it. */
    confirmTitle(n) {
      return this.pieces(n) + ' with the unit assigned, waiting for the Equipment Manager to confirm for picking (it asks Fusion for the transfer order). '
        + 'Opens where each piece is, and confirms it there.';
    }

    /** The row's Accept N. */
    acceptTitle(n) { return this.pieces(n) + ' on the way to site, for the site to accept on arrival. Opens where each piece is, and accepts it there.'; }

    /** The row's Pick N. */
    pickTitle(n) { return this.pieces(n) + ' in the yard\'s queue, to release, pick and ship. Opens where each piece is, and what to do.'; }

    /** The pick card: how many wait for release and how many are being picked. */
    pickNote(road) {
      const steps = (road && road.steps) || [];
      const at = (k) => (steps.filter((s) => s.key === k)[0] || {}).count || 0;
      const parts = [];
      if (at('pick')) parts.push(this.pieces(at('pick')) + (at('pick') === 1 ? ' is' : ' are') + ' confirmed and waiting to be released for picking');
      if (at('picking')) parts.push(this.pieces(at('picking')) + (at('picking') === 1 ? ' is' : ' are') + ' being picked, to ship');
      return parts.join('; ') + '. Picking & shipping opens with this request in front: release, pick and ship there, then Back to Requests.';
    }

    /** Pieces not on the road now: still before approval, or past it (on site, on the way back). */
    roadElse(road) {
      const out = [];
      if (road && road.before) out.push(this.pieces(road.before) + ' still before approval');
      if (road && road.beyond) out.push(this.pieces(road.beyond) + ' already past this (on site or on the way back)');
      return 'Not shown: ' + out.join(', and ') + '.';
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
