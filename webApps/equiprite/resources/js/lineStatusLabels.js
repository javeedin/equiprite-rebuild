define([], function() {
  'use strict';

  // Single source of truth for line-status display strings.
  // Pages and chains that render lineStatus should import this module
  // instead of defining their own map, so labels stay in sync.
  //
  // Vocabulary matches EQR_EQUIPMENT_REQUEST_LINE.lineStatus values driven
  // by the cascade in saveLineChain.js / confirmRequest path.
  var LINE_STATUS_LABELS = {
    DRAFT:            'DRAFT',
    SUBMITTED:        'SUBMITTED',
    IN_PROCESS:       'IN PROCESS',
    QUOTE_GENERATED:  'QUOTE GENERATED',
    QUOTE_ACCEPTED:   'QUOTE ACCEPTED',
    ALLOCATED:        'ALLOCATED',
    // Confirmed and queued for picking — the state between "confirmed" and
    // "released to the warehouse" (PICK_INITIATED). Written by Confirm Request
    // for BOTH classes: S&T once its Transfer Order is created (with or without
    // a prior allocation), F&M once its mandatory allocation is done.
    SCHEDULED_FOR_PICKING: 'SCHEDULED FOR PICKING',
    PICK_INITIATED:   'PICK INITIATED',
    SHIP_TO_SITE:     'SHIPPED TO SITE',
    DEPLOYED:         'DEPLOYED',
    UNDER_PROCUREMENT: 'UNDER PROCUREMENT',
    RETURN_INITIATED: 'RETURN INITIATED',
    RETURN_IN_PROCESS: 'RETURN IN PROCESS',
    SHIPPED_TO_YARD:  'SHIPPED TO YARD',
    CLOSED:           'CLOSED',
    REJECTED:         'REJECTED'
  };

  // Render a status code as its user-facing label.
  // Returns '' for null/empty input.
  //
  // Resolution order — each tier is the fallback for the one above:
  //   1. the shared-lookup cache, when `lookups` is supplied and warm:
  //      COMMONRITE.RS_LOOKUP_VALUES rows for LOOKUP_TYPE='LINE_STATUS',
  //      APPLICATION_CODE='EQUIP_RITE', loaded by loadCommonLookupsChain.
  //   2. LINE_STATUS_LABELS above — RETAINED ON PURPOSE as the offline
  //      fallback. Do NOT delete it as redundant once the lookup table is
  //      seeded: it is what keeps every status cell readable when
  //      common-service is down, unreachable from the VBCS proxy, or simply
  //      not configured in a given environment.
  //   3. underscores stripped + uppercased, so raw DB tokens (e.g. 'FOO_BAR')
  //      never leak into the UI — they show as 'FOO BAR'.
  //
  // Pages can pass a `blanks` array of codes that should render empty
  // regardless of the map (e.g. picking-page hides SUBMITTED / IN_PROCESS
  // because those lines aren't pickable yet).
  //
  // `lookups` is $application.variables.commonLookups, or undefined. Existing
  // one- and two-arg callers keep working unchanged, resolving at tier 2.
  function formatLineStatus(code, blanks, lookups) {
    if (code === undefined || code === null || code === '') return '';
    if (blanks && blanks.indexOf(code) !== -1) return '';
    var list = lookups && lookups.LINE_STATUS;
    if (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].value === code) return list[i].label;
      }
    }
    if (Object.prototype.hasOwnProperty.call(LINE_STATUS_LABELS, code)) {
      return LINE_STATUS_LABELS[code];
    }
    return String(code).replace(/_/g, ' ').toUpperCase();
  }

  // ── Canonical status → pill colour class ──
  // The colours themselves live in resources/css/app.css as CSS variables;
  // this map only decides which status gets which pill. It is the single
  // source of truth for pill colour across every page, so a given status
  // can never render differently in two places.
  //
  // Statuses that are stages of the same phase intentionally share a pill
  // (e.g. every mid-fulfilment status uses the In Process amber) — that is
  // the agreed palette, which defines eight colours, not one per status.
  var LINE_STATUS_PILL_CLASSES = {
    DRAFT:             'status-pill--draft',
    SUBMITTED:         'status-pill--submitted',
    QUOTE_GENERATED:   'status-pill--quote-generated',
    QUOTE_ACCEPTED:    'status-pill--quote-accepted',

    // Mid-fulfilment: work is underway on the request.
    IN_PROCESS:        'status-pill--in-process',
    UNDER_PROCUREMENT: 'status-pill--in-process',
    ALLOCATED:         'status-pill--in-process',
    SCHEDULED_FOR_PICKING: 'status-pill--in-process',
    PICK_INITIATED:    'status-pill--in-process',
    PICK_RELEASED:     'status-pill--in-process',
    EQP_INSPECTION_COMPLETE: 'status-pill--in-process',
    SHIP_TO_SITE:      'status-pill--in-process',
    SHIPPED:           'status-pill--in-process',
    RETURN_INITIATED:  'status-pill--in-process',
    RETURN_IN_PROCESS: 'status-pill--in-process',
    SHIPPED_TO_YARD:   'status-pill--in-process',

    DEPLOYED:          'status-pill--deployed',

    // Terminal, non-failure.
    CLOSED:            'status-pill--closed',
    RETURNED:          'status-pill--closed',

    REJECTED:          'status-pill--rejected',
    FAILED:            'status-pill--rejected',
    CANCELLED:         'status-pill--rejected',

    // ── Allocation-status vocabulary ──
    // Allocation cells reuse the same pills so a request page never shows
    // two different visual languages side by side.
    PENDING:           'status-pill--submitted',
    UNALLOCATED:       'status-pill--draft',
    PARTIALLY_ALLOCATED: 'status-pill--in-process',

    // ── Invoice / billing vocabulary ──
    OPEN:              'status-pill--submitted',
    SCHEDULED:         'status-pill--quote-generated',
    POSTED:            'status-pill--in-process',
    PAID:              'status-pill--closed',
    OVERDUE:           'status-pill--rejected',
    VOID:              'status-pill--draft',

    // ── Approval vocabulary (timesheets, rental agreements) ──
    APPROVED:          'status-pill--deployed',
    ACTIVE:            'status-pill--deployed',
    EXPIRED:           'status-pill--rejected',
    INACTIVE:          'status-pill--draft'
  };

  // Full class attribute for a status pill: base class + colour modifier.
  // Unknown / empty codes fall back to the neutral Draft pill rather than
  // rendering an unstyled bare span.
  //
  // SCOPE: pills are used for the request HEADER status, the equipment
  // workbench line status, invoice status (customer billing) and timesheet
  // status. The remaining plain-text call sites (request-detail line cells,
  // allocation, rate schedules, rental agreements) still use
  // statusTextClass() below — so a status can render as a pill on one page
  // and as text on another. That split is intentional but NOT self-evident;
  // when adding a status cell, match whichever the surrounding page uses.
  function statusPillClass(code) {
    var key = (code === undefined || code === null) ? '' : String(code).toUpperCase();
    var mod = LINE_STATUS_PILL_CLASSES[key] || 'status-pill--draft';
    return 'status-pill ' + mod;
  }

  // Plain-text status rendering — no pill background, no per-status colour.
  // The class exists only to carry the shared typography (see .status-text in
  // resources/css/app.css) so these cells stay visually consistent without
  // colour-coding. See the SCOPE note on statusPillClass() above for which
  // call sites use this versus a pill.
  //
  // The status code is deliberately ignored: the whole point is that the
  // styling no longer varies by status. Callers may still pass one (page
  // helpers that used to switch on it do) — it has no effect.
  function statusTextClass(_code) {
    return 'status-text';
  }

  return {
    LINE_STATUS_LABELS:      LINE_STATUS_LABELS,
    LINE_STATUS_PILL_CLASSES: LINE_STATUS_PILL_CLASSES,
    formatLineStatus:        formatLineStatus,
    statusPillClass:         statusPillClass,
    statusTextClass:         statusTextClass
  };
});
