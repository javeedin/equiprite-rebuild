define([
  'ojs/ojrowdatagridprovider',
  'ojs/ojarraydataprovider'
], function(RowDataGridProvider, ArrayDataProvider) {
  'use strict';

  class PageModule {

    constructor() {
      this._adp = null;
      this._cartItems = [];
      // Ordered databody keys of the grid as currently built. The cell template
      // and columnHeaderStyle resolve a column INDEX back to its key through
      // colKey() rather than hard-coding numbers, because the column set is no
      // longer fixed: HOURS is dropped for customer requests and ORIGIN is
      // appended for agreement ones. With literal indices, dropping HOURS
      // silently shifted START DATE / END DATE / RATE / SUBTOTAL / ORIGIN down
      // one and every renderer and width landed on the wrong column.
      this._databodyKeys = [];

      // columnHeaderStyle is handed to oj-data-grid as a bare function
      // reference (header.column.style="[[ $functions.columnHeaderStyle ]]"),
      // so JET calls it with its own receiver and `this` would be lost. It now
      // reads instance state via colKey(), so bind both here. Without this the
      // widths silently fall through to the default branch.
      this.colKey = this.colKey.bind(this);
      this.columnHeaderStyle = this.columnHeaderStyle.bind(this);
    }

    /**
     * Column index → databody key for the grid as it was last built.
     * Returns '' for an unknown index so a binding just renders nothing rather
     * than throwing. MUST be used by anything that needs to know what a column
     * is; never compare cell.item.columnIndex to a literal.
     */
    colKey(index) {
      return this._databodyKeys[index] || '';
    }

    /**
     * @param {Array}  cartItems
     * @param {Object} activeRequest
     * @param {boolean} isCustomerRequest - true for EXTERNAL/customer-sourced
     *        requests, which have no hours concept: hours is a project-side
     *        timesheet input (it seeds default_hours for timesheet entry) and
     *        the customer create-request form never collects it, so the column
     *        only ever rendered an em-dash there. Passed in because a page
     *        module cannot read $page.variables; callers hand it
     *        $page.variables.isCustomerRequest (set in InitCartChain).
     */
    /**
     * @param {boolean} hideRatesForQuote - true when ENABLE_QUOTES covers this
     *        request's origin. The RATE and SUBTOTAL cells then render
     *        'Rate on request' / '—' instead of amounts: the price is settled on
     *        the quote, and showing a figure here anchors the customer on a
     *        number the quote may not honour. Mirrors the catalog card, so the
     *        two screens never disagree about whether a price is public.
     *        Resolved in InitCartChain, which can reach $application.
     * @param {string} [ppmRateText] - non-empty when Fusion PPM prices rentals
     *        (global flag). Shown as the RATE, SUBTOTAL '—'; wins over the quote.
     */
    initGridData(cartItems, activeRequest, isCustomerRequest, hideRatesForQuote, ppmRateText) {
      var req     = activeRequest || {};
      // Dates are required for every request now (soft reservations included),
      // so always carry the header dates onto the cart lines. The duration /
      // subtotal calc depends on them being present.
      var startDt = req.requestedStartDate || '';
      var endDt   = req.requestedEndDate   || '';
      var hdrHours = (req.hours != null && req.hours !== '') ? Number(req.hours) : null;

      var computeDurationDays = function(start, end) {
        if (!start || !end) return 0;
        var s = new Date(start);
        var e = new Date(end);
        if (isNaN(s.getTime()) || isNaN(e.getTime())) return 0;
        // Inclusive day count
        var diffMs = e.getTime() - s.getTime();
        var days = Math.floor(diffMs / 86400000) + 1;
        return days > 0 ? days : 0;
      };

      var formatRateWithUom = function(amount, uom) {
        var num = Number(amount) || 0;
        var formatted = new Intl.NumberFormat('en-US', {
          style: 'currency', currency: 'USD',
          minimumFractionDigits: 2, maximumFractionDigits: 2
        }).format(num);
        var unit = (uom || '').toString().trim();
        return unit ? (formatted + ' / ' + unit.toUpperCase()) : formatted;
      };

      // RATE cell: period price first, then the per-day rate —
      // "$1,890.00 / WEEK · $270.00 / DAY". Mirrors the catalog card so the
      // number the user saw when adding the item is the number the cart shows.
      //
      // Falls back to the daily rate alone when there is no period to show: a
      // divisor of 1 (base tier) makes the two amounts identical, consumables
      // are priced per unit with no period at all, and agreement-priced lines
      // deliberately carry no periodAmount (see catalogCart.js).
      // PERIOD_TYPE (DAILY|WEEKLY|MONTHLY) → the noun a price reads with
      // (DAY|WEEK|MONTH). periodUom carries the raw periodType, so "$3,200 /
      // WEEKLY" without this. Unrecognised values pass through unchanged.
      var periodNoun = function(periodType) {
        var t = (periodType || '').toString().trim().toUpperCase();
        if (!t) return '';
        var NOUNS = { DAILY: 'DAY', WEEKLY: 'WEEK', MONTHLY: 'MONTH', HOURLY: 'HOUR', YEARLY: 'YEAR' };
        return NOUNS[t] || t;
      };

      var formatRateCell = function(item) {
        // Fusion PPM prices it — no EquipRite figure. See the initGridData jsdoc.
        if (ppmRateText) return ppmRateText;
        // No price at all on a quoted request — see the initGridData jsdoc.
        if (hideRatesForQuote) return 'Rate on request';
        // ONE amount, matching the catalog card: the price as the business
        // quotes it. The derived per-day figure is not shown alongside it —
        // pairing them made every row two numbers to reconcile, and it is the
        // period amount that gets stored on the line as BILL_RATE.
        if (item.periodAmount == null) {
          return formatRateWithUom(item.billingRate, item.billingUnit);
        }
        return formatRateWithUom(item.periodAmount, periodNoun(item.periodUom));
      };

      var formatCurrency = function(amount) {
        return new Intl.NumberFormat('en-US', {
          style: 'currency', currency: 'USD',
          minimumFractionDigits: 2, maximumFractionDigits: 2
        }).format(Number(amount) || 0);
      };

      this._cartItems = (cartItems || []).map(function(item, index) {
        var lineStart = item.startDate || startDt;
        var lineEnd   = item.endDate   || endDt;
        var qty       = Number(item.quantity)    || 0;
        var rate      = Number(item.billingRate) || 0;
        var duration  = computeDurationDays(lineStart, lineEnd);
        // Per-line hours: line value wins; else header default; else blank.
        var lineHours = (item.hours != null && item.hours !== '')
          ? Number(item.hours)
          : hdrHours;
        // Subtotal. CONSUMABLES are priced per unit, so the amount is qty × price
        // and needs NO date range — multiplying by rental days would bill a $5
        // filter as $150 over a 30-day request. RENTABLES are per-day, so the
        // amount is qty × rate × rentalDays and needs a date range: with no dates
        // (e.g. a soft reservation) duration is 0 and we show "—" rather than $0,
        // which would wrongly read as "free".
        var isConsumable = item.isConsumable === true ||
          String(item.billingUnit || '').toUpperCase() === 'EACH';
        var subtotalDisplay;
        if (ppmRateText || hideRatesForQuote) {
          // A subtotal is qty × rate — publishing it would leak the very price
          // the quote is meant to set, so it goes with the rate.
          subtotalDisplay = '—';
        } else if (isConsumable) {
          subtotalDisplay = formatCurrency(qty * rate);
        } else {
          subtotalDisplay = duration > 0 ? formatCurrency(qty * rate * duration) : '—';
        }
        return {
          _rowNum:     index + 1,
          id:          item.id,
          name:        item.name  || '',
          class:       item.class || '',
          quantity:    item.quantity    || 0,
          hours:       isConsumable ? '—' : (lineHours != null ? lineHours : ''),
          billingRate: item.billingRate || 0,
          billingUnit: item.billingUnit || '',
          rateDisplay: formatRateCell(item),
          subtotal:    subtotalDisplay,
          startDate:   lineStart,
          endDate:     lineEnd,
          // Line origin badge text — 'Agreement' for agreement-sourced lines,
          // else 'Catalog'. Survives the agreement filter being removed.
          source:      item.source === 'agreement' ? 'Agreement' : 'Catalog'
        };
      });

      this._adp = new ArrayDataProvider(this._cartItems, { keyAttributes: 'id' });

      // Show the ORIGIN column ONLY for agreement requests — i.e. when at least
      // one line is agreement-sourced. For ordinary catalog requests every line
      // would read 'Catalog', so the column is pure noise and is omitted.
      var hasAgreementLine = this._cartItems.some(function(r) { return r.source === 'Agreement'; });

      // HOURS is project-only. Customer/EXTERNAL requests have no hours input
      // anywhere in their path, so the column rendered an em-dash on every row.
      // Built as a pair of parallel arrays; keep the two in lockstep.
      var showHours = !isCustomerRequest;

      var databody = ['id', 'name', 'class', 'quantity'];
      var headerColumns = [
        { data: '' },
        { data: 'EQUIPMENT NAME' },
        { data: 'CLASS' },
        { data: 'QTY' }
      ];
      if (showHours) {
        databody.push('hours');
        headerColumns.push({ data: 'HOURS' });
      }
      databody.push('startDate', 'endDate', 'rateDisplay', 'subtotal');
      headerColumns.push(
        { data: 'START DATE' },
        { data: 'END DATE' },
        { data: 'RATE' },
        { data: 'SUBTOTAL' }
      );
      if (hasAgreementLine) {
        databody.push('source');
        headerColumns.push({ data: 'ORIGIN' });
      }

      // Record the final order so colKey() can resolve indices for the cell
      // template and the width function.
      this._databodyKeys = databody;

      return new RowDataGridProvider.RowDataGridProvider(this._adp, {
        columns: {
          rowHeader: ['_rowNum'],
          databody:  databody
        },
        columnHeaders: {
          column: headerColumns
        },
        headerLabels: {
          row: ['']
        }
      });
    }

    // Keyed off the column's databody key, not its index — with HOURS optional
    // the index of every column after QTY depends on the request type.
    columnHeaderStyle(headerContext) {
      var key = this.colKey(headerContext.index);
      var base = 'font-weight:600;background:#f1f5f9;color:#374151;font-size:11px;letter-spacing:0.5px;padding:8px 10px;display:flex;align-items:center;';
      if (key === 'id')          return base + 'width:56px;min-width:56px;max-width:56px;justify-content:center;';
      if (key === 'name')        return base + 'width:22%;min-width:140px;justify-content:flex-start;';
      if (key === 'class')       return base + 'width:12%;min-width:100px;justify-content:center;';
      if (key === 'quantity')    return base + 'width:7%;min-width:60px;justify-content:center;';
      if (key === 'hours')       return base + 'width:8%;min-width:70px;justify-content:center;';
      if (key === 'startDate')   return base + 'width:12%;min-width:100px;justify-content:center;';
      if (key === 'endDate')     return base + 'width:12%;min-width:100px;justify-content:center;';
      // Wider than the other money columns: this cell can carry TWO amounts
      // ("$1,890.00 / WEEK · $270.00 / DAY"), which wrapped or clipped at the
      // previous 12% / 110px.
      if (key === 'rateDisplay') return base + 'width:18%;min-width:200px;justify-content:center;';
      if (key === 'subtotal')    return base + 'width:12%;min-width:110px;justify-content:center;';
      if (key === 'source')      return base + 'width:10%;min-width:90px;justify-content:center;';
      return base + 'width:10%;justify-content:center;';
    }

    /**
     * Non-blocking warnings for the Edit Line dates, rendered live under the
     * date inputs. The blocking rules (required, end ≥ start, no new past start)
     * live in CartSaveQtyChain; these only tell the user what the change implies.
     * All dates are 'YYYY-MM-DD' strings, so string comparison orders them.
     */
    lineDateWarnings(start, end, origStart, origEnd, headerStart, headerEnd, isConsumable) {
      var out = [];
      start = (start || '').slice(0, 10);
      end   = (end   || '').slice(0, 10);
      if (!start || !end || end < start) { return out; }
      headerStart = (headerStart || '').slice(0, 10);
      headerEnd   = (headerEnd   || '').slice(0, 10);

      // The catalog checked availability for the window the item was added on.
      if (start !== (origStart || '').slice(0, 10) || end !== (origEnd || '').slice(0, 10)) {
        out.push('Availability was checked for the original dates. The new dates are not re-checked here, so confirm the equipment is free for them.');
      }
      if (headerStart && start < headerStart) {
        out.push('Starts before the request\'s Required From (' + headerStart + '). The request will start on ' + start + '.');
      }
      if (headerEnd && end > headerEnd) {
        out.push('Ends after the request\'s Required To (' + headerEnd + '). The request will run until ' + end + '.');
      }
      var days = Math.floor((new Date(end) - new Date(start)) / 86400000) + 1;
      if (days > 365) {
        out.push('This line runs ' + days + ' days, more than a year. Check the dates.');
      }
      if (isConsumable) {
        out.push('Consumables are priced per unit, so changing the dates does not change the price.');
      }
      return out;
    }

    formatCurrency(value) {
      var num = typeof value === 'string' ? parseFloat(value.replace(/[^0-9.]/g, '')) : Number(value);
      return new Intl.NumberFormat('en-US', {
        style: 'currency', currency: 'USD',
        minimumFractionDigits: 0, maximumFractionDigits: 0
      }).format(isNaN(num) ? 0 : num);
    }
  }

  return PageModule;
});
