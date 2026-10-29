define([
  'ojs/ojdatagridprovider',
  'ojs/ojeventtarget',
  'ojs/ojarraydataprovider'
], function (ojdatagridprovider, ojeventtarget /*, ArrayDataProvider */) {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════
  // DataGridProvider — array-backed, read-only.
  // Mirrors the pattern used in rental-agreement-create-page.js and
  // timesheet-detail-page.js so visual styling stays consistent.
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
    var gridBodyItem = {
      rowExtent: mergeResults.outerExtent,
      columnExtent: mergeResults.innerExtent,
      rowIndex: mergeResults.outerOffset,
      columnIndex: mergeResults.innerOffset,
      metadata: {},
      data: data
    };
    if (itemMetadataCallback) {
      var itemMeta = itemMetadataCallback(gridBodyItem);
      if (itemMeta) Object.assign(gridBodyItem.metadata, itemMeta);
    }
    return gridBodyItem;
  };

  DemoArrayDataGridProvider.prototype._createHeaderItem = function (axis, sortable, filterable, data, mergeResults) {
    return {
      index: mergeResults.innerOffset,
      extent: mergeResults.innerExtent,
      level: this.levels[axis] - mergeResults.outerOffset - mergeResults.outerExtent,
      depth: mergeResults.outerExtent,
      metadata: { sortDirection: null, showRequired: false },
      data: data
    };
  };

  DemoArrayDataGridProvider.prototype._mergeInnerHeaderValid = function (offset) { return offset !== 0; };

  ojeventtarget.EventTargetMixin.applyMixin(DemoArrayDataGridProvider);

  // ───────────────────────────────────────────────────────────────────
  // Column config.
  // Index 0 is the Select checkbox column — its "data" is a placeholder,
  // the cell template renders an <input type="checkbox"> instead of value.
  // ───────────────────────────────────────────────────────────────────
  // Est Cost was rate × MIN_COMMIT_DAYS (the legacy quantity column). Agreement
  // lines no longer carry a quantity, so that product is meaningless here — cost
  // belongs on the downstream request. Column removed (matches create-agreement).
  var COLUMN_KEYS = [
    'select_box',
    'equipment_name',
    'class_name',
    'subClassName',
    'bill_rate',
    'price_uom'
  ];
  var COLUMN_HEADERS = [
    '', 'Equipment', 'Class', 'Subclass', 'Rate', 'UOM'
  ];

  class PageModule {
    constructor() {
      // Per-instance state: which row indices (into the current filtered list)
      // are currently selected via the checkbox column. Indices are reset
      // whenever the filtered list changes (see FilterLinesChain).
      this._selectedRows = new Set();
    }

    formatCurrency(value) {
      if (value == null) return '$0';
      return '$' + Number(value).toLocaleString();
    }

    // Build a fresh DataGridProvider from the current line array.
    // Called by vbEnterChain (initial) and FilterLinesChain (on search change).
    initGridData(linesData) {
      var data = [];
      var rowHeaders = [[]];
      var columnHeaders = [COLUMN_HEADERS];

      (linesData || []).forEach(function (item, index) {
        var row = COLUMN_KEYS.map(function (key) {
          if (key === 'select_box') return { data: '' };
          return { data: item[key] !== undefined && item[key] !== null ? item[key] : '' };
        });
        // Display position (1, 2, 3, ...) — independent of the underlying
        // DB line_number, which can have gaps when lines were deleted.
        rowHeaders[0].push(index + 1);
        data.push(row);
      });

      return new DemoArrayDataGridProvider(
        { data: data, rowHeader: rowHeaders, columnHeader: columnHeaders },
        {}, {}, {}, {}, {}
      );
    }

    getColumnType(columnIndex) {
      if (columnIndex === 0) return 'select';
      return 'readonly';
    }

    getIsEditable(_cellContext) { return false; }

    getColumnHeaderStyle(headerContext) {
      var base = 'font-weight: 600; background-color: #f1f5f9; color: #475569; padding: 12px;';
      var idx = headerContext.index;
      if (idx === 0) return base + 'width: 56px; text-align: center;'; // checkbox col
      if (idx === 1) return base + 'width: 240px;';                     // equipment
      if (idx === 4) return base + 'width: 110px; text-align: right;'; // rate (right-aligned numeric)
      return base + 'width: 140px;';
    }

    // ── Checkbox-column selection state (per-PageModule instance) ────
    isRowSelected(rowIndex) {
      return this._selectedRows.has(rowIndex);
    }

    toggleRowSelected(rowIndex, pageVars, event) {
      if (event && event.target && event.target.checked) {
        this._selectedRows.add(rowIndex);
      } else {
        this._selectedRows.delete(rowIndex);
      }
      if (pageVars) pageVars.selectedCount = this._selectedRows.size;
    }

    clearSelection(pageVars) {
      this._selectedRows = new Set();
      if (pageVars) pageVars.selectedCount = 0;
    }

    // Used by AddToCartChain to look up the actual rows by index.
    getSelectedRowIndices() {
      return Array.from(this._selectedRows);
    }
  }

  return PageModule;
});
