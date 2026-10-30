define(['resources/js/mobileBus', 'resources/js/unitPicker', 'resources/js/approvalQueue', 'resources/js/mobileApprove', 'resources/js/fmt', 'resources/js/mobileRecent'],
  (bus, unitPicker, queue, ma, fmt, recent) => {
  'use strict';

  // Approve on a phone: binding helpers, what the chains keep between them (the request list as last read, the unit
  // picker open in the unit sheet, one picker per line with its suggested units staged), and the line from another tab
  // or a deep link (mobileBus.focus('approve', …)) to this screen. The logic is resources/js/mobileApprove.js and
  // approvalQueue.js; the calls are resources/js/approveAllocate.js (as in Next's Approve & allocate).
  class PageModule {
    constructor(context) {
      this._pick = new unitPicker.Picker();
      this._sugg = {};
      this._data = null;
      const helper = context && typeof context.getEventHelper === 'function' ? context.getEventHelper() : null;
      bus.onFocus('approve', () => { if (helper) helper.fireCustomEvent('focusRequest', {}); });
    }

    // ── The request list as last read (requestData), kept out of the page's variables ───────────────────────
    setData(d) { this._data = d ? { rows: d.rows || [], linesByRequest: d.linesByRequest || {} } : null; }
    data() { return this._data; }

    // ── The unit sheet's picker (Next's manual picker) ──────────────────────────────────────────────────────
    picker() { return this._pick; }
    initPicker(u, ownRequest) {
      this._pick = new unitPicker.Picker();
      this._pick.initUnits(u.resources, u.allocated, u.allocLine, u.mode, u.confirmed, u.readOnly, u.bookings, ownRequest);
      return this._pick;
    }
    clearPicker() { this._pick = new unitPicker.Picker(); }
    pickerRows(tick, suggested) { return ma.unitRows(this._pick.unitRows(tick), suggested); }
    pickerSummary(tick) { return this._pick.allocationSummary(tick); }
    pickerPlan(tick) { return this._pick.plan(); }

    // ── Suggestion pickers (assign the suggested units: Next's auto-allocate) ────────────────────────────────
    setSuggestions(map) { this._sugg = map || {}; }
    suggestion(lineId) { return this._sugg[String(lineId)] || null; }

    // ── Bindings ────────────────────────────────────────────────────────────────────────────────────────────
    /** The class for a stage's colours. */
    stage(key) { return 'mb-stage--' + (key || 'approval'); }
    has(list, id) { return (Array.isArray(list) ? list : []).some((x) => String(x) === String(id)); }
    count(n, one, many) { return fmt.count(n, one, many); }
    money(v) { return fmt.money(v); }
    range(a, b) { return fmt.range(a, b); }
    /** A chip's count, '' when none. */
    chipCount(c) { return c && c.count ? String(c.count) : ''; }
    cardSub(c) { return ma.cardSub(c); }
    /** Approve or Send back, before the tap (approvalQueue.decisionPlan): label, count, note. */
    plan(kind, lines, ticks, requester) { return queue.decisionPlan(kind, lines, ticks, requester); }
    /** The card after the open one, to skip to ('' at the end). */
    after(list, key) { const c = ma.after(list, key); return c ? c.key : ''; }
    /** A line's suggested units in words ({ state, text }), or none. */
    sugText(sugg, id) {
      const s = sugg && sugg.byLine ? sugg.byLine[String(id)] : null;
      return s ? s.words : null;
    }
    lineButton(row, sugg) { return ma.lineButton(row, sugg); }
    reasons() { return ma.REASONS; }
    reasonOn(text, phrase) { return ma.hasReason(text, phrase); }
    pickingUrl(base) { return ma.pickingUrl(base); }
    inNewUrl(base, head) { return ma.inNewUrl(base, head); }
    quoteUrl(base, head) { return ma.quoteUrl(base, head); }

    /** "Last 3 days": the period the queue opens on. */
    recentLabel() { return recent.LABEL; }

    /** The empty queue, in words, for the chip, the search and the period (older requests left out: the line under it). */
    empty(chip, text, total, dated) {
      if (text) return 'No request matches “' + text + '”.';
      if (!total) return 'Nothing is waiting on you. New requests to decide, and approved lines with no unit yet, appear here.';
      const lately = dated && dated.filtered && dated.older > 0 ? ' ' + recent.PHRASE : '';
      if (chip === 'decide') return lately ? 'Nothing to decide' + lately + '.' : 'Nothing left to decide.';
      if (chip === 'allocate') return 'No approved line is waiting for a unit' + lately + '.';
      if (chip === 'late') return 'Nothing is late' + lately + '.';
      return lately ? 'Nothing' + lately + '.' : 'Nothing here.';
    }
  }

  return PageModule;
});
