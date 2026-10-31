define(['resources/js/costPreview', 'resources/js/costPosting', 'resources/js/exportKit', 'resources/js/fmt'], (CP, costPosting, exportKit, fmt) => {
  'use strict';

  // Post costs: binding helpers. The rules are New EquipRite's Post costs (resources/js/costPreview.js CostRules:
  // buildList, filterList, buildPreview, postingPlan …); what is ready and posted per request is its CostPreview layer.
  // A request is posted in its own tab (cost-page); when one is, this list reads again (costPosting.onPosted fires
  // costsPosted, which runs loadChain).
  class PageModule extends CP.CostPreview {
    constructor(context) {
      super();
      const helper = context && typeof context.getEventHelper === 'function' ? context.getEventHelper() : null;
      costPosting.onPosted('costs', (number) => { if (helper) helper.fireCustomEvent('costsPosted', { number: number || '' }); });
    }

    formats() { return exportKit.FORMATS; }

    /** The newest request with cost ready to post, for the head's Post button ('' when none). */
    nextReady(list, breakdown) {
      const b = breakdown || {};
      const ready = (Array.isArray(list) ? list : []).filter((r) => b[r.requestNumber] && b[r.requestNumber].ready > 0)
        .sort((x, y) => (Number(y.eqrEquipmentRequestId) || 0) - (Number(x.eqrEquipmentRequestId) || 0));
      return ready.length ? ready[0].requestNumber : '';
    }

    money(n) { return fmt.money(n) || '$0'; }

    date(v) { return fmt.date(v); }

    range(a, b) { return fmt.range(a, b); }

    plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

    sortMark(key, sortKey, sortDir) { return key === sortKey ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''; }

    ariaSort(key, sortKey, sortDir) { return key === sortKey ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'; }

    summary(list, breakdown, progress, isLoading) {
      if (isLoading && !(list || []).length) return 'Loading the requests with cost…';
      const t = this.totals(list, breakdown);
      if (!t.requests) return 'No request has cost yet.';
      const head = this.plural(t.requests, 'request') + ' · ' + this.money(t.cost) + ' cost to date';
      const p = progress || {};
      if (p.total && p.done < p.total) return head + ' · working out what is ready (' + p.done + ' of ' + p.total + ')…';
      return head + ' · ' + this.money(t.ready) + ' ready to post';
    }

    /** Where the rental is today, in words: "Rental over · ended 3 days ago". */
    stateText(row) {
      const s = this.listState(row);
      const end = row && row.endDate;
      if (s === 'over') return 'Rental over' + (end ? ', ended ' + fmt.relative(end) : '');
      if (s === 'future') return 'Not started' + (row && row.startDate ? ', starts ' + fmt.relative(row.startDate) : '');
      return 'Rental running' + (end ? ', ends ' + fmt.relative(end) : '');
    }

    stateTone(row) {
      return { over: 'done', running: 'onsite', future: 'draft' }[this.listState(row)] || 'draft';
    }

    cell(b, key) {
      if (!b) return '…';
      if (key === 'lastPosted') return b.lastPosted || '—';
      return b[key] ? this.money(b[key]) : '—';
    }

    readyNote(b) {
      if (!b) return 'working out…';
      const parts = [];
      if (b.readyWeeks) parts.push(this.plural(b.readyWeeks, 'week'));
      if (b.readyCharges) parts.push(this.plural(b.readyCharges, 'charge'));
      return parts.join(' + ');
    }

    runningNote(b) {
      if (!b || !b.runningWeeks) return '';
      return this.plural(b.runningWeeks, 'week') + ' not ended';
    }

    /** The rows shown, each with its breakdown attached (for the template and the export). */
    shownRows(list, text, chip, breakdown, sortKey, sortDir) {
      const b = breakdown || {};
      return this.listShown(list, text, chip, b, sortKey, sortDir).map((r) => Object.assign({}, r, { b: b[r.requestNumber] || null }));
    }
  }

  return PageModule;
});
