define(['ojs/ojarraydataprovider', 'jspdf'], function (ArrayDataProvider, jspdfModule) {
  'use strict';

  var jsPDF = jspdfModule.jsPDF;

  var RATE_FREQUENCY_LABELS = { DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly' };
  // Rate tier resolved server-side (views/request-detail-lines.rateTier). null =
  // line has no dates / no covering schedule; per backend, treat null as Daily.
  var RATE_TIER_LABELS = { DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly' };

  // Inclusive day count between two YYYY-MM-DD strings (matches the quote math
  // used on the customer quote page: billRate × qty × days).
  function computeDays(startStr, endStr) {
    if (!startStr || !endStr) return 0;
    var s = new Date(startStr);
    var e = new Date(endStr);
    if (isNaN(s) || isNaN(e)) return 0;
    return Math.max(0, Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1);
  }

  // Net Rate = base rate marked up by the per-line margin %; the quote totals
  // bill off the Net Rate. Margin defaults to the BU value on the procurement
  // line and on every line of a project-sourced request, 0 elsewhere (seeded in
  // QuoteInitChain / addLine), but the manager can enter any custom value or 0
  // (no margin) per line in edit mode.
  function recomputeLines(lines) {
    return (Array.isArray(lines) ? lines : []).map(function (l) {
      var qty    = Number(l.quantity) || 0;
      var rate   = Number(l.billRate) || 0;
      var margin = Number(l.marginPercentage) || 0;
      var days   = computeDays(l.startDate, l.endDate);
      var netRate = rate * (1 + margin / 100);
      return Object.assign({}, l, {
        quantity:         qty,
        billRate:         rate,
        marginPercentage: margin,
        netRate:          netRate,
        lineTotal:        netRate * qty * days
      });
    });
  }

  function grandOf(lines) {
    return (Array.isArray(lines) ? lines : [])
      .reduce(function (sum, l) { return sum + (l.lineTotal || 0); }, 0);
  }

  class PageModule {
    constructor() {
      this._rateFrequencyLOV = new ArrayDataProvider([
        { value: 'DAILY',   label: 'Daily' },
        { value: 'WEEKLY',  label: 'Weekly' },
        { value: 'MONTHLY', label: 'Monthly' }
      ], { keyAttributes: 'value' });
    }

    getRateFrequencyLOV() {
      return this._rateFrequencyLOV;
    }

    formatRateFrequency(value) {
      return RATE_FREQUENCY_LABELS[value] || (value || 'Weekly');
    }

    // null / unknown → Daily, per backend guidance (always show a label).
    formatRateTier(value) {
      return RATE_TIER_LABELS[value] || 'Daily';
    }

    // Quote lifecycle = DRAFT → QUOTE_GENERATED (sent) → QUOTE_ACCEPTED.
    // Once a quote has been SENT (or accepted) it is locked: Edit + Send Quote
    // are disabled and the page is view-only. Anything before that (DRAFT /
    // SUBMITTED / etc.) is still editable and sendable.
    isQuoteLocked(status) {
      var s = String(status || '').toUpperCase();
      return s === 'QUOTE_GENERATED' || s === 'QUOTE_ACCEPTED';
    }

    // Display label for the status badge, collapsed to the 3-status quote
    // lifecycle: anything pre-send reads DRAFT.
    formatQuoteStatus(status) {
      var s = String(status || '').toUpperCase();
      if (s === 'QUOTE_ACCEPTED')  return 'QUOTE ACCEPTED';
      if (s === 'QUOTE_GENERATED') return 'QUOTE GENERATED';
      return 'DRAFT';
    }

    // Net Rate = base rate marked up by the line's margin %. Recomputed live in
    // the template so it tracks edits to Rate/Margin before Save.
    formatNetRate(billRate, marginPercentage) {
      var rate = Number(billRate) || 0;
      var net = rate * (1 + (Number(marginPercentage) || 0) / 100);
      return net > 0 ? '$' + net.toFixed(2) + ' / day' : '—';
    }

    // Read-only Markup % label (edit mode uses an input instead). A genuine 0 —
    // markup deliberately removed — renders '0%', not the '—' used for no value,
    // so "no markup configured" stays distinguishable from "markup set to zero".
    formatMarkupPct(marginPercentage) {
      if (marginPercentage === null || marginPercentage === undefined || marginPercentage === '') {
        return '—';
      }
      var n = Number(marginPercentage);
      if (isNaN(n)) return '—';
      return (Math.round(n * 100) / 100) + '%';
    }

    // ── Edit / Save / Cancel ────────────────────────────────────────────
    // Enter edit mode; snapshot quoteData (deep copy) so Cancel can revert.
    enterEdit($page) {
      try {
        $page.variables.quoteSnapshot = JSON.parse(JSON.stringify($page.variables.quoteData || {}));
      } catch (e) {
        $page.variables.quoteSnapshot = {};
      }
      $page.variables.editMode = true;
    }

    // Discard edits — restore the snapshot and leave edit mode.
    cancelEdit($page) {
      try {
        $page.variables.quoteData = JSON.parse(JSON.stringify($page.variables.quoteSnapshot || {}));
      } catch (e) { /* keep current */ }
      $page.variables.editMode = false;
    }

    // Save: recompute per-line totals + grand total from the edited values and
    // re-render. NOTE: in-memory only — there is no quote-persistence endpoint
    // yet, so this does not write to the DB (see the header table QUOTE_* cols).
    saveQuote($page) {
      var q = $page.variables.quoteData || {};
      var lines = recomputeLines(q.lines);
      $page.variables.quoteData = Object.assign({}, q, { lines: lines, grandTotal: grandOf(lines) });
      $page.variables.editMode = false;
    }

    // ── Line-level actions ──────────────────────────────────────────────
    // Reassigning quoteData (fresh object/array) is what forces the
    // oj-bind-for-each list + totals to re-render after each mutation.
    addLine($page) {
      var q = $page.variables.quoteData || {};
      var lines = (Array.isArray(q.lines) ? q.lines : []).slice();
      lines.push({
        lineId: null,
        _selected: false,
        equipmentName: '',
        equipmentClass: '',
        quantity: 1,
        startDate: q.startDate || '',
        endDate: q.endDate || '',
        billRate: 0,
        originalBillRate: 0,
        // New line has no schedule rate — start overridable so the manager can
        // enter one; unchecking Override reverts it to 0.
        _rateOverride: true,
        marginPercentage: 0,
        netRate: 0,
        lineStatus: '',
        rateTier: null,
        rateFrequency: 'WEEKLY',
        lineTotal: 0
      });
      $page.variables.quoteData = Object.assign({}, q, { lines: lines });
    }

    // Bumps a plain numeric page variable so bindings OUTSIDE the
    // oj-bind-for-each (which only re-renders because its own `data`
    // expression directly references $variables.quoteData.lines) have
    // something unambiguous to depend on. Reassigning quoteData alone was
    // NOT enough to refresh the header checkbox's :checked binding in
    // testing — same class of gap as request-detail-page.js's
    // selectionVersion / _v pattern.
    _bumpSelectionVersion($page) {
      $page.variables.selectionVersion = Number($page.variables.selectionVersion || 0) + 1;
    }

    removeLine(index, $page) {
      var q = $page.variables.quoteData || {};
      var lines = (Array.isArray(q.lines) ? q.lines : []).slice();
      lines.splice(Number(index), 1);
      $page.variables.quoteData = Object.assign({}, q, { lines: lines, grandTotal: grandOf(lines) });
      this._bumpSelectionVersion($page);
    }

    toggleLine(index, $page, event) {
      var q = $page.variables.quoteData || {};
      var lines = (Array.isArray(q.lines) ? q.lines : []).slice();
      var i = Number(index);
      if (lines[i]) {
        lines[i] = Object.assign({}, lines[i], {
          _selected: !!(event && event.target && event.target.checked)
        });
      }
      $page.variables.quoteData = Object.assign({}, q, { lines: lines });
      this._bumpSelectionVersion($page);
    }

    // Toggle a line's rate-override checkbox. When turned OFF, restore the
    // baseline (schedule/loaded) rate so an abandoned edit doesn't linger, and
    // recompute that line's netRate/total off the restored rate.
    toggleRateOverride(index, $page, event) {
      var q = $page.variables.quoteData || {};
      var lines = (Array.isArray(q.lines) ? q.lines : []).slice();
      var i = Number(index);
      if (lines[i]) {
        var checked = !!(event && event.target && event.target.checked);
        var updated = Object.assign({}, lines[i], { _rateOverride: checked });
        if (!checked) {
          var base = Number(updated.originalBillRate) || 0;
          var margin = Number(updated.marginPercentage) || 0;
          var days = computeDays(updated.startDate, updated.endDate);
          updated.billRate = base;
          updated.netRate = base * (1 + margin / 100);
          updated.lineTotal = updated.netRate * (Number(updated.quantity) || 0) * days;
        }
        lines[i] = updated;
      }
      $page.variables.quoteData = Object.assign({}, q,
        { lines: lines, grandTotal: grandOf(lines) });
      this._bumpSelectionVersion($page);
    }

    // _v (selectionVersion) is unused inside the body on purpose — it's
    // threaded through purely so the :checked binding registers a
    // dependency on it and re-evaluates every time a selection changes.
    isAllLinesSelected(lines, _v) {
      lines = lines || [];
      return lines.length > 0 && lines.every(function (l) { return !!l._selected; });
    }

    toggleAllLines($page, event) {
      var q = $page.variables.quoteData || {};
      var checked = !!(event && event.target && event.target.checked);
      var lines = (Array.isArray(q.lines) ? q.lines : []).map(function (l) {
        return Object.assign({}, l, { _selected: checked });
      });
      $page.variables.quoteData = Object.assign({}, q, { lines: lines });
      this._bumpSelectionVersion($page);
    }

    removeSelected($page) {
      var q = $page.variables.quoteData || {};
      var lines = (Array.isArray(q.lines) ? q.lines : []).filter(function (l) { return !l._selected; });
      $page.variables.quoteData = Object.assign({}, q, { lines: lines, grandTotal: grandOf(lines) });
      this._bumpSelectionVersion($page);
    }

    // ── Display helpers ─────────────────────────────────────────────────
    formatMoney(n) {
      var v = Number(n) || 0;
      return '$' + v.toLocaleString();
    }

    print() {
      window.print();
    }

    // ── PDF export (Send Quote) ─────────────────────────────────────────
    // Plain text-based layout via jsPDF core only (no autotable plugin, to
    // keep this to a single new dependency) — not a pixel match for the
    // on-screen/print styling, just a readable record of the same data.
    // Returns { base64, fileName, fileSize } for SendQuoteChain to PATCH
    // onto the request header (quoteDocument expects base64 without the
    // "data:...;base64," URI prefix, format:byte per the OpenAPI schema).
    buildQuotePdf($page) {
      var q = ($page.variables.quoteData) || {};
      var lines = Array.isArray(q.lines) ? q.lines : [];
      var doc = new jsPDF();
      var y = 18;

      doc.setFontSize(16);
      doc.text('EquipRite — Equipment Rental Quote', 14, y);
      y += 8;
      doc.setFontSize(10);
      doc.text('Request: ' + (q.requestNumber || ''), 14, y);
      y += 6;
      doc.text('Customer: ' + (q.customerName || '—') + '   Contact: ' + (q.customerContact || '—'), 14, y);
      y += 6;
      doc.text('Start: ' + (q.startDate || '—') + '   End: ' + (q.endDate || '—') + '   Location: ' + (q.location || '—'), 14, y);
      y += 10;

      // Customer-facing PDF: the base rate + margin are internal — only the
      // Net Rate (labeled simply "Rate", what the customer pays) is shown.
      var cols = [14, 70, 108, 128, 165];
      doc.setFontSize(9);
      doc.text('Equipment',   cols[0], y);
      doc.text('Class',       cols[1], y);
      doc.text('Qty',         cols[2], y);
      doc.text('Rate',        cols[3], y);
      doc.text('Bill Freq.',  cols[4], y);
      doc.text('Total',       196, y, { align: 'right' });
      y += 2;
      doc.line(14, y, 196, y);
      y += 6;

      lines.forEach(function (l) {
        if (y > 275) { doc.addPage(); y = 18; }
        var netRate = Number(l.netRate != null ? l.netRate : l.billRate) || 0;
        doc.text(String(l.equipmentName || '—'), cols[0], y, { maxWidth: 52 });
        doc.text(String(l.equipmentClass || '—'), cols[1], y, { maxWidth: 34 });
        doc.text(String(l.quantity != null ? l.quantity : 1), cols[2], y);
        doc.text('$' + netRate.toFixed(2), cols[3], y);
        doc.text(String(RATE_FREQUENCY_LABELS[l.rateFrequency] || 'Weekly'), cols[4], y);
        doc.text('$' + (Number(l.lineTotal) || 0).toLocaleString(), 196, y, { align: 'right' });
        y += 8;
      });

      y += 4;
      doc.line(14, y, 196, y);
      y += 8;
      doc.setFontSize(11);
      doc.text('Grand Total: $' + (Number(q.grandTotal) || 0).toLocaleString(), 196, y, { align: 'right' });

      var dataUri = doc.output('datauristring');
      var base64  = dataUri.substring(dataUri.indexOf(',') + 1);
      var fileName = 'quote-' + (q.requestNumber || 'request') + '.pdf';
      // Approximate decoded byte size from the base64 string length.
      var fileSize = Math.round(base64.length * 0.75);

      return { base64: base64, fileName: fileName, fileSize: fileSize };
    }
  }

  return PageModule;
});
