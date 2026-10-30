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

    /** An array, or an empty one (no array literals in bindings). */
    arr(a) { return Array.isArray(a) ? a : []; }

    /** A history step's state in words, beside its label. */
    stepState(m) {
      return { done: '', partly: 'in progress', here: 'now', todo: '', stopped: '', skipped: 'not reached' }[m && m.state] || '';
    }

    /** When a history step was reached and by whom; says so when it was reached but not recorded. */
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

    /** This request in New EquipRite (where it can be approved, allocated, delivered, returned today), or ''. */
    newUrl(newBase, head) {
      if (!newBase || !head || !head.id) return '';
      const base = newBase.slice(-1) === '/' ? newBase : newBase + '/';
      return base + 'vp/shell/request/request-detail?requestId=' + encodeURIComponent(head.requestNumber || '') + '&requestNumericId=' + encodeURIComponent(head.id);
    }
  }

  return PageModule;
});
