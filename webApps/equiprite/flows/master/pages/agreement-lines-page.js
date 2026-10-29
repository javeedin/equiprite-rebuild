define([], () => {
  'use strict';

  // One rental agreement and its lines, on their own page (wireframe: Agreements; FDD 7.3A.3–7.3A.6). Replaces
  // rental-agreement-lines. Lines can run past a thousand, so they are searched and shown 200 at a time; ticking
  // lines and "Create request" hands them to New request at the agreement's rates (the old Add to cart + Create
  // Request, in one step).

  const SHOW_STEP = 200;
  const LABELS = { DRAFT: 'Draft', PENDING: 'Pending', APPROVED: 'Approved', ACTIVE: 'Active', REJECTED: 'Rejected',
    EXPIRED: 'Expired', CANCELLED: 'Cancelled' };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const txt = (v) => (v == null ? '' : String(v));

  function money(n) {
    if (n == null || n === '' || isNaN(Number(n))) return '—';
    const v = Number(n);
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }

  class PageModule {
    /**
     * The old FilterLinesChain's rule: every typed word must appear in the equipment name, class, subclass or
     * description (any case).
     */
    filterLines(lines, text) {
      const words = txt(text).trim().toLowerCase().split(/\s+/).filter((w) => w);
      return (Array.isArray(lines) ? lines : []).filter((item) => {
        if (!words.length) return true;
        const hay = [item.equipment_name, item.class_name, item.subClassName, item.description]
          .map((v) => String(v || '').toLowerCase()).join(' ');
        return words.every((w) => hay.indexOf(w) !== -1);
      });
    }

    /** The first `limit` of the filtered lines (a thousand-line agreement stays quick). */
    visibleLines(lines, text, limit) {
      return this.filterLines(lines, text).slice(0, Number(limit) || SHOW_STEP);
    }

    showStep() {
      return SHOW_STEP;
    }

    statusLabel(code) {
      const c = txt(code).toUpperCase();
      return LABELS[c] || (c ? c.charAt(0) + c.slice(1).toLowerCase() : '');
    }

    statusClass(code) {
      return 'er-agr er-agr--' + (txt(code).toUpperCase() || 'NONE');
    }

    /** The old page's rule: Approve and Reject are offered until the agreement is ACTIVE, REJECTED or EXPIRED. */
    canDecide(status) {
      return ['ACTIVE', 'REJECTED', 'EXPIRED'].indexOf(txt(status).toUpperCase()) === -1;
    }

    /** The old list's edit rule (navigateToEditChain): the same three statuses cannot be edited. */
    canEdit(status) {
      return this.canDecide(status);
    }

    /** Lines can be requested only from an ACTIVE agreement (the old page's tick boxes were disabled otherwise). */
    canRequest(status) {
      return txt(status).toUpperCase() === 'ACTIVE';
    }

    rateText(line) {
      if (!line) return '';
      const uom = txt(line.price_uom).toUpperCase();
      return Number(line.bill_rate) > 0 ? money(line.bill_rate) + (uom && uom !== '—' ? ' / ' + uom.toLowerCase() : '') : 'From the rate schedule';
    }

    money(n) {
      return money(n);
    }

    day(v) {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(txt(v));
      return m ? Number(m[3]) + ' ' + MON[Number(m[2]) - 1] + ' ' + m[1] : '';
    }

    selectedCount(selected) {
      return Object.keys(selected || {}).length;
    }

    isSelected(selected, key) {
      return !!(selected || {})[key];
    }

    /** A NEW map with one line ticked or not; only lines with an agreement line id can be requested. */
    toggle(selected, key, on, idMap) {
      const next = Object.assign({}, selected || {});
      if (!key || !(idMap || {})[key]) return next;
      if (on) { next[key] = true; } else { delete next[key]; }
      return next;
    }

    /** Tick / untick every line the search shows. */
    toggleShown(selected, lines, text, on, idMap) {
      const next = Object.assign({}, selected || {});
      this.filterLines(lines, text).forEach((l) => {
        if (!(idMap || {})[l.compositeKey]) return;
        if (on) { next[l.compositeKey] = true; } else { delete next[l.compositeKey]; }
      });
      return next;
    }

    allShownSelected(selected, lines, text, idMap) {
      const shown = this.filterLines(lines, text).filter((l) => (idMap || {})[l.compositeKey]);
      return shown.length > 0 && shown.every((l) => !!(selected || {})[l.compositeKey]);
    }

    /**
     * What Create request will do, before the click: how many lines go, at whose rates, and how many name only a
     * class (those take the first equipment of the class, as the old Create Request did).
     */
    requestPreview(selected, lines, idMap) {
      const keys = Object.keys(selected || {});
      if (!keys.length) return 'Tick the lines to request.';
      const classOnly = keys.filter((k) => (idMap || {})[k] && (idMap[k].equipmentMasterId == null)).length;
      let t = keys.length + (keys.length === 1 ? ' line goes' : ' lines go') + ' to New request at this agreement\'s rates.';
      if (classOnly) {
        t += ' ' + classOnly + (classOnly === 1 ? ' line names' : ' lines name') + ' only a class: it takes the first equipment of that class.';
      }
      return t + ' You add the project, dates and delivery there.';
    }
  }

  return PageModule;
});
