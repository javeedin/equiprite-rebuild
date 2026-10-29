define([
  'ojs/ojdatagridprovider',
  'ojs/ojeventtarget',
  'ojs/ojarraydataprovider'
], (ojdatagridprovider, ojeventtarget, ArrayDataProvider) => {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════
  // DemoArrayDataGridProvider
  // ═══════════════════════════════════════════════════════════════════
  function DemoArrayDataGridProvider(dataParameters, sortParameters, mergeStrategy, requiredParameters, filterParameters, itemMetadata) {
    this.dataParameters = dataParameters;
    this.sortParameters = sortParameters || {};
    this.mergeStrategy = mergeStrategy || {};
    this.requiredParameters = requiredParameters || {};
    this.filterParameters = filterParameters || {};
    this.itemMetadata = itemMetadata || {};
    this.version = 0;
    this.totals = {};
    this.levels = {};
    this._setTotalCounts();
  }

  DemoArrayDataGridProvider.row = 'row';
  DemoArrayDataGridProvider.rowEnd = 'rowEnd';
  DemoArrayDataGridProvider.column = 'column';
  DemoArrayDataGridProvider.columnEnd = 'columnEnd';
  DemoArrayDataGridProvider.unsorted = 'unsorted';

  DemoArrayDataGridProvider.prototype._setTotalCounts = function () {
    var dp = this.dataParameters;
    this.totals.column = Math.max(
      dp.data && dp.data[0] ? dp.data[0].length : -1,
      dp.columnHeader && dp.columnHeader[0] ? dp.columnHeader[0].length : -1,
      dp.columnEndHeader && dp.columnEndHeader[0] ? dp.columnEndHeader[0].length : -1
    );
    this.totals.row = Math.max(
      dp.data ? dp.data.length : -1,
      dp.rowHeader && dp.rowHeader[0] ? dp.rowHeader[0].length : -1,
      dp.rowEndHeader && dp.rowEndHeader[0] ? dp.rowEndHeader[0].length : -1
    );
    this.levels.row = Math.max(0, dp.rowHeader ? dp.rowHeader.length : 0);
    this.levels.column = Math.max(0, dp.columnHeader ? dp.columnHeader.length : 0);
    this.levels.rowEnd = Math.max(0, dp.rowEndHeader ? dp.rowEndHeader.length : 0);
    this.levels.columnEnd = Math.max(0, dp.columnEndHeader ? dp.columnEndHeader.length : 0);
  };

  DemoArrayDataGridProvider.prototype.fetchByOffset = function (parameters) {
    var self = this;
    return new Promise(function (resolve) {
      var rowOffset = parameters.rowOffset;
      var columnOffset = parameters.columnOffset;
      var rowCount = Math.min(parameters.rowCount, self.totals.row - rowOffset);
      var columnCount = Math.min(parameters.columnCount, self.totals.column - columnOffset);
      var rowDone = rowOffset + rowCount >= self.totals.row;
      var columnDone = columnOffset + columnCount >= self.totals.column;
      var version = self.version;

      var databody = self._getResults(self.dataParameters.data, null, {
        outerOffset: rowOffset, innerOffset: columnOffset, outerCount: rowCount, innerCount: columnCount
      }, function () { return true; }, self._createDataItem.bind(self), self.itemMetadata.databody);

      var rowHeader = self._getResults(self.dataParameters.rowHeader, null, {
        outerOffset: 0, innerOffset: rowOffset, outerCount: self.levels.row, innerCount: rowCount
      }, self._mergeInnerHeaderValid, self._createHeaderItem.bind(self, DemoArrayDataGridProvider.row, false, null));

      var columnHeader = self._getResults(self.dataParameters.columnHeader, null, {
        outerOffset: 0, innerOffset: columnOffset, outerCount: self.levels.column, innerCount: columnCount
      }, self._mergeInnerHeaderValid, self._createHeaderItem.bind(self, DemoArrayDataGridProvider.column, false, null));

      resolve({
        fetchParameters: parameters,
        rowDone: rowDone,
        columnDone: columnDone,
        rowOffset: rowOffset,
        columnOffset: columnOffset,
        rowCount: rowCount,
        columnCount: columnCount,
        totalRowCount: self.totals.row,
        totalColumnCount: self.totals.column,
        results: { databody: databody, rowHeader: rowHeader, columnHeader: columnHeader },
        version: version,
        next: null
      });
    });
  };

  DemoArrayDataGridProvider.prototype.getCapability = function (capabilityName) {
    if (capabilityName === 'version') return 'monotonicallyIncreasing';
    if (capabilityName === 'filter') return { capability: 'filter' };
    return null;
  };

  DemoArrayDataGridProvider.prototype.isEmpty = function () {
    return (this.totals.column <= 0 && this.totals.row <= 0) ? 'yes' : 'no';
  };

  DemoArrayDataGridProvider.prototype.doUpdate = function (detail) {
    this.dispatchEvent(new ojdatagridprovider.DataGridProviderUpdateEvent(detail));
  };

  DemoArrayDataGridProvider.prototype.doAdd = function (detail) {
    var count = detail.ranges.reduce(function (acc, obj) { return acc + obj.count; }, 0);
    if (detail.axis === 'row') {
      this.totals.row = this.totals.row + count;
    }
    this.dispatchEvent(new ojdatagridprovider.DataGridProviderAddEvent(detail));
  };

  DemoArrayDataGridProvider.prototype.doRemove = function (detail) {
    var count = detail.ranges.reduce(function (acc, obj) { return acc + obj.count; }, 0);
    if (detail.axis === 'row') {
      this.totals.row = this.totals.row - count;
    }
    this.dispatchEvent(new ojdatagridprovider.DataGridProviderRemoveEvent(detail));
  };

  DemoArrayDataGridProvider.prototype.doRefresh = function () {
    this.dispatchEvent(new ojdatagridprovider.DataGridProviderRefreshEvent());
  };

  DemoArrayDataGridProvider.prototype._getResults = function (outerValues, mergeDimension, resultsParams, mergeInnerValid, createItem, itemMetadataCallback) {
    var outerOffset = resultsParams.outerOffset;
    var innerOffset = resultsParams.innerOffset;
    var outerCount = resultsParams.outerCount;
    var innerCount = resultsParams.innerCount;
    if (outerValues && outerValues[0] && outerValues[0].length > 0) {
      var results = [];
      for (var outer = outerOffset; outer < outerOffset + outerCount; outer++) {
        var innerValues = outerValues[outer];
        if (!innerValues) continue;
        for (var inner = innerOffset; inner < innerOffset + innerCount; inner++) {
          var data = innerValues[inner];
          var mergeResults = { innerOffset: inner, outerOffset: outer, innerExtent: 1, outerExtent: 1 };
          if (itemMetadataCallback) {
            results.push(createItem(data, mergeResults, itemMetadataCallback));
          } else {
            results.push(createItem(data, mergeResults));
          }
        }
      }
      return results;
    }
    return null;
  };

  DemoArrayDataGridProvider.prototype._createDataItem = function (data, mergeResults, itemMetadataCallback) {
    var metadata = {};
    var gridBodyItem = {
      rowExtent: mergeResults.outerExtent,
      columnExtent: mergeResults.innerExtent,
      rowIndex: mergeResults.outerOffset,
      columnIndex: mergeResults.innerOffset,
      metadata: metadata,
      data: data
    };
    if (itemMetadataCallback) {
      var itemMeta = itemMetadataCallback(gridBodyItem);
      if (itemMeta) Object.assign(gridBodyItem.metadata, itemMeta);
    }
    return gridBodyItem;
  };

  DemoArrayDataGridProvider.prototype._createHeaderItem = function (axis, sortable, filterable, data, mergeResults) {
    var index = mergeResults.innerOffset;
    var level = this.levels[axis] - mergeResults.outerOffset - mergeResults.outerExtent;
    var extent = mergeResults.innerExtent;
    var depth = mergeResults.outerExtent;
    var metadata = { sortDirection: null, showRequired: false };
    if (axis === 'column') metadata.filter = {};
    return { index: index, extent: extent, level: level, depth: depth, metadata: metadata, data: data };
  };

  DemoArrayDataGridProvider.prototype._mergeInnerHeaderValid = function (offset) {
    return offset !== 0;
  };

  ojeventtarget.EventTargetMixin.applyMixin(DemoArrayDataGridProvider);


  // §1 column renames (Sandeep debrief): Period -> "Tier", Cost Rate -> "Rate",
  // Threshold -> "Threshold - Days" (days only), and the Calc Basis column is
  // HIDDEN for the demo (not used in calculation yet). calcBasis is still saved
  // via the Add-Line drawer with a valid value; it is only dropped from the grid
  // display, so column indices shift down by one after 'period'.
  var COLUMN_KEYS = [
    'className',
    'subclassName',
    'equipmentName',
    'rateType',
    'period',
    'calcMethod',
    'threshold',
    'periodAmount',
    'costRate'
  ];

  // "Threshold" not "Threshold - Days": the label wrapped onto two lines and got
  // clipped by the header row, and it was inaccurate anyway — FROM_UNIT is
  // denominated in HOURS on UTILIZED_DURATION/HOURLY lines, not days. The
  // Add-Line drawer still shows the per-line unit, where it can be correct.
  var COLUMN_HEADERS = [
    'Class', 'Subclass', 'Equipment', 'Rate Type', 'Tier', 'Calc Method', 'Threshold',
    'Period Total', 'Rate / Day'
  ];

  var COLUMN_TYPES = [
    'readonly', // className
    'readonly', // subclassName
    'readonly', // equipmentName
    'dropdown', // rateType
    'dropdown', // period (Tier)
    'dropdown', // calcMethod
    'number',   // threshold (Days)
    'number',   // periodAmount (Period Total)
    'number'    // costRate (Rate / Day)
  ];

  // ═══════════════════════════════════════════════════════════════════
  // Period-total authoring
  // ═══════════════════════════════════════════════════════════════════
  // The cost engine bills `qty × days × COST_RATE` and treats PERIOD_TYPE as a
  // label, so "a week of this crane is $7,000" can only be honored by storing
  // the per-day equivalent in COST_RATE. The divisor is therefore how many days
  // are in one period — and that comes from PERIOD_TYPE. A week is 7 days. A
  // month is 30.
  //
  // It used to come from the line's THRESHOLD (FROM_UNIT), on the theory that
  // period length was a per-customer notion. That conflated two unrelated jobs
  // and mispriced every tiered line: FROM_UNIT is the *tier gate* — the duration
  // at which this rate starts applying — not the length of the period. A weekly
  // tier gated at day 5 still sells a 7-day week. Under the old rule a $3,250
  // week resolved to $650/day, so the engine billed 7 × 650 = $4,550 for the
  // week the screen advertised at $3,250.
  //
  // So: FROM_UNIT no longer touches money at all. It only decides which tier
  // applies. PERIOD_TYPE decides what a period costs.
  //
  // The stored PERIOD_DIVISOR is likewise no longer read. It existed to express
  // the one shape the threshold rule could not ("weekly pricing starts at day 4,
  // but a week is still 7 days") — which is now simply the default. No row ever
  // used it as a real override (all 132 held threshold-or-1), and the column is
  // saved as NULL from here on, which restores its original meaning: non-null
  // would mean somebody deliberately overrode the period length.
  var DAYS_PER_PERIOD = {
    HOURLY: 1,      // an hourly line's unit IS the hour — see the caveat below
    DAILY: 1,
    WEEKLY: 7,
    MONTHLY: 30,
    QUARTERLY: 90,
    YEARLY: 365
  };

  var PERIOD_NOUN = {
    HOURLY: 'hour', DAILY: 'day', WEEKLY: 'week',
    MONTHLY: 'month', QUARTERLY: 'quarter', YEARLY: 'year'
  };

  // ── Which periods a line may carry ──────────────────────────────────
  // The divisor above is denominated in DAYS, so a line the engine bills in
  // HOURS cannot use a day-based period. EQR_RESOLVE_RATE step 4 is the
  // authority on which is which:
  //
  //   UTILIZED_DURATION + HOURLY  -> v_unit := 'HOURS'  (sums timesheet hours)
  //   UTILIZED_DURATION + DAILY   -> v_unit := 'DAYS'   (counts worked days)
  //   COMPLETE_PERIOD (any basis) -> v_unit := 'DAYS'   (calendar span; basis ignored)
  //
  // So the two illegal shapes are mirror images of each other:
  //   • an hours-billed line with a day-based period — divides by 7 what the
  //     engine multiplies by ~40;
  //   • a days-billed line labelled HOURLY — a label that can never be true,
  //     since COMPLETE_PERIOD has no notion of an hour.
  var isHourlyBasis = function (calcMethod, calcBasis) {
    return (calcMethod || '').toString().toUpperCase() === 'UTILIZED_DURATION' &&
           (calcBasis  || '').toString().toUpperCase() === 'HOURLY';
  };

  var isPeriodAllowed = function (periodType, calcMethod, calcBasis) {
    var p = (periodType || '').toString().trim().toUpperCase();
    if (!p) return true;                                  // nothing chosen yet
    if (isHourlyBasis(calcMethod, calcBasis)) return p === 'HOURLY';
    // COMPLETE_PERIOD bills whole days and never hours. Deliberately NOT keyed
    // on calcBasis: a COMPLETE_PERIOD line may legitimately carry an HOURLY
    // basis (4 live rows do) because the engine ignores basis there entirely.
    if ((calcMethod || '').toString().toUpperCase() === 'COMPLETE_PERIOD') return p !== 'HOURLY';
    return true;
  };

  // The period a line should fall back to when Method/Basis changes out from
  // under it. Returns the value unchanged when it is still legal, so this is
  // safe to call on every method/basis edit.
  var coercePeriod = function (periodType, calcMethod, calcBasis) {
    if (isPeriodAllowed(periodType, calcMethod, calcBasis)) return periodType;
    return isHourlyBasis(calcMethod, calcBasis) ? 'HOURLY' : 'DAILY';
  };

  // CAVEAT — UTILIZED_DURATION + CALC_BASIS 'HOURLY' lines are denominated in
  // HOURS, so a WEEKLY period on one of those would need ~40, not 7. Two such
  // lines exist and both price at $0. Restricting Period to HOURLY when the
  // basis is HOURLY is the follow-up that closes this; until then the pairing is
  // authorable and would divide by the wrong unit.
  var toNum = function (v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  };

  // 4 dp: COST_RATE is being widened to NUMBER(20,4) precisely so a 7-day week
  // at $1,000 stores 142.8571 and bills exactly $1,000 after the engine's
  // ROUND(..., 2). Rounding to 2 here would put back the $0.02/week error.
  var round4 = function (n) {
    return Math.round((n + Number.EPSILON) * 10000) / 10000;
  };

  // Days in one period of this type. Unknown/blank falls to 1 rather than 0 —
  // an unrecognised period type must never make the total vanish or divide by
  // zero; at 1 the total simply equals the rate, which is the base-tier shape.
  var periodUnits = function (periodType) {
    var key = (periodType || '').toString().trim().toUpperCase();
    return DAYS_PER_PERIOD[key] || 1;
  };

  var deriveRate = function (periodAmount, periodType) {
    var amt = toNum(periodAmount);
    if (amt === null) return null;
    return round4(amt / periodUnits(periodType));
  };

  // The REVERSE direction (rate → total) is rounded to 2 dp, unlike deriveRate.
  //
  // A total is a price someone types, so it is inherently a currency amount; a
  // rate is an internal per-unit quotient that must stay at 4 dp for the
  // engine's ROUND(qty * days * rate, 2) to land exactly. Rounding this
  // direction to 4 dp propagated the quotient's own truncation back into the
  // total: 1000 / 7 = 142.8571, then 142.8571 * 7 = 999.9997. Billing was
  // always correct ($1,000 — the engine rounds at 2 dp), but editing the rate
  // field redisplayed the total as 999.9997, which reads as a bug.
  //
  // 2 dp cannot reintroduce the $0.02/week error that motivated the 4 dp
  // COST_RATE: that error came from storing a rounded RATE and multiplying it
  // out. Here the rate keeps full precision and only the derived total — a
  // display/authoring value — is rounded to the nearest cent.
  var round2 = function (n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  };

  var derivePeriodAmount = function (costRate, periodType) {
    var rate = toNum(costRate);
    if (rate === null) return null;
    return round2(rate * periodUnits(periodType));
  };

  // NOTE: Class -> Subclass -> Equipment ordering deliberately lives in the
  // action chains that build equipmentLines, NOT here. It is applied to the
  // array rather than the grid render because deleteSelectedLines maps a grid
  // row index straight back into that array — the two orders must stay aligned.
  var IDX = {};
  COLUMN_KEYS.forEach(function (k, i) { IDX[k] = i; });

  // Grid dropdown options. Values are the raw enums the DB stores, and they are
  // shown raw in the grid too (the friendly labels live in the Add-Line drawer).
  // These are built here rather than as page variables because the two the cell
  // template used to reference — rateTypeADP / periodADP — were never declared,
  // so those pickers opened empty.
  var DROPDOWN_OPTIONS = {
    // CK_EQR_RATE_PL_RTYPE (BLACKOUT added by V267). Only USAGE is priced by the
    // engine today; the rest are stored but never resolved. A BLACKOUT line prices
    // non-billable days once the engine reads it -- with no line authored those days
    // fall to $0, which is the intended default.
    rateType:   ['USAGE', 'MOBILIZATION', 'RETURN', 'STANDBY', 'BLACKOUT'],
    // CK_EQR_RATE_PL_PTYPE also permits FLAT; the drawer omits it, so we do too
    // rather than offer a value one surface can author and the other can't.
    period:     ['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'],
    // CK_RPL_CALC_METHOD.
    calcMethod: ['COMPLETE_PERIOD', 'UTILIZED_DURATION']
  };

  class PageModule {
    initGridData(linesData) {
      const data = [];
      const rowHeaders = [[]];
      const columnHeaders = [COLUMN_HEADERS];
      const inferred = [];

      (linesData || []).forEach((item, index) => {
        let row = COLUMN_KEYS.map(key => ({ data: item[key] !== undefined && item[key] !== null ? item[key] : '' }));

        // Period Total: lines authored before this feature (and the 73 legacy
        // rows) have no stored periodAmount. Rather than backfill — which would
        // invent an authoring intent nobody expressed — show what the stored
        // rate implies. The cell stays a plain number so it remains editable;
        // the inferred flag drives muted styling instead, and typing over it
        // makes the value real.
        if (row[IDX.periodAmount].data === '') {
          const guess = derivePeriodAmount(item.costRate, item.period);
          row[IDX.periodAmount].data = guess === null ? '' : guess;
          inferred.push(index);
        }

        rowHeaders[0].push(index + 1);
        data.push(row);
      });

      // Held on the instance so the edit handlers can reach them — the same
      // arrangement timesheet-detail-page uses. $functions is a single page-module
      // instance, so this survives between calls.
      this._data = data;
      this._lines = linesData || [];
      this._inferredRows = new Set(inferred);
      this._provider = new DemoArrayDataGridProvider(
        { data: data, rowHeader: rowHeaders, columnHeader: columnHeaders },
        {}, {}, {}, {}, {}
      );
      return this._provider;
    }

    getColumnType(columnIndex) {
      return COLUMN_TYPES[columnIndex] || 'readonly';
    }

    // A Period Total we computed rather than one anybody authored. Rendered
    // muted so the distinction survives without a "≈" prefix, which would have
    // made the cell a string and broken numeric editing.
    isInferredPeriodAmount(rowIndex, columnIndex) {
      return columnIndex === IDX.periodAmount &&
             !!this._inferredRows && this._inferredRows.has(rowIndex);
    }

    getDropdownProviderForCell(columnIndex) {
      const key = COLUMN_KEYS[columnIndex];
      const values = DROPDOWN_OPTIONS[key];
      if (!values) return null;
      // Memoized: handing the editor a new provider on every render churns it.
      this._dropdownProviders = this._dropdownProviders || {};
      if (!this._dropdownProviders[key]) {
        this._dropdownProviders[key] = new ArrayDataProvider(
          values.map(v => ({ value: v, label: v })),
          { keyAttributes: 'value' }
        );
      }
      return this._dropdownProviders[key];
    }

    // ── Period-total derivation, exposed to the drawer + chains ──────────
    // Two-way and last-typed-wins: typing a total fills the rate, and
    // overriding the rate recomputes the total. Changing the PERIOD holds the
    // rate and restates the total (DAILY 695 -> WEEKLY 4,865), because the rate
    // is the figure the engine bills and the one that was actually authored on
    // every legacy line. Changing the THRESHOLD moves nothing — it is the tier
    // gate, not the period length.
    periodUnits(periodType) {
      return periodUnits(periodType);
    }

    // The noun a period reads with, for placeholder text: "Total price for 1
    // week". PERIOD_TYPE is stored as the adjective (WEEKLY), which does not
    // read as a duration. Unknown values fall back to "period" rather than
    // rendering the raw enum.
    periodNoun(periodType) {
      return PERIOD_NOUN[(periodType || '').toString().trim().toUpperCase()] || 'period';
    }

    // Exposed for the drawer's option gating + placeholder.
    isHourlyBasis(calcMethod, calcBasis) {
      return isHourlyBasis(calcMethod, calcBasis);
    }

    isPeriodAllowed(periodType, calcMethod, calcBasis) {
      return isPeriodAllowed(periodType, calcMethod, calcBasis);
    }

    coercePeriod(periodType, calcMethod, calcBasis) {
      return coercePeriod(periodType, calcMethod, calcBasis);
    }

    deriveRate(periodAmount, periodType) {
      return deriveRate(periodAmount, periodType);
    }

    derivePeriodAmount(costRate, periodType) {
      return derivePeriodAmount(costRate, periodType);
    }

    // JET's cell.editable expects the STRINGS 'enable'/'disable' — returning a
    // boolean is why Class/Subclass/Equipment were enterable despite being
    // declared readonly. Keyed on indexes.column (keys.column is not an index
    // on this provider).
    getIsEditable(cellContext) {
      const col = cellContext && cellContext.indexes ? cellContext.indexes.column : null;
      if (col === null || col === undefined) return 'disable';
      return COLUMN_TYPES[col] === 'readonly' ? 'disable' : 'enable';
    }

    // ── Cell editing ────────────────────────────────────────────────────
    // Pattern lifted from timesheet-detail-page (handleBeforeEdit /
    // handleEditEnd + provider.doUpdate), which runs the same
    // DemoArrayDataGridProvider. Before this, edits were written into the
    // throwaway cell objects initGridData builds and were silently dropped on
    // Save, which reads $page.variables.equipmentLines.
    handleBeforeEdit(event) {
      const ctx = event && event.detail && event.detail.cellContext;
      this._originalData = ctx && ctx.data ? Object.assign({}, ctx.data) : null;
    }

    handleEditEnd(event, page) {
      const detail = event && event.detail;
      if (!detail || !detail.cellContext || !detail.cellContext.indexes) return true;

      const rowIndex = detail.cellContext.indexes.row;
      const colIndex = detail.cellContext.indexes.column;
      const key = COLUMN_KEYS[colIndex];
      const cell = this._data && this._data[rowIndex] && this._data[rowIndex][colIndex];
      const line = this._lines && this._lines[rowIndex];

      const revert = () => {
        // Prefer the snapshot, but fall back to the line — otherwise a rejected
        // edit with no snapshot would leave the junk the user typed in the cell.
        if (cell) {
          const restored = this._originalData ? this._originalData.data : (line ? line[key] : '');
          cell.data = (restored === null || restored === undefined) ? '' : restored;
        }
        return false;
      };

      if (detail.cancelEdit) return revert();
      if (!cell || !line || !key) return revert();

      // {{ }} two-way binding keeps this._data[row][col].data current as the
      // user types; event.detail has NOT been updated yet when before-edit-end
      // fires. Reading from event.detail here silently commits the old value.
      let value = cell.data;
      const blank = (value === '' || value === null || value === undefined);

      if (DROPDOWN_OPTIONS[key]) {
        if (DROPDOWN_OPTIONS[key].indexOf(value) < 0) return revert();
        // A Tier the row's own method/basis cannot carry is rejected outright.
        // The drawer greys these out, but the grid's dropdown provider is
        // memoized per COLUMN, not per row, so it cannot vary by line — the
        // check has to live here instead.
        if (key === 'period' && !isPeriodAllowed(value, line.calcMethod, line.calcBasis)) {
          return revert();
        }
      } else if (blank && key === 'periodAmount') {
        // Clearing the total is meaningful — it means "nobody has authored one",
        // which drops the line back to showing an inferred figure. Threshold and
        // rate have no such null state, so a blank there is just a bad edit.
        value = null;
        cell.data = '';
      } else {
        const n = toNum(value);
        if (n === null || n < 0) return revert();
        // FROM_UNIT is a whole day/hour count; the engine compares it against an
        // integer duration, so a fractional threshold could never match exactly.
        value = (key === 'threshold') ? Math.floor(n) : round4(n);
        cell.data = value;
      }

      if (String(this._originalData && this._originalData.data) === String(value)) return true;

      line[key] = value;

      // Keep total and rate consistent. total = rate x days-per-period, so
      // editing either one restates the other, and changing the PERIOD moves the
      // divisor under both. THRESHOLD is deliberately absent from this block —
      // it is the tier gate and no longer participates in the arithmetic.
      const ranges = [{ rowOffset: rowIndex, columnOffset: colIndex, rowCount: 1, columnCount: 1 }];
      // paint touches only the displayed cell; touch also writes the line.
      const paint = (k, v) => {
        this._data[rowIndex][IDX[k]].data = (v === null || v === undefined) ? '' : v;
        ranges.push({ rowOffset: rowIndex, columnOffset: IDX[k], rowCount: 1, columnCount: 1 });
      };
      const touch = (k, v) => { line[k] = v; paint(k, v); };
      // Redraw the inferred total for a line that has no authored one. Needed
      // whenever the period changes, or the displayed figure would keep implying
      // the old period length.
      const repaintInferred = () => {
        this._inferredRows.add(rowIndex);
        paint('periodAmount', derivePeriodAmount(line.costRate, line.period));
      };

      if (key === 'costRate') {
        // Overriding the rate re-states the total rather than leaving the two
        // disagreeing. On a line that had no authored total this promotes the
        // implied figure to a real one — the user set the rate, so its
        // consequence is theirs.
        touch('periodAmount', derivePeriodAmount(value, line.period));
        this._inferredRows.delete(rowIndex);
      } else if (key === 'periodAmount') {
        if (value === null) {
          repaintInferred();               // cleared → back to an implied figure
        } else {
          touch('costRate', deriveRate(value, line.period));
          this._inferredRows.delete(rowIndex);
        }
      } else if (key === 'period') {
        // Retyping the period redefines what one period IS, so one of the pair
        // has to move. The RATE is held and the total restated (DAILY 695 ->
        // WEEKLY 4,865) rather than the reverse: the rate is what the engine
        // bills and what every legacy line actually authored, so holding the
        // total would silently re-price the line instead of relabelling it.
        if (this._inferredRows.has(rowIndex)) {
          repaintInferred();               // never authored → stays implied
        } else {
          touch('periodAmount', derivePeriodAmount(line.costRate, value));
        }
      } else if (key === 'calcMethod') {
        // Changing the method can strand the Tier: COMPLETE_PERIOD cannot carry
        // HOURLY, and UTILIZED_DURATION on an hourly-basis row can carry ONLY
        // hourly. Calc Basis is not a grid column, so the row's stored basis is
        // the only thing that can decide — coerce rather than reject, since the
        // offending cell is not the one being edited and reverting the method
        // would look arbitrary.
        const fixed = coercePeriod(line.period, value, line.calcBasis);
        if (fixed !== line.period) {
          touch('period', fixed);
          if (this._inferredRows.has(rowIndex)) {
            repaintInferred();
          } else {
            touch('periodAmount', derivePeriodAmount(line.costRate, fixed));
          }
        }
      }

      // Hand the page a NEW array reference so VBCS registers the change —
      // saveScheduleChain reads $page.variables.equipmentLines, and relying on
      // in-place mutation being observed is not worth the risk. The grid binds
      // dataGridProvider, not this array, so reassigning costs no re-render.
      if (page && page.variables) {
        page.variables.equipmentLines = this._lines.slice();
        this._lines = page.variables.equipmentLines;
      }

      if (this._provider) this._provider.doUpdate({ ranges: ranges, version: 0 });
      return true;
    }

    getColumnHeaderStyle(_headerContext) {
      let baseStyle = 'font-weight: bold; background-color: #f1f5f9; color: #475569; padding: 12px;';
      return baseStyle + 'width: 140px;';
    }

    deleteSelectedLines(equipmentLines, gridSelection) {
      if (!gridSelection || gridSelection.length === 0) return { updatedLines: equipmentLines, deletedLines: [] };
      
      const rowsToDelete = new Set();
      gridSelection.forEach(range => {
        if (range && range.startIndex && range.startIndex.row !== undefined) {
          const start = range.startIndex.row;
          const end = range.endIndex && range.endIndex.row !== undefined ? range.endIndex.row : start;
          for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
            rowsToDelete.add(i);
          }
        }
      });
      
      const updatedLines = [];
      const deletedLines = [];
      (equipmentLines || []).forEach((line, index) => {
        if (rowsToDelete.has(index)) {
          deletedLines.push(line);
        } else {
          updatedLines.push(line);
        }
      });
      
      return { updatedLines, deletedLines };
    }
  }

  return PageModule;
});
