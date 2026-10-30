define(['resources/js/costPreview', 'resources/js/exportKit', 'resources/js/nav', 'resources/js/fmt'], (CP, exportKit, nav, fmt) => {
  'use strict';

  // Post costs: binding helpers. The rules are New EquipRite's Post costs (resources/js/costPreview.js CostRules:
  // buildList, filterList, buildPreview, postingPlan …); what is ready and posted per request is its CostPreview layer.
  class PageModule extends CP.CostPreview {
    formats() { return exportKit.FORMATS; }

    /** Post costs in New EquipRite, where the posting is done. */
    newPostUrl(newBase) { return nav.newUrl(newBase, 'costs'); }

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
