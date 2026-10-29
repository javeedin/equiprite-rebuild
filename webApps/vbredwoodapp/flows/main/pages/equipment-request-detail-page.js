define([
  'ojs/ojdatagridprovider',
  'ojs/ojeventtarget',
  'ojs/ojarraydataprovider',
  'resources/js/lineStatusLabels'
], function (ojdatagridprovider, ojeventtarget, ArrayDataProvider, lineStatusLabels) {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════
  // DemoArrayDataGridProvider — embedded from Oracle JET cookbook
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


  // ═══════════════════════════════════════════════════════════════════
  // Page Module Configuration & Column Maps
  // ═══════════════════════════════════════════════════════════════════

  // Physical column order in the grid (index 0 = leftmost).
  // Actions is at index 0; data columns follow.
  var COLUMN_KEYS = [
    'equipmentName',    // 1 - text
    'equipmentClass',   // 2 - dropdown
    'quantity',         // 3 - number
    'utilizationPct',   // 4 - number
    'lineStatus',       // 5 - dropdown
    'startDate',        // 6 - readonly date
    'endDate',          // 7 - readonly date
    'billRate',         // 8 - number
    'agreementLabel'    // 9 - agreement provenance ("From AGR-xxxx", blank if none)
  ];

  var COLUMN_HEADERS = [
    '', '', 'Equipment Name', 'Class', 'Qty', 'Util %', 'Status', 'Start Date', 'End Date', 'Rate', 'Agreement'
  ];

  // Column types indexed by physical column position (0 = checkbox, 1 = actions)
  var COLUMN_TYPES = [
    'select',   // 0: row checkbox
    'actions',  // 1: row actions menu
    'readonly', // 2: equipmentName
    'readonly', // 3: equipmentClass
    'readonly', // 4: quantity
    'readonly', // 5: utilizationPct
    'status',   // 6: lineStatus
    'readonly', // 7: startDate
    'readonly', // 8: endDate
    'readonly', // 9: billRate
    'readonly'  // 10: agreementLabel
  ];

  class PageModule {
    constructor() {
      this._data = [];
      this._allData = [];
      this._rowHeaders = [[]];
      this._columnHeaders = [COLUMN_HEADERS.slice()];
      this._dataGridProvider = null;
      this._filterTextValue = "";
      this._selectedRows = new Set();

      this._classLOV = new ArrayDataProvider([{value: 'Light', label: 'Light'}, {value: 'Medium', label: 'Medium'}, {value: 'Heavy', label: 'Heavy'}], {keyAttributes: 'value'});
      this._statusLOV = new ArrayDataProvider([{value: 'Draft', label: 'Draft'}, {value: 'Pending', label: 'Pending'}, {value: 'Allocated', label: 'Allocated'}, {value: 'Failed', label: 'Failed'}], {keyAttributes: 'value'});
    }

    initGridData(linesData) {
      this._data = [];
      this._allData = [];
      this._rowHeaders = [[]];
      this._selectedRows = new Set();
      this._lineRefs = linesData || [];

      (linesData || []).forEach((item, index) => {
        // Select checkbox (col 0) + Actions placeholder (col 1), then data columns
        let row = [{ data: false }, { data: '' }];
        COLUMN_KEYS.forEach(key => {
          row.push({ data: item[key] !== undefined && item[key] !== null ? item[key] : '' });
        });
        this._rowHeaders[0].push(index + 1);
        this._data.push(row);
        this._allData.push(row.map(c => ({ data: c.data }))); // Deep copy
      });

      this._dataGridProvider = new DemoArrayDataGridProvider(
        { data: this._data, rowHeader: this._rowHeaders, columnHeader: this._columnHeaders },
        {}, {}, {}, {}, {}
      );
      return this._dataGridProvider;
    }

    isRowSelected(rowIndex) {
      return this._selectedRows.has(rowIndex);
    }

    toggleRowSelected(rowIndex, event) {
      if (event.target.checked) {
        this._selectedRows.add(rowIndex);
      } else {
        this._selectedRows.delete(rowIndex);
      }
    }

    // Wrapper: mutate the selection Set then notify the page listener so
    // $page.variables.selectionState (KO-observable) is recomputed. Bound
    // in HTML as `onRowCheckboxChanged.bind($functions, rowIndex, $listeners.onSelectionChanged)`.
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

    // Header checkbox visual = "ALL rows selected" (not "any"). The previous
    // any-selected semantic made the header look checked on partial state,
    // which read as "everything is selected" and confused the user.
    isAllSelected() {
      const total = (this._lineRefs || []).length;
      return total > 0 && this._selectedRows.size === total;
    }

    // Path A semantics: partial → all, all → none.
    //   none    → click → all selected
    //   partial → click → all selected (NOT clear — user wants to extend)
    //   all     → click → cleared
    // The browser flips the native input first, but we drive state from the
    // post-event Set, not event.target.checked.
    toggleAllSelected(event) {
      const total = (this._lineRefs || []).length;
      if (this._selectedRows.size === total && total > 0) {
        this._selectedRows = new Set();
      } else {
        this._selectedRows = new Set();
        for (let i = 0; i < total; i++) this._selectedRows.add(i);
      }
    }

    // JET data-grid does NOT re-evaluate cell-template :checked bindings on
    // KO observable changes — it only re-renders cells on a provider event.
    // After Set mutations, dispatch refresh so every row checkbox (and the
    // header) re-binds against the live Set. Without this, header
    // select-all repaints the header but leaves stale row visual state.
    _refreshGridCells() {
      const p = this._dataGridProvider;
      if (p && typeof p.doRefresh === 'function') {
        try { p.doRefresh(); } catch (e) {}
      }
    }

    // Chains call $page.functions.getSelectedRowIndices() to read which rows are checked.
    getSelectedRowIndices() {
      return Array.from(this._selectedRows);
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

    // Called by onSelectionChangedChain. Reads the live _selectedRows Set
    // (which is not KO-observable) and returns a plain object the chain
    // writes into $page.variables.selectionState so the HTML can react.
    getSelectionStateRaw() {
      const refs = this._lineRefs || [];
      const indices = Array.from(this._selectedRows);
      const lines = indices.map(i => refs[i]).filter(l => l != null);
      const count = lines.length;
      // Is EVERY line on the request selected? No longer gates Approve — that
      // is now per-line like Reject (confirmRequestChain patches the selected
      // lines and only advances the header once every line is approved or
      // rejected), so both buttons gate on `count` instead. Kept because it
      // still drives the header checkbox's own checked state.
      //
      // Compared against _lineRefs, the same array the checkboxes index into,
      // so "all" means all rows currently in the grid.
      const totalLines  = refs.length;
      const allSelected = totalLines > 0 && count === totalLines;
      if (count === 0) {
        return {
          count: 0, sharedStatus: '', isMixed: false,
          allSelected: false,
          allDeployed: false, allShipToSite: false
        };
      }
      const first = (lines[0].lineStatus || '');
      const allSame = lines.every(l => (l.lineStatus || '') === first);
      // allDeployed / allShipToSite drive per-button enable state:
      // a button enables only when EVERY selected line has the lineStatus
      // that action requires. Mixed selection => all buttons stay disabled.
      const allDeployed   = lines.every(l => (l.lineStatus || '') === 'DEPLOYED');
      const allShipToSite = lines.every(l => (l.lineStatus || '') === 'SHIP_TO_SITE');
      // Initiate Return gates on this rather than on allDeployed, because a
      // consumable settles at DELIVERED and would otherwise disable the button for
      // every consumable line. isReturnable is stamped per line by initChain and
      // mirrors initiateReturnChain's own source-state filter. Falls back to the
      // DEPLOYED test if the field is absent, preserving rental behaviour.
      const allReturnable = lines.every(l => l.isReturnable != null
        ? l.isReturnable === true
        : (l.lineStatus || '') === 'DEPLOYED');
      return {
        count: count,
        sharedStatus: allSame ? first : '',
        isMixed: !allSame,
        allSelected: allSelected,
        allDeployed: allDeployed,
        allReturnable: allReturnable,
        allShipToSite: allShipToSite
      };
    }

    // Header is "confirmed" (request has been submitted into the operations
    // pipeline) when status is IN_PROCESS or any downstream lifecycle state.
    // DRAFT / SUBMITTED / REJECTED return false — the action buttons stay
    // hidden until the manager confirms the request.
    headerIsConfirmed(status) {
      // ALLOWLIST, not a blocklist. The old test was "not DRAFT/SUBMITTED/
      // REJECTED", which also let DECLINED, QUOTE_GENERATED and CLOSED through
      // (see CK_EQR_REQUEST_STATUS for the full vocabulary) — a CLOSED request
      // would still show live per-line action buttons. Only these three states
      // represent a request whose lines can be acted on; anything else, existing
      // or newly added, is excluded by default.
      // Kept identical to the customer-portal page's copy.
      const ACTIONABLE = ['IN_PROCESS', 'QUOTE_ACCEPTED', 'DEPLOYED'];
      return ACTIONABLE.indexOf((status || '').toUpperCase()) !== -1;
    }

    // Grid Helpers
    getColumnType(columnIndex) {
      return COLUMN_TYPES[columnIndex] || 'readonly';
    }

    // True when the line at this row index is at a status where a material issue
    // can still be recorded. Used to gate the per-row Actions button.
    //
    // DELIVERED and CONSUMED (V244) must be included: the consumable lifecycle is
    // SHIP_TO_SITE -> DELIVERED -> CONSUMED, so gating on DEPLOYED alone would take
    // the button away the moment a line advances - i.e. the line would lose the very
    // control that opens the drawer used to advance it. CONSUMED stays eligible
    // because an item can be issued more than once against the same line.
    isLineDeployed(rowIndex) {
      if (rowIndex == null || rowIndex < 0) return false;
      const line = (this._lineRefs || [])[rowIndex];
      if (!line) return false;
      const s = (line.lineStatus || '').toUpperCase();
      return s === 'DEPLOYED' || s === 'DELIVERED' || s === 'CONSUMED';
    }

    getIsEditable(cellContext) {
      if (cellContext.keys.column === 'columnEnd') return false;
      let type = this.getColumnType(cellContext.indexes.column);
      return (type === 'text' || type === 'number' || type === 'dropdown' || type === 'dropdown-person') ? true : false;
    }

    getColumnHeaderStyle(headerContext) {
      let baseStyle = 'font-weight: bold; background-color: #f1f5f9; color: #475569; padding: 12px;';
      if (headerContext.index === 0) { // Checkbox
        return baseStyle + 'width: 44px;';
      }
      if (headerContext.index === 1) { // Actions
        return baseStyle + 'width: 60px;';
      }
      if (headerContext.index === 2) { // Equipment Name
        return baseStyle + 'width: 300px;';
      }
      return baseStyle + 'width: 120px;';
    }

    getHeaderFilterable(headerContext) {
      if (headerContext.index === 0 || headerContext.index === 1) return 'disable';
      return 'auto';
    }

    getClassLOV() { return this._classLOV; }
    getStatusLOV() { return this._statusLOV; }

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
    
    // Status Badge Styling Helper — line-level status renders as plain text;
    // colour pills are reserved for the request header status.
    // See resources/js/lineStatusLabels.js.
    getStatusBadgeClass(status) {
      return lineStatusLabels.statusTextClass(status);
    }

    buildHiddenSet(selectedIndices) {
      if (!selectedIndices || !selectedIndices.length) return null;
      let setData = new Set(selectedIndices);
      return { keys: setData };
    }

    getSelectedRowCount(selection) {
      if (!selection || !Array.isArray(selection)) {
        return 0;
      }
      let selectedRows = new Set();
      let totalRows = this._data ? this._data.length : 0;
      
      for (let i = 0; i < selection.length; i++) {
        let range = selection[i];
        
        // Format 1: Direct row index
        if (range && range.row !== undefined) {
          selectedRows.add(range.row);
          continue;
        }
        
        let rStart = undefined;
        let rEnd = undefined;

        // Extract indices or keys
        if (range && range.startIndex && range.startIndex.row !== undefined) {
          rStart = range.startIndex.row;
          rEnd = range.endIndex.row;
        } else if (range && range.startKey && range.startKey.row !== undefined) {
          rStart = Number(range.startKey.row);
          rEnd = Number(range.endKey.row);
        }

        if (rStart !== undefined && !isNaN(rStart)) {
          // In Oracle JET, -1 means "to the end of the data"
          if (rEnd === -1 || isNaN(rEnd) || rEnd === null) rEnd = totalRows - 1;
          if (rStart === -1 || rStart === null) rStart = totalRows - 1;
          
          let start = Math.min(rStart, rEnd);
          let end = Math.max(rStart, rEnd);
          
          for (let r = start; r <= end; r++) {
            if (r >= 0 && r < totalRows) {
              selectedRows.add(r);
            }
          }
        }
      }
      
      return selectedRows.size;
    }
  }

  return PageModule;
});
