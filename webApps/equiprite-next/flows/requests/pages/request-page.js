define(['resources/js/exportKit', 'resources/js/fmt', 'resources/js/requestProgress'], (exportKit, fmt, Progress) => {
  'use strict';

  // A request's tab: binding helpers.
  class PageModule {
    formats() { return exportKit.FORMATS; }
    /** "Project · Task" under the title. */
    subline(head) { return [head && (head.project || head.customer), head && head.task].filter((x) => !!x).join(' · '); }
    range(a, b) { return fmt.range(a, b); }
    date(v) { return fmt.date(v); }
    money(v) { return fmt.money(v); }

    /** A stop's note: "2 of 3 here", "All past", "Some past". */
    stopNote(stop, total) {
      if (!stop) return '';
      if (stop.state === 'here') return total > 1 ? stop.count + ' of ' + total + ' here' : 'Here';
      if (stop.state === 'done') return 'All past';
      if (stop.state === 'passed') return 'Some past';
      return '';
    }

    /** A line's stage and words, a customer request read as such. */
    lineStage(status, external) { return Progress.line(status, !!external).stage || 'ready'; }
    lineLabel(status, external) { return Progress.line(status, !!external).label; }

    /** This request in New EquipRite (where it can be approved, allocated, delivered, returned today), or ''. */
    newUrl(newBase, head) {
      if (!newBase || !head || !head.id) return '';
      const base = newBase.slice(-1) === '/' ? newBase : newBase + '/';
      return base + 'vp/shell/request/request-detail?requestId=' + encodeURIComponent(head.requestNumber || '') + '&requestNumericId=' + encodeURIComponent(head.id);
    }
  }

  return PageModule;
});
