define([
  'ojs/ojdatagridprovider',
  'ojs/ojeventtarget'
], function (ojdatagridprovider, ojeventtarget) {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────────
  // DemoArrayDataGridProvider — embedded from Oracle JET cookbook
  // ─────────────────────────────────────────────────────────────────────────

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

      var results = {
        databody: databody,
        rowHeader: rowHeader,
        columnHeader: columnHeader,
        rowEndHeader: null,
        columnEndHeader: null,
        columnHeaderLabel: null,
        rowHeaderLabel: null,
        columnEndHeaderLabel: null,
        rowEndHeaderLabel: null
      };

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
        results: results,
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
          var mergeResults = {
            innerOffset: inner,
            outerOffset: outer,
            innerExtent: 1,
            outerExtent: 1
          };
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
    if (axis === 'column') {
      metadata.filter = {};
    }
    return { index: index, extent: extent, level: level, depth: depth, metadata: metadata, data: data };
  };

  DemoArrayDataGridProvider.prototype._mergeInnerHeaderValid = function (offset) {
    return offset !== 0;
  };

  // Apply the EventTargetMixin so dispatchEvent/addEventListener work
  ojeventtarget.EventTargetMixin.applyMixin(DemoArrayDataGridProvider);

  // ─────────────────────────────────────────────────────────────────────────
  // Column definitions
  // ─────────────────────────────────────────────────────────────────────────

  var COLUMN_KEYS = [
    'equipment_name',   // 0
    'qty',              // 1
    'applicable_rate',  // 2
    'rate_period',      // 3
    'reg_hours',        // 4
    'ot_hours',         // 5
    'total_hours',      // 6
    'cost_amount',      // 7
    'bill_amount'       // 8
  ];

  var COLUMN_HEADERS = [
    'Equipment Name', 'QTY', 'Applicable Rate', 'Rate Period',
    'Reg Hours', 'OT Hours', 'Total Hours', 'Cost Amount', 'Bill Amount'
  ];

  var COLUMN_TYPES = [
    'readonly', 'readonly', 'readonly', 'readonly',
    'readonly', 'readonly', 'readonly', 'readonly', 'readonly'
  ];

  // ─────────────────────────────────────────────────────────────────────────
  // VBCS Page Module
  // ─────────────────────────────────────────────────────────────────────────

  var PageModule = function PageModule() {
    this._data = [];
    this._allData = [];
    this._rowHeaders = [[]];
    this._columnOrder = [0, 1, 2, 3, 4, 5, 6, 7];
    this._columnHeaders = [this._columnOrder.map(function (origIdx) { return COLUMN_HEADERS[origIdx]; })];
    this._rowMetaAll = [];
    this._rowMetaFiltered = [];
    this._dataToAllIdx = [];
    this._dataGridProvider = null;

    for (var prop in PageModule.prototype) {
      if (typeof PageModule.prototype[prop] === 'function') {
        this[prop] = PageModule.prototype[prop].bind(this);
      }
    }
  };

  PageModule.prototype._createProvider = function () {
    this._dataGridProvider = new DemoArrayDataGridProvider(
      {
        data: this._data,
        rowHeader: this._rowHeaders,
        columnHeader: this._columnHeaders
      },
      {}, {}, {}, {}, {}
    );
  };

  PageModule.prototype._clearChangeTracking = function () {
    // no-op for read-only page; kept for structural parity
  };

  PageModule.prototype.initProviderFromLinesReadOnly = function (lines) {
    var self = this;

    self._columnOrder = [0, 1, 2, 3, 4, 5, 6, 7];
    self._columnHeaders = [self._columnOrder.map(function (idx) { return COLUMN_HEADERS[idx]; })];

    self._data = [];
    self._allData = [];
    self._rowHeaders = [[]];
    self._rowMetaAll = [];
    self._rowMetaFiltered = [];
    self._dataToAllIdx = [];

    (lines || []).forEach(function (item, index) {
      var displayRow = self._columnOrder.map(function (origIdx) {
        var key = COLUMN_KEYS[origIdx];
        var v = item[key];
        return { data: v !== undefined && v !== null ? v : '' };
      });
      self._rowHeaders[0].push(index + 1);
      self._data.push(displayRow);
      self._allData.push(displayRow.map(function (c) { return { data: c.data }; }));
      self._dataToAllIdx.push(index);
      self._rowMetaAll.push({ time_entry_line_id: null });
    });
    self._rowMetaFiltered = self._rowMetaAll.slice();

    self._createProvider();
    self._clearChangeTracking();
    return self._dataGridProvider;
  };

  PageModule.prototype.getColumnType = function (displayIdx) {
    return 'readonly';
  };

  PageModule.prototype.getIsEditable = function (cellContext) {
    return false;
  };

  PageModule.prototype.getColumnHeaderStyle = function (headerContext) {
    var origIdx = this._columnOrder[headerContext.index];
    var key = COLUMN_KEYS[origIdx];
    if (key === 'equipment_name')  return 'width:200px;';
    if (key === 'qty')             return 'width:70px;';
    if (key === 'applicable_rate') return 'width:140px;';
    if (key === 'rate_period')     return 'width:120px;';
    if (key === 'reg_hours')       return 'width:100px;';
    if (key === 'ot_hours')        return 'width:100px;';
    if (key === 'total_hours')     return 'width:110px;';
    if (key === 'cost_amount')     return 'width:130px;';
    if (key === 'bill_amount')     return 'width:130px;';
    return 'width:140px;';
  };

  PageModule.prototype.getHeaderFilterable = function (headerContext) {
    return 'disable';
  };

  return PageModule;
});
