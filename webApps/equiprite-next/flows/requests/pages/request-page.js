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

    /** What Confirm or Accept will do, asked before it is done. */
    askText(ask, acts) {
      const a = acts || {};
      const n = (k) => { const v = Number(a[k]) || 0; return v + (v === 1 ? ' piece' : ' pieces'); };
      if (ask === 'confirm') {
        return 'Confirm ' + n('confirm') + ' for picking? Fusion is asked for the transfer order (one per yard it ships from, through OIC) and the pieces '
          + 'are scheduled for picking; a fixed asset is confirmed without one. The yard then sees them in Picking & shipping.';
      }
      if (ask === 'accept') {
        return 'Accept ' + n('accept') + ' on site? Each piece on its way is accepted: a rental is then on site (Deployed), a consumable delivered, or '
          + 'consumed when its class issues it from stock. When everything is on site, the request is marked Deployed.';
      }
      return '';
    }

    /** The button that does it. */
    askGo(ask, acts, busy) {
      if (busy) return busy === 'confirm' ? 'Asking Fusion for the transfer order…' : 'Accepting…';
      const a = acts || {};
      return ask === 'confirm' ? 'Confirm ' + (a.confirm || 0) + ' for picking' : 'Accept ' + (a.accept || 0) + ' on site';
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
