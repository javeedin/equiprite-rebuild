define([], () => {
  'use strict';

  // Same semantic buckets the units grid uses, so a serial's status pill looks
  // identical on the list and on this page. See equipment-units-page.js.
  const STATUS_BUCKET = {
    AVAILABLE:        'good',
    ACTIVE:           'good',
    RETIRED:          'blocked',
    LOST:             'blocked',
    EXPIRED:          'blocked',
    RECALLED:         'blocked',
    REJECTED:         'blocked',
    RENTED:           'progress',
    RESERVED:         'progress',
    IN_MAINTENANCE:   'progress',
    IN_TRANSIT:       'progress',
    RETURN_INITIATED: 'progress',
    IN_SERVICE:       'progress',
    MAINTENANCE:      'progress'
  };

  // Work-order status buckets. Fusion maintenance WO status codes
  // (ORA_COMPLETED / ORA_RELEASED / ...) are normalised to plain words by the
  // builder in vbEnterChain, so match on the plain words here.
  const WO_BUCKET = {
    COMPLETED:   'good',
    CLOSED:      'good',
    CANCELED:    'blocked',
    CANCELLED:   'blocked',
    'ON HOLD':   'blocked',
    RELEASED:    'progress',
    'IN PROGRESS': 'progress',
    UNRELEASED:  'neutral',
    DRAFT:       'neutral'
  };

  class PageModule {
    // Dates arrive either as bare 'YYYY-MM-DD' (DATE columns) or as an ISO
    // instant (TIMESTAMP columns). Slice before parsing so a UTC instant does
    // not shift a day backwards for users west of Greenwich.
    formatDate(value) {
      if (!value) return '';
      const s = String(value).substring(0, 10);
      const parts = s.split('-');
      if (parts.length !== 3) return s;
      const month = parseInt(parts[1], 10);
      const day   = parseInt(parts[2], 10);
      if (isNaN(month) || isNaN(day)) return s;
      return month + '/' + day + '/' + parts[0];
    }

    formatDateTime(value) {
      if (!value) return '';
      const datePart = this.formatDate(value);
      const s = String(value);
      const t = s.length > 11 ? s.substring(11, 16) : '';
      return t ? (datePart + ' ' + t) : datePart;
    }

    formatNumber(value) {
      if (value == null || value === '') return '';
      const n = Number(value);
      if (isNaN(n)) return String(value);
      return n.toLocaleString();
    }

    formatCurrency(value, currency) {
      if (value == null || value === '') return '';
      const n = Number(value);
      if (isNaN(n)) return String(value);
      const code = currency || 'USD';
      try {
        return n.toLocaleString(undefined, {
          style: 'currency', currency: code,
          minimumFractionDigits: 2, maximumFractionDigits: 2
        });
      } catch (e) {
        // Unknown/blank ISO code - never let a formatting error blank the cell.
        return code + ' ' + n.toLocaleString(undefined, {
          minimumFractionDigits: 2, maximumFractionDigits: 2
        });
      }
    }

    // Flags come back as 'Y'/'N' from eqp-v1 but as real booleans from Fusion.
    yesNo(value) {
      if (value == null || value === '') return '';
      if (value === true  || value === 'Y' || value === 'y') return 'Yes';
      if (value === false || value === 'N' || value === 'n') return 'No';
      return String(value);
    }

    badgeClass(status) {
      const bucket = STATUS_BUCKET[String(status || '').toUpperCase()] || 'neutral';
      return 'eq-unit-badge eq-unit-badge--' + bucket;
    }

    badgeLabel(status) {
      if (!status) return '';
      return String(status).replace(/_/g, ' ');
    }

    woBadgeClass(status) {
      const bucket = WO_BUCKET[String(status || '').toUpperCase()] || 'neutral';
      return 'eq-unit-badge eq-unit-badge--' + bucket;
    }

    // ── Attachments dialog ───────────────────────────────────────────────
    // Rows are built by loadAttachmentsChain (resources/js/equipmentAttachments
    // toRow); these only filter and colour them, so the list re-filters with no
    // REST call. Same four functions on equipment-units-page and
    // equipment-unit-detail-page, which share the dialog.

    // category is the filter's value: 'ALL' or a category id as a string.
    filterAttachments(rows, category, status) {
      if (!Array.isArray(rows)) return [];
      return rows.filter(r =>
        (!category || category === 'ALL' || String(r.categoryId) === String(category)) &&
        (!status   || status   === 'ALL' || r.status === status));
    }

    attStatusClass(status) {
      const bucket = { valid: 'good', expired: 'blocked', upcoming: 'progress' }[status] || 'neutral';
      return 'eq-unit-badge eq-unit-badge--' + bucket;
    }

    // Button label: 'Attachments (3)'.
    attButtonLabel(rows) {
      const n = Array.isArray(rows) ? rows.length : 0;
      return n ? 'Attachments (' + n + ')' : 'Attachments';
    }

    // Expired documents, flagged beside the button so a lapsed certificate is
    // visible without opening the dialog. Only categories with validity count.
    attExpiredCount(rows) {
      return Array.isArray(rows) ? rows.filter(r => r.status === 'expired').length : 0;
    }
  }

  return PageModule;
});
