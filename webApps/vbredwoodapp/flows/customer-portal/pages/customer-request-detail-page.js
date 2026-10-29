define([
  'ojs/ojdatagridprovider',
  'ojs/ojeventtarget',
  'ojs/ojarraydataprovider'
], function (ojdatagridprovider, ojeventtarget, ArrayDataProvider) {
  'use strict';

  // DemoArrayDataGridProvider — Oracle JET cookbook pattern, mirrors the
  // project-mode equipment-request-detail-page.js implementation.
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
    if (detail.axis === 'row') { this.totals.row = this.totals.row + count; }
    this.dispatchEvent(new ojdatagridprovider.DataGridProviderAddEvent(detail));
  };

  DemoArrayDataGridProvider.prototype.doRemove = function (detail) {
    var count = detail.ranges.reduce(function (acc, obj) { return acc + obj.count; }, 0);
    if (detail.axis === 'row') { this.totals.row = this.totals.row - count; }
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


  // ═══════════════════════════════════════════════════════════════════
  // Page Module — mirrors project-mode equipment-request-detail page,
  // minus the "actions" column (customer view has no per-row drawer).
  // Column 0 = select checkbox, then the data columns.
  // ═══════════════════════════════════════════════════════════════════

  var COLUMN_KEYS = [
    'equipmentName',    // 1 - text
    'equipmentClass',   // 2 - text
    'quantity',         // 3 - number
    'utilizationPct',   // 4 - number
    'lineStatus',       // 5 - status badge
    'startDate',        // 6 - readonly date
    'endDate',          // 7 - readonly date
    'billRate'          // 8 - number
  ];

  var COLUMN_HEADERS = [
    '', 'Equipment Name', 'Class', 'Qty', 'Util %', 'Status', 'Start Date', 'End Date', 'Rate'
  ];

  // Physical column position → cell type. Index 0 is the row-select
  // checkbox; the rest map onto COLUMN_KEYS.
  var COLUMN_TYPES = [
    'select',   // 0: row checkbox
    'readonly', // 1: equipmentName
    'readonly', // 2: equipmentClass
    'readonly', // 3: quantity
    'readonly', // 4: utilizationPct
    'status',   // 5: lineStatus
    'readonly', // 6: startDate
    'readonly', // 7: endDate
    'readonly'  // 8: billRate
  ];

  class PageModule {
    constructor() {
      this._data = [];
      this._allData = [];
      this._rowHeaders = [[]];
      this._columnHeaders = [COLUMN_HEADERS.slice()];
      this._dataGridProvider = null;
      this._selectedRows = new Set();
      this._lineRefs = [];

      this._classLOV = new ArrayDataProvider(
        [{value: 'Light', label: 'Light'}, {value: 'Medium', label: 'Medium'}, {value: 'Heavy', label: 'Heavy'}],
        {keyAttributes: 'value'}
      );
    }

    initGridData(linesData) {
      this._data = [];
      this._allData = [];
      this._rowHeaders = [[]];
      this._selectedRows = new Set();
      this._lineRefs = linesData || [];

      (linesData || []).forEach((item, index) => {
        let row = [{ data: false }]; // col 0 = select checkbox
        COLUMN_KEYS.forEach(key => {
          row.push({ data: item[key] !== undefined && item[key] !== null ? item[key] : '' });
        });
        this._rowHeaders[0].push(index + 1);
        this._data.push(row);
        this._allData.push(row.map(c => ({ data: c.data })));
      });

      this._dataGridProvider = new DemoArrayDataGridProvider(
        { data: this._data, rowHeader: this._rowHeaders, columnHeader: this._columnHeaders },
        {}, {}, {}, {}, {}
      );
      return this._dataGridProvider;
    }

    // ── Selection helpers (same pattern as project module) ────────────
    isRowSelected(rowIndex) {
      return this._selectedRows.has(rowIndex);
    }

    toggleRowSelected(rowIndex, event) {
      if (event.target.checked) this._selectedRows.add(rowIndex);
      else this._selectedRows.delete(rowIndex);
    }

    onRowCheckboxChanged(rowIndex, notify, event) {
      this.toggleRowSelected(rowIndex, event);
      this._refreshGridCells();
      try { if (typeof notify === 'function') notify(event); } catch (e) {}
    }

    onHeaderCheckboxChanged(notify, event) {
      this.toggleAllSelected(event);
      this._refreshGridCells();
      try { if (typeof notify === 'function') notify(event); } catch (e) {}
    }

    isAllSelected() {
      const total = (this._lineRefs || []).length;
      return total > 0 && this._selectedRows.size === total;
    }

    toggleAllSelected(event) {
      const total = (this._lineRefs || []).length;
      if (this._selectedRows.size === total && total > 0) {
        this._selectedRows = new Set();
      } else {
        this._selectedRows = new Set();
        for (let i = 0; i < total; i++) this._selectedRows.add(i);
      }
    }

    // JET data-grid doesn't auto-rebind cell-template :checked on Set
    // mutations — force a provider refresh so every row + header rebinds
    // against the live selection state.
    _refreshGridCells() {
      const p = this._dataGridProvider;
      if (p && typeof p.doRefresh === 'function') {
        try { p.doRefresh(); } catch (e) {}
      }
    }

    getSelectedLines() {
      const refs = this._lineRefs || [];
      return Array.from(this._selectedRows)
        .map(idx => refs[idx])
        .filter(l => l !== undefined && l !== null);
    }

    getAllLines() {
      return (this._lineRefs || []).slice();
    }

    // Read live selection + classify by lineStatus. The chain reads this
    // and writes the result onto $page.variables.selectionState so the
    // per-button :disabled binding can react.
    getSelectionStateRaw() {
      const refs = this._lineRefs || [];
      const indices = Array.from(this._selectedRows);
      const lines = indices.map(i => refs[i]).filter(l => l != null);
      const count = lines.length;
      if (count === 0) {
        return { count: 0, sharedStatus: '', isMixed: false, allDeployed: false, allShipToSite: false };
      }
      const first = (lines[0].lineStatus || '');
      const allSame = lines.every(l => (l.lineStatus || '') === first);
      const allDeployed   = lines.every(l => (l.lineStatus || '') === 'DEPLOYED');
      const allShipToSite = lines.every(l => (l.lineStatus || '') === 'SHIP_TO_SITE');
      // Initiate Return gates on this, not allDeployed: a consumable settles at
      // DELIVERED, so gating on DEPLOYED alone would disable the button for every
      // consumable line even though InitiateReturnChain accepts it. Mirrors the
      // project-mode page. isReturnable is stamped per line by initChain; falls back
      // to the DEPLOYED test when absent so rental behaviour is unchanged.
      const allReturnable = lines.every(l => l.isReturnable != null
        ? l.isReturnable === true
        : (l.lineStatus || '') === 'DEPLOYED');
      return {
        count: count,
        sharedStatus: allSame ? first : '',
        isMixed: !allSame,
        allDeployed: allDeployed,
        allReturnable: allReturnable,
        allShipToSite: allShipToSite
      };
    }

    // Header is "confirmed" once the request is past initial review. This
    // gates whether the per-line action buttons are even visible in the
    // banner. Same vocabulary as project-mode.
    headerIsConfirmed(status) {
      // ALLOWLIST, not a blocklist. The old test was "not DRAFT/SUBMITTED/
      // REJECTED", which also let DECLINED, QUOTE_GENERATED and CLOSED through
      // (see CK_EQR_REQUEST_STATUS for the full vocabulary) — a CLOSED request
      // would still show live per-line action buttons. Only these three states
      // represent a request whose lines can be acted on; anything else, existing
      // or newly added, is excluded by default.
      const ACTIONABLE = ['IN_PROCESS', 'QUOTE_ACCEPTED', 'DEPLOYED'];
      return ACTIONABLE.indexOf((status || '').toUpperCase()) !== -1;
    }

    // ── Grid helpers ─────────────────────────────────────────────────
    getColumnType(columnIndex) {
      return COLUMN_TYPES[columnIndex] || 'readonly';
    }

    getIsEditable(cellContext) {
      // Customer view is read-only; only the row-select checkbox is interactive,
      // and that's handled outside the editable cell path.
      return false;
    }

    getColumnHeaderStyle(headerContext) {
      let baseStyle = 'font-weight: bold; background-color: #f1f5f9; color: #475569; padding: 12px;';
      if (headerContext.index === 0) return baseStyle + 'width: 44px;';   // checkbox
      if (headerContext.index === 1) return baseStyle + 'width: 300px;';  // equipment name
      return baseStyle + 'width: 120px;';
    }

    getHeaderFilterable(headerContext) {
      if (headerContext.index === 0) return 'disable';
      return 'auto';
    }

    getClassLOV() { return this._classLOV; }

    formatDate(value) {
      if (!value) return '';
      const s = String(value).substring(0, 10);
      const parts = s.split('-');
      if (parts.length !== 3) return s;
      const year = parts[0];
      const month = parseInt(parts[1], 10);
      const day = parseInt(parts[2], 10);
      if (isNaN(month) || isNaN(day)) return s;
      return month + '/' + day + '/' + year;
    }
  }

  return PageModule;
});
