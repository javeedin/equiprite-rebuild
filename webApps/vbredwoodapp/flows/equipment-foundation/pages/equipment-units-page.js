define([], () => {
  'use strict';

  // Semantic status → badge color groups (Option B from design):
  //   good     → green   (AVAILABLE, ACTIVE)
  //   blocked  → red     (RETIRED, LOST, EXPIRED, RECALLED, REJECTED)
  //   progress → orange  (RENTED, RESERVED, IN_MAINTENANCE, IN_TRANSIT, RETURN_INITIATED)
  //   neutral  → grey    (anything else / unknown)
  // Real serial unit_status values are constrained by CK_EQR_SERIAL_UNIT_STATUS:
  // AVAILABLE / RENTED / RETIRED / LOST / IN_MAINTENANCE / IN_TRANSIT.
  // ('IN_SERVICE'/'MAINTENANCE' were stale assumptions — kept as aliases so any
  // legacy rows still bucket correctly.)
  const STATUS_BUCKET = {
    AVAILABLE:          'good',
    ACTIVE:             'good',
    RETIRED:            'blocked',
    LOST:               'blocked',
    EXPIRED:            'blocked',
    RECALLED:           'blocked',
    REJECTED:           'blocked',
    RENTED:             'progress',
    RESERVED:           'progress',
    IN_MAINTENANCE:     'progress',
    IN_TRANSIT:         'progress',
    RETURN_INITIATED:   'progress',
    IN_SERVICE:         'progress',
    MAINTENANCE:        'progress'
  };

  class PageModule {
    formatDate(value) {
      if (!value) return '';
      const s = String(value).substring(0, 10);
      const parts = s.split('-');
      if (parts.length !== 3) return s;
      const year  = parts[0];
      const month = parseInt(parts[1], 10);
      const day   = parseInt(parts[2], 10);
      if (isNaN(month) || isNaN(day)) return s;
      return month + '/' + day + '/' + year;
    }

    formatNumber(value) {
      if (value == null || value === '') return '';
      const n = Number(value);
      if (isNaN(n)) return String(value);
      return n.toLocaleString();
    }

    // Tracking flags arrive from eqp-v1 as the strings 'Y'/'N'. A bare
    // truthiness check reported every master as tracked, because 'N' is
    // truthy - which is why the header card read "Is Inventory Track? Yes" on
    // the 84 masters flagged N. Compare explicitly.
    yesNo(value) {
      if (value == null || value === '') return '';
      if (value === true  || value === 'Y' || value === 'y') return 'Yes';
      if (value === false || value === 'N' || value === 'n') return 'No';
      return String(value);
    }

    // ── Change Class dialog ───────────────────────────────────────────

    /** Subclasses of one class, for the dialog's second dropdown. */
    subclassOptionsFor(allSubclassOptions, classId) {
      if (classId == null) return [];
      return (Array.isArray(allSubclassOptions) ? allSubclassOptions : [])
        .filter(o => o && Number(o.classId) === Number(classId));
    }

    /** True when an end date is set and already past. */
    isEndDated(effectiveEndDate, now) {
      if (!effectiveEndDate) return false;
      const t = Date.parse(effectiveEndDate);
      return !isNaN(t) && t < (now != null ? now : Date.now());
    }

    /**
     * May the dialog save? { ok, message }.
     * A class is required. A class that HAS subclasses requires one: whether
     * PATCH clears a field sent as null is unverified, so null is only sent
     * for a class with none (saveClassChangeChain also reads the result back).
     */
    canSaveClass(draft, masterRecord, subclassOptions) {
      const d = draft || {};
      const m = masterRecord || {};
      if (d.classId == null) return { ok: false, message: 'Choose a class.' };
      const subs = Array.isArray(subclassOptions) ? subclassOptions : [];
      if (subs.length && d.subclassId == null) {
        return { ok: false, message: 'This class has subclasses. Choose one.' };
      }
      const same = Number(d.classId) === Number(m.equipmentClassId) &&
        (d.subclassId == null ? m.equipmentSubclassId == null
                              : Number(d.subclassId) === Number(m.equipmentSubclassId));
      if (same) return { ok: false, message: 'That is the current class. Nothing to save.' };
      return { ok: true, message: '' };
    }

    badgeClass(status) {
      const bucket = STATUS_BUCKET[String(status || '').toUpperCase()] || 'neutral';
      return 'eq-unit-badge eq-unit-badge--' + bucket;
    }

    badgeLabel(status) {
      if (!status) return '';
      return String(status).replace(/_/g, ' ');
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
