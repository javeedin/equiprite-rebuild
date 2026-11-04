define(['resources/js/exportKit', 'resources/js/fmt', 'resources/js/nav', 'resources/js/unitPicker', 'resources/js/approvalQueue', 'resources/js/shellBus',
  'resources/js/confirmPicking'], (exportKit, fmt, nav, unitPicker, queue, bus, confirmPicking) => {
  'use strict';

  // Approve & allocate: binding helpers, and the unit pickers kept between chains (as New EquipRite's page module
  // keeps them): the one open under a line (manual), and one per line with its suggested units staged (auto-allocate
  // saves exactly those). The logic is resources/js/approvalQueue.js; the calls are resources/js/approveAllocate.js.
  class PageModule {
    constructor(context) {
      this._pick = new unitPicker.Picker();
      this._sugg = {};
      // Another screen may hand over a request to open (shellBus.focus): focusChain takes it.
      const helper = context && typeof context.getEventHelper === 'function' ? context.getEventHelper() : null;
      bus.onFocus('approvals', () => { if (helper) helper.fireCustomEvent('focusRequest', {}); });
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
    /** New EquipRite's picking screen: for lines with no unit to assign (no serial, lot or stock), which Next cannot confirm. */
    pickingUrl(base) { return nav.newUrl(base, 'picking'); }

    /** The pieces Confirm for picking takes here: unit assigned, no transfer order yet (confirmPicking.confirmable). */
    confirmCount(lines) { return confirmPicking.confirmable(lines).length; }

    /** The bar over one request: why only it is shown, or that it has nothing waiting. */
    focusNote(focus, total) {
      const f = focus || {};
      const others = Math.max(0, (Number(total) || 0) - (f.missing ? 0 : 1));
      if (f.missing) return 'It has nothing waiting to approve or assign now.';
      const where = !f.label ? 'for it' : (f.label === f.number ? 'from its tab' : 'from ' + f.label);
      return 'Opened ' + where + '. ' + (others ? fmt.count(others, 'other request') + (others === 1 ? ' waits' : ' wait') + ' in the queue, hidden while you work on this one.' : 'Nothing else waits in the queue.');
    }
    // ── The Redwood look (your menu): the queue as Oracle's Smart Search page; a request under Oracle's header ─────
    /** What the Redwood look shows: 'list' (the queue), 'record' (a request, or one handed over: focus), '' (Current). */
    rwMode(look, key, focusNumber) {
      if (look !== 'redwood') return '';
      return key || focusNumber ? 'record' : 'list';
    }
    /** The panel steps aside under Redwood while no request is open (the queue's table shows instead). */
    rwPanelHidden(look, key) { return look === 'redwood' && !key; }
    /** The header's title: the request. */
    rwRecTitle(head, current, focus) {
      return (head && head.number) || (current && current.number) || (focus && focus.number) || 'Approve & allocate';
    }
    /** The header's subtitle: what kind of request, for whom (the kicker and the line under the Current title). */
    rwRecSub(head, current, focus) {
      if (focus && focus.number && focus.missing) return 'Nothing waiting to approve or assign now';
      const h = head && head.number ? head : (current || {});
      return [h.external ? 'Customer request' : 'Project request', h.party || '', h.task || ''].filter((t) => !!t).join(' · ');
    }
    /** The header's badge: the request's state in words, in Oracle's badge colours. */
    rwBadge(head) {
      const tone = { draft: 'neutral', approval: 'info', ready: 'warning', out: 'info', onsite: 'success', back: 'info', done: 'neutral', stopped: 'danger' };
      return head && head.headline ? { text: head.headline, status: tone[head.tone] || 'neutral' } : { text: '', status: 'neutral' };
    }
    /** The bulk result's requests: done, then skipped, then failed (no array literals in bindings). */
    bulkLines(res) { return res ? [].concat(res.done || [], res.skipped || [], res.failed || []) : []; }
    /** The header's actions, as the current look's buttons (rwActionChain does each). */
    rwRecActions(focus, total, head, newBase, loading) {
      const out = [];
      if (focus && focus.number) out.push({ id: 'queue', label: 'Show the whole queue (' + (Number(total) || 0) + ')', icon: 'oj-ux-ico-list', display: 'on' });
      if (head && head.number) out.push({ id: 'tab', label: 'Open in a tab', icon: 'oj-ux-ico-open-new-tab', display: 'on' });
      if (this.newUrl(newBase, head)) out.push({ id: 'new', label: 'In New', icon: 'oj-ux-ico-external-link', display: 'on' });
      out.push({ id: 'refresh', label: loading ? 'Refreshing…' : 'Refresh', icon: 'oj-ux-ico-refresh', display: 'on' });
      return out;
    }

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
