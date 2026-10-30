define(['resources/js/exportKit', 'resources/js/fmt', 'resources/js/nav', 'resources/js/unitPicker', 'resources/js/approvalQueue'], (exportKit, fmt, nav, unitPicker, queue) => {
  'use strict';

  // Approve & allocate: binding helpers, and the unit pickers kept between chains (as New EquipRite's page module
  // keeps them): the one open under a line (manual), and one per line with its suggested units staged (auto-allocate
  // saves exactly those). The logic is resources/js/approvalQueue.js; the calls are resources/js/approveAllocate.js.
  class PageModule {
    constructor() {
      this._pick = new unitPicker.Picker();
      this._sugg = {};
    }

    formats() { return exportKit.FORMATS; }

    // ── The open picker ─────────────────────────────────────────────────────────────────────────────────
    picker() { return this._pick; }
    initPicker(u, ownRequest) {
      this._pick = new unitPicker.Picker();
      this._pick.initUnits(u.resources, u.allocated, u.allocLine, u.mode, u.confirmed, u.readOnly, u.bookings, ownRequest);
      return this._pick;
    }
    clearPicker() { this._pick = new unitPicker.Picker(); }
    pickerRows(tick) { return this._pick.unitRows(tick); }
    pickerSummary(tick) { return this._pick.allocationSummary(tick); }
    pickerPlan(tick) { return this._pick.plan(); }
    pickerTicks(tick) { const w = this._pick.scheduleWindow(); return w ? w.ticks : []; }
    pickerBand(tick) { return this._pick.windowBand(); }

    // ── Suggestion pickers (auto-allocate) ──────────────────────────────────────────────────────────────
    setSuggestions(map) { this._sugg = map || {}; }
    suggestion(lineId) { return this._sugg[String(lineId)] || null; }

    // ── Bindings ────────────────────────────────────────────────────────────────────────────────────────
    has(list, id) { return (Array.isArray(list) ? list : []).some((x) => String(x) === String(id)); }
    allTicked(list, rows) {
      const r = (Array.isArray(rows) ? rows : []).filter((x) => x.kind === 'decide');
      return r.length > 0 && r.every((x) => this.has(list, x.key));
    }
    decideCount(rows) { return (Array.isArray(rows) ? rows : []).filter((x) => x.kind === 'decide').length; }
    left(b) { return { left: b.left + '%', width: b.width + '%' }; }
    at(t) { return { left: t.left + '%' }; }
    count(n, one, many) { return fmt.count(n, one, many); }
    money(v) { return fmt.money(v); }
    range(a, b) { return fmt.range(a, b); }
    /** Approve or Send back, before the click (approvalQueue.decisionPlan): label, count, note. */
    plan(kind, lines, ticks, requester) { return queue.decisionPlan(kind, lines, ticks, requester); }
    /** A unit's schedule bars as words, for screen readers. */
    barText(bars) { return (Array.isArray(bars) ? bars : []).map((b) => b.label).join('; '); }

    /** A line's suggestion in words (approvalQueue.suggestionWords result), or none. */
    sugText(sugg, id) {
      const s = sugg && sugg.byLine ? sugg.byLine[String(id)] : null;
      return s ? s.words : null;
    }

    /** This request on New EquipRite's Approve & allocate (everything there, Fusion steps included). */
    newUrl(base, head) {
      if (!base || !head || !head.id) return '';
      const b = base.slice(-1) === '/' ? base : base + '/';
      return b + 'vp/shell/workbench/approve-allocate?requestId=' + encodeURIComponent(head.number || '') + '&requestNumericId=' + encodeURIComponent(head.id);
    }
    /** New EquipRite's Initiate picking (the Transfer Order goes to Fusion; not in Next yet). */
    pickingUrl(base) { return nav.newUrl(base, 'picking'); }
    /** The quote page in Old EquipRite, where quotes are generated (New's oldQuoteLink). */
    quoteUrl(oldBase, head) {
      if (!oldBase || !head || !head.id) return '';
      const b = oldBase.slice(-1) === '/' ? oldBase : oldBase + '/';
      return b + 'vp/shell/equipment-foundation/request-quote?requestId=' + encodeURIComponent(head.id)
        + '&requestNumber=' + encodeURIComponent(head.number || '') + '&sourcePage=request-detail';
    }
  }

  return PageModule;
});
