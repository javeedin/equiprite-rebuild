define([], () => {
  'use strict';

  // Rental agreements (wireframe: Agreements; FDD 7.3A). The list; a row opens its lines on their own page.
  // Rows are the old RentalAgreementInitChain's (views/rental-agreements), newest first.

  // The statuses an agreement takes (the old list's status options plus the FDD's 7.3A.2 states), in order.
  const STATUSES = ['DRAFT', 'PENDING', 'APPROVED', 'ACTIVE', 'REJECTED', 'EXPIRED', 'CANCELLED'];
  const LABELS = { DRAFT: 'Draft', PENDING: 'Pending', APPROVED: 'Approved', ACTIVE: 'Active', REJECTED: 'Rejected',
    EXPIRED: 'Expired', CANCELLED: 'Cancelled' };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const EXPIRING_DAYS = 60;

  const txt = (v) => (v == null ? '' : String(v));
  const utcDay = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(txt(iso));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
  };

  class PageModule {
    statusLabel(code) {
      const c = txt(code).toUpperCase();
      return LABELS[c] || (c ? c.charAt(0) + c.slice(1).toLowerCase() : '—');
    }

    statusClass(code) {
      return 'er-agr er-agr--' + (txt(code).toUpperCase() || 'NONE');
    }

    /** Whole days from today to the end date (negative once past), or null. */
    daysLeft(endDate, today) {
      const end = utcDay(endDate);
      if (end == null) return null;
      const t = utcDay(today || new Date().toISOString().slice(0, 10));
      return Math.round((end - t) / 86400000);
    }

    /** An ACTIVE agreement ending within 60 days (RPT-16 / NTF-09 "agreement expiring"). */
    isExpiring(row, today) {
      const d = this.daysLeft(row && row.endDate, today);
      return !!row && row.statusCode === 'ACTIVE' && d !== null && d >= 0 && d <= EXPIRING_DAYS;
    }

    expiryText(row, today) {
      const d = this.daysLeft(row && row.endDate, today);
      if (d === null) return '';
      if (d < 0) return row && row.statusCode === 'ACTIVE' ? 'Past its end date' : '';
      if (d === 0) return 'Ends today';
      return d <= EXPIRING_DAYS ? 'Ends in ' + d + (d === 1 ? ' day' : ' days') : '';
    }

    day(v) {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(txt(v));
      return m ? Number(m[3]) + ' ' + MON[Number(m[2]) - 1] + ' ' + m[1] : '';
    }

    window(row) {
      const a = this.day(row && row.startDate);
      const b = this.day(row && row.endDate);
      return a && b ? a + ' – ' + b : (a || b || '—');
    }

    /** Status chips with counts (statuses present only), All first and Expiring last. */
    chips(rows, today) {
      const list = Array.isArray(rows) ? rows : [];
      const counts = {};
      list.forEach((r) => { const s = txt(r.statusCode).toUpperCase() || 'NONE'; counts[s] = (counts[s] || 0) + 1; });
      const known = STATUSES.filter((s) => counts[s]);
      const other = Object.keys(counts).filter((s) => STATUSES.indexOf(s) === -1).sort();
      const out = [{ key: 'all', label: 'All', count: list.length }]
        .concat(known.concat(other).map((s) => ({ key: s, label: s === 'NONE' ? 'No status' : this.statusLabel(s), count: counts[s] })));
      const exp = list.filter((r) => this.isExpiring(r, today)).length;
      if (exp) out.push({ key: 'expiring', label: 'Ending soon', count: exp });
      return out;
    }

    /** True when two row lists hold the same objects in the same order. */
    sameRows(a, b) {
      if (a === b) return true;
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
      }
      return true;
    }

    /** The rows shown: the chip, then free text over number, name, customer and type (the old Smart Search's fields). */
    filterRows(rows, text, chip, today) {
      const q = txt(text).trim().toLowerCase();
      return (Array.isArray(rows) ? rows : []).filter((r) => {
        if (chip === 'expiring' && !this.isExpiring(r, today)) return false;
        if (chip && chip !== 'all' && chip !== 'expiring' && (txt(r.statusCode).toUpperCase() || 'NONE') !== chip) return false;
        if (!q) return true;
        return [r.agreementNumber, r.agreementName, r.customer, r.agreementType]
          .some((v) => v && String(v).toLowerCase().includes(q));
      });
    }

    /** The old list's edit rule (navigateToEditChain): ACTIVE, REJECTED and EXPIRED agreements cannot be edited. */
    canEdit(statusCode) {
      return ['ACTIVE', 'REJECTED', 'EXPIRED'].indexOf(txt(statusCode).toUpperCase()) === -1;
    }

    columns() {
      return [
        { headerText: 'Agreement', field: 'agreementNumber', template: 'numTpl', sortable: 'enabled', minWidth: 240 },
        { headerText: 'Customer', field: 'customer', sortable: 'enabled', minWidth: 180 },
        { headerText: 'Type', field: 'agreementType', sortable: 'enabled', width: 140 },
        { headerText: 'Valid', field: 'startDate', template: 'validTpl', sortable: 'enabled', minWidth: 210 },
        { headerText: 'Status', field: 'statusCode', template: 'statusTpl', sortable: 'enabled', width: 130 },
        { headerText: 'Lines', field: 'lineCount', template: 'linesTpl', sortable: 'enabled', width: 110 },
      ];
    }
  }

  return PageModule;
});
