define(['resources/js/costPreview', 'resources/js/exportKit', 'resources/js/nav', 'resources/js/fmt'], (CP, exportKit, nav, fmt) => {
  'use strict';

  // A request's costs: binding helpers. The figures are New EquipRite's (resources/js/costPreview.js).
  class PageModule extends CP.CostPreview {
    formats() { return exportKit.FORMATS; }

    /** New EquipRite's Post costs, opened on this request (its ?request=), where it is posted. */
    newPostUrl(newBase, number) {
      const u = nav.newUrl(newBase, 'costs');
      return u && number ? u + '?request=' + encodeURIComponent(number) : u;
    }

    money(n) { return fmt.money(n) || '$0'; }

    range(a, b) { return fmt.range(a, b); }

    plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

    /** The heading's pill: what is left to do on this request. */
    headWord(f) {
      if (!f || f.ready == null) return '';
      if (f.ready > 0) return this.money(f.ready) + ' ready to post';
      if (f.running > 0) return 'Running, nothing ready yet';
      if (f.posted > 0) return 'All posted';
      return 'Nothing to post';
    }

    headTone(f) {
      if (!f || f.ready == null) return 'draft';
      if (f.ready > 0) return 'ready';
      if (f.running > 0) return 'out';
      if (f.posted > 0) return 'onsite';
      return 'draft';
    }

    subline(row) {
      const r = row || {};
      const parts = [];
      if (r.projectName && r.projectName !== '—') parts.push(r.projectName + (r.taskName && r.taskName !== '—' ? ' / ' + r.taskName : ''));
      if (r.ppmProjectNumber) parts.push('PPM ' + r.ppmProjectNumber + (r.ppmTaskNumber ? ' / ' + r.ppmTaskNumber : ''));
      const dates = fmt.range(r.startDate, r.endDate);
      if (dates) parts.push(dates);
      return parts.join(' · ');
    }

    readyNote(f) {
      if (!f) return '';
      const parts = [];
      if (f.readyWeeks) parts.push(this.plural(f.readyWeeks, 'week') + ' ended');
      if (f.readyCharges) parts.push(this.plural(f.readyCharges, 'charge') + ' not posted');
      return parts.length ? parts.join(' + ') : 'Nothing has ended that is not posted';
    }

    rowClass(t) {
      return 'nx-row nx-pr-row nx-pr-row--' + t.kind;
    }
  }

  return PageModule;
});
