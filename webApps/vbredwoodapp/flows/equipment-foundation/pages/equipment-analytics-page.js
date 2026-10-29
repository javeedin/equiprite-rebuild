define([
  'ojs/ojdatagridprovider',
  'ojs/ojeventtarget',
  'resources/js/lineStatusLabels'
], function (ojdatagridprovider, ojeventtarget, lineStatusLabels) {
  'use strict';

  // ══════════════════════════════════════════════════════════
  // DemoArrayDataGridProvider — same pattern as request-detail
  // ══════════════════════════════════════════════════════════
  function DemoArrayDataGridProvider(dataParameters, sortParameters, mergeStrategy, requiredParameters, filterParameters, itemMetadata) {
    this.dataParameters   = dataParameters;
    this.sortParameters   = sortParameters   || {};
    this.mergeStrategy    = mergeStrategy    || {};
    this.requiredParameters = requiredParameters || {};
    this.filterParameters = filterParameters || {};
    this.itemMetadata     = itemMetadata     || {};
    this.version = 0;
    this.totals  = {};
    this.levels  = {};
    this._setTotalCounts();
  }

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
    this.levels.row       = Math.max(0, dp.rowHeader    ? dp.rowHeader.length    : 0);
    this.levels.column    = Math.max(0, dp.columnHeader ? dp.columnHeader.length : 0);
    this.levels.rowEnd    = Math.max(0, dp.rowEndHeader    ? dp.rowEndHeader.length    : 0);
    this.levels.columnEnd = Math.max(0, dp.columnEndHeader ? dp.columnEndHeader.length : 0);
  };

  DemoArrayDataGridProvider.prototype.fetchByOffset = function (parameters) {
    var self = this;
    return new Promise(function (resolve) {
      var rowOffset    = parameters.rowOffset;
      var columnOffset = parameters.columnOffset;
      var rowCount     = Math.min(parameters.rowCount,    self.totals.row    - rowOffset);
      var columnCount  = Math.min(parameters.columnCount, self.totals.column - columnOffset);
      var rowDone      = rowOffset    + rowCount    >= self.totals.row;
      var columnDone   = columnOffset + columnCount >= self.totals.column;
      var version      = self.version;

      var databody = self._getResults(self.dataParameters.data, null,
        { outerOffset: rowOffset, innerOffset: columnOffset, outerCount: rowCount, innerCount: columnCount },
        function () { return true; }, self._createDataItem.bind(self), self.itemMetadata.databody);

      var rowHeader = self._getResults(self.dataParameters.rowHeader, null,
        { outerOffset: 0, innerOffset: rowOffset, outerCount: self.levels.row, innerCount: rowCount },
        self._mergeInnerHeaderValid, self._createHeaderItem.bind(self, 'row', false, null));

      var columnHeader = self._getResults(self.dataParameters.columnHeader, null,
        { outerOffset: 0, innerOffset: columnOffset, outerCount: self.levels.column, innerCount: columnCount },
        self._mergeInnerHeaderValid, self._createHeaderItem.bind(self, 'column', false, null));

      resolve({
        fetchParameters: parameters,
        rowDone: rowDone, columnDone: columnDone,
        rowOffset: rowOffset, columnOffset: columnOffset,
        rowCount: rowCount, columnCount: columnCount,
        totalRowCount: self.totals.row, totalColumnCount: self.totals.column,
        results: { databody: databody, rowHeader: rowHeader, columnHeader: columnHeader },
        version: version, next: null
      });
    });
  };

  DemoArrayDataGridProvider.prototype.getCapability = function (capabilityName) {
    if (capabilityName === 'version') return 'monotonicallyIncreasing';
    if (capabilityName === 'filter')  return { capability: 'filter' };
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
    if (detail.axis === 'row') this.totals.row += count;
    this.dispatchEvent(new ojdatagridprovider.DataGridProviderAddEvent(detail));
  };
  DemoArrayDataGridProvider.prototype.doRemove = function (detail) {
    var count = detail.ranges.reduce(function (acc, obj) { return acc + obj.count; }, 0);
    if (detail.axis === 'row') this.totals.row -= count;
    this.dispatchEvent(new ojdatagridprovider.DataGridProviderRemoveEvent(detail));
  };
  DemoArrayDataGridProvider.prototype.doRefresh = function () {
    this.dispatchEvent(new ojdatagridprovider.DataGridProviderRefreshEvent());
  };

  DemoArrayDataGridProvider.prototype._getResults = function (outerValues, mergeDimension, resultsParams, mergeInnerValid, createItem, itemMetadataCallback) {
    var outerOffset = resultsParams.outerOffset;
    var innerOffset = resultsParams.innerOffset;
    var outerCount  = resultsParams.outerCount;
    var innerCount  = resultsParams.innerCount;
    if (outerValues && outerValues[0] && outerValues[0].length > 0) {
      var results = [];
      for (var outer = outerOffset; outer < outerOffset + outerCount; outer++) {
        var innerValues = outerValues[outer];
        if (!innerValues) continue;
        for (var inner = innerOffset; inner < innerOffset + innerCount; inner++) {
          var data = innerValues[inner];
          var mergeResults = { innerOffset: inner, outerOffset: outer, innerExtent: 1, outerExtent: 1 };
          results.push(itemMetadataCallback ? createItem(data, mergeResults, itemMetadataCallback) : createItem(data, mergeResults));
        }
      }
      return results;
    }
    return null;
  };

  DemoArrayDataGridProvider.prototype._createDataItem = function (data, mergeResults, itemMetadataCallback) {
    var metadata = {};
    var gridBodyItem = {
      rowExtent: mergeResults.outerExtent, columnExtent: mergeResults.innerExtent,
      rowIndex: mergeResults.outerOffset,  columnIndex: mergeResults.innerOffset,
      metadata: metadata, data: data
    };
    if (itemMetadataCallback) {
      var itemMeta = itemMetadataCallback(gridBodyItem);
      if (itemMeta) Object.assign(gridBodyItem.metadata, itemMeta);
    }
    return gridBodyItem;
  };

  DemoArrayDataGridProvider.prototype._createHeaderItem = function (axis, sortable, filterable, data, mergeResults) {
    var index    = mergeResults.innerOffset;
    var level    = this.levels[axis] - mergeResults.outerOffset - mergeResults.outerExtent;
    var extent   = mergeResults.innerExtent;
    var depth    = mergeResults.outerExtent;
    var metadata = { sortDirection: null, showRequired: false };
    if (axis === 'column') metadata.filter = {};
    return { index: index, extent: extent, level: level, depth: depth, metadata: metadata, data: data };
  };

  DemoArrayDataGridProvider.prototype._mergeInnerHeaderValid = function (offset) {
    return offset !== 0;
  };

  ojeventtarget.EventTargetMixin.applyMixin(DemoArrayDataGridProvider);


  // ══════════════════════════════════════════════════════════
  // SDPDataGridProvider
  // Wraps a JET DataProvider (SDP / ListDataProviderView) for
  // use with oj-data-grid.  Column definitions are declared as
  //   [{header, field, width}]
  // and the provider fetches rows on demand from the DP using
  // its fetchByOffset method — no in-memory copy required.
  // ══════════════════════════════════════════════════════════
  function SDPDataGridProvider(dataProvider, columnDefs, filterCriterion) {
    this.dataProvider    = dataProvider;
    this.columnDefs      = columnDefs || [];
    this.filterCriterion = filterCriterion || null;
    this.version         = 0;
    this.totals          = { column: columnDefs.length, row: -1 };
    this.levels          = { row: 0, column: 1, rowEnd: 0, columnEnd: 0 };

    var self = this;
    if (dataProvider && typeof dataProvider.addEventListener === 'function') {
      dataProvider.addEventListener('mutate', function () {
        self.totals.row = -1;
        self.version++;
        self.dispatchEvent(new ojdatagridprovider.DataGridProviderRefreshEvent());
      });
      dataProvider.addEventListener('refresh', function () {
        self.totals.row = -1;
        self.version++;
        self.dispatchEvent(new ojdatagridprovider.DataGridProviderRefreshEvent());
      });
    }
  }

  SDPDataGridProvider.prototype.fetchByOffset = function (parameters) {
    var self      = this;
    var rowOffset = parameters.rowOffset;
    var colOffset = parameters.columnOffset;
    var rowCount  = parameters.rowCount;
    var colCount  = Math.min(parameters.columnCount, self.totals.column - colOffset);
    var version   = self.version;

    var fetchParams = { offset: rowOffset, size: rowCount };
    if (self.filterCriterion) { fetchParams.filterCriterion = self.filterCriterion; }

    return self.dataProvider.fetchByOffset(fetchParams)
      .then(function (result) {
        var items = result.results;   // [{metadata, data}]
        var done  = result.done;
        var total = result.totalSize != null ? result.totalSize : -1;

        if (self.totals.row === -1 && total >= 0) { self.totals.row = total; }
        if (done && self.totals.row === -1)        { self.totals.row = rowOffset + items.length; }

        var columnHeader = self.columnDefs.slice(colOffset, colOffset + colCount).map(function (col, i) {
          return { index: colOffset + i, extent: 1, level: 0, depth: 1,
                   metadata: { sortDirection: null, showRequired: false, filter: {} }, data: col.header };
        });

        var rowHeader = items.map(function (_, i) {
          return { index: rowOffset + i, extent: 1, level: 0, depth: 1,
                   metadata: {}, data: String(rowOffset + i + 1) };
        });

        var databody = [];
        items.forEach(function (item, r) {
          self.columnDefs.slice(colOffset, colOffset + colCount).forEach(function (col, c) {
            var raw = item.data[col.field];
            databody.push({
              rowIndex: rowOffset + r, columnIndex: colOffset + c,
              rowExtent: 1, columnExtent: 1, metadata: {},
              data: { data: raw != null ? String(raw) : '' }
            });
          });
        });

        return {
          fetchParameters: parameters,
          rowDone: done, columnDone: true,
          rowOffset: rowOffset, columnOffset: colOffset,
          rowCount: items.length, columnCount: colCount,
          totalRowCount: self.totals.row, totalColumnCount: self.totals.column,
          results: { databody: databody, rowHeader: rowHeader, columnHeader: columnHeader },
          version: version, next: null
        };
      });
  };

  SDPDataGridProvider.prototype.getCapability = function (capabilityName) {
    if (capabilityName === 'version') return 'monotonicallyIncreasing';
    return null;
  };

  SDPDataGridProvider.prototype.isEmpty = function () {
    if (this.totals.row === 0) return 'yes';
    if (this.totals.row >  0) return 'no';
    return 'unknown';
  };

  ojeventtarget.EventTargetMixin.applyMixin(SDPDataGridProvider);


  // ══════════════════════════════════════════════════════════
  // Column definitions — raw API field names (as returned by
  // the SDP endpoint, before any client-side mapping).
  // ══════════════════════════════════════════════════════════
  // Field names match analyticsData.mapStock output (snake_case)
  var STOCK_COLS = [
    { header: 'Equipment Class',  field: 'equip_class',   width: '130px' },
    { header: 'Equipment Name',   field: 'equip_name',    width: '220px' },
    { header: 'Unit / Serial #',  field: 'unit_number',   width: '160px' },
    { header: 'Unit Type',        field: 'unit_type',     width: '100px' },
    { header: 'Asset #',          field: 'asset_number',  width: '120px' },
    { header: 'Yard',             field: 'yard',          width: '120px' },
    { header: 'Status',           field: 'unit_status',   width: '120px' },
    { header: 'On-Hand Qty',      field: 'onhand_qty',    width: '95px'  },
    { header: 'Current Project',  field: 'project_name',  width: '200px' },
    { header: 'Start',            field: 'start_date',    width: '100px' },
    { header: 'End',              field: 'end_date',      width: '100px' }
  ];

  // Field names match analyticsData.mapPending output (snake_case)
  var PENDING_COLS = [
    { header: 'Req #',            field: 'req_number',       width: '150px' },
    { header: 'Line #',           field: 'line_no',          width: '60px'  },
    { header: 'Equipment Class',  field: 'equipment_class',  width: '130px' },
    { header: 'Equipment Name',   field: 'equipment_name',   width: '200px' },
    { header: 'Qty',              field: 'qty',              width: '55px'  },
    { header: 'Project',          field: 'project_name',     width: '180px' },
    { header: 'Task',             field: 'task_name',        width: '160px' },
    { header: 'Requestor',        field: 'requestor',        width: '140px' },
    { header: 'Start',            field: 'start_date',       width: '100px' },
    { header: 'End',              field: 'end_date',         width: '100px' },
    { header: 'Line Status',      field: 'line_status',      width: '130px' },
    { header: 'Allocated Serial', field: 'allocated_serial', width: '180px' },
    { header: 'Rate',             field: 'bill_rate',        width: '100px' },
    { header: 'Est Cost',         field: 'est_cost',         width: '100px' }
  ];

  // Field names match analyticsData.mapOnhand output (snake_case)
  var ONHAND_COLS = [
    { header: 'Equipment ID',    field: 'equipment_id',    width: '100px' },
    { header: 'Equipment Class', field: 'equipment_class', width: '130px' },
    { header: 'Equipment Name',  field: 'equipment_name',  width: '220px' },
    { header: 'Yard',            field: 'yard',            width: '120px' },
    { header: 'Inventory Item',  field: 'inventory_item',  width: '160px' },
    { header: 'UOM',             field: 'uom',             width: '70px'  },
    { header: 'On-Hand Qty',     field: 'onhand_qty',      width: '100px' }
  ];

  // Maps smart-search criterion attribute names (camelCase from search config)
  // → actual row field names (snake_case from analyticsData map functions).
  var STOCK_FILTER_ALIAS   = { className: 'equip_class',      unitStatus: 'unit_status' };
  var PENDING_FILTER_ALIAS = { className: 'equipment_class',  lineStatus: 'line_status' };
  var ONHAND_FILTER_ALIAS  = { className: 'equipment_class' };

  // ══════════════════════════════════════════════════════════
  // Page Module
  // ══════════════════════════════════════════════════════════
  class PageModule {
    constructor() {
      this._equipMasterGridProvider = null;
      this._equipMasterDataKey      = null;
      this._pendingGridProvider     = null;
      this._pendingDataKey          = null;
      this._onhandGridProvider      = null;
      this._onhandDataKey           = null;
      this._utilizationGridProvider = null;
      this._utilizationDataKey      = null;
      this._utilizationFlatRows     = null;
      this._utilizationAllCols      = null;
    }

    removeNullfromData(data) {
      if (!data) return [];
      return data.filter(function (item) { return item != null; });
    }

    getMonthsData(data, childdata, flag) {
      if (!data) return [];
      var idCounter = 1;

      var formatDate = function (isoDate) {
        var d = new Date(isoDate);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      };

      var utilField = flag === 'hour' ? 'hour_util_percent' : 'day_util_percent';
      var percent   = function (v) { return (v == null ? 0 : v) + '%'; };
      var numberVal = function (v) { return (v == null ? '0' : String(v)); };

      var monthMap = {};

      data.forEach(function (item) {
        var monthKey = item.month_label;
        var bu = item.business_unit;
        if (!monthMap[monthKey]) {
          monthMap[monthKey] = { Component: monthKey, id: idCounter++, children: [] };
        }
        var row = monthMap[monthKey];
        row[bu + ' Equipment Count'] = numberVal(item.total_equipment);
        row[bu + ' Utilized Hours']  = numberVal(item.month_used_hours);
        row[bu + ' Utilized %']      = percent(item[utilField]);
      });

      if (childdata && childdata.length) {
        childdata.forEach(function (c) {
          var parentRow = monthMap[c.month_label];
          if (!parentRow) return;
          var dayLabel = formatDate(c.day_date);
          var bu = c.business_unit;
          var dayRow = parentRow.children.find(function (ch) { return ch.Component === dayLabel; });
          if (!dayRow) {
            dayRow = { id: idCounter++, Component: dayLabel };
            parentRow.children.push(dayRow);
          }
          dayRow[bu + ' Equipment Count'] = numberVal(c.total_equipment);
          dayRow[bu + ' Utilized Hours']  = numberVal(c.total_used_hours);
          dayRow[bu + ' Utilized %']      = percent(c[utilField]);
        });
      }

      Object.values(monthMap).forEach(function (row) {
        row.children.sort(function (a, b) {
          return new Date(a.Component + ' 2026') - new Date(b.Component + ' 2026');
        });
      });

      return Object.values(monthMap);
    }

    getMonthColumns(monthData) {
      var colSet = new Set();
      (monthData || []).forEach(function (row) {
        Object.keys(row).forEach(function (k) {
          if (k !== 'id' && k !== 'children' && k !== 'Component') colSet.add(k);
        });
      });
      return Array.from(colSet);
    }

    /**
     * `filterVersion` is what the other three tab grids already pass
     * ($variables.analyticsFilterVersion) and this one did not. Without it the
     * cache key is row-count + column-names + collapsed-set, so two different
     * date windows spanning the same months across the same yards produce an
     * IDENTICAL key — the stale grid is handed back and the numbers never move.
     * That is invisible until there is a Period control; there is one now.
     */
    getUtilizationGridProvider(monthData, dynamicCols, collapsedMonths, filterVersion) {
      if (!monthData || !monthData.length || !dynamicCols || !dynamicCols.length) {
        return this._utilizationGridProvider;
      }
      var collapsed = collapsedMonths || [];
      var dataKey   = monthData.length + '|' + dynamicCols.join(',') + '|' +
                      collapsed.slice().sort().join(',') + '|v' + (filterVersion || 0);
      if (this._utilizationGridProvider && this._utilizationDataKey === dataKey) {
        return this._utilizationGridProvider;
      }
      this._utilizationDataKey = dataKey;

      var allCols       = ['Component'].concat(dynamicCols);
      var columnHeaders = [allCols];
      var rowHeaders    = [[]];
      var rows          = [];
      var rowNum        = 1;

      monthData.forEach(function (monthRow) {
        var mKey = monthRow.Component;
        rowHeaders[0].push(rowNum++);
        rows.push(allCols.map(function (col) {
          return { data: String(monthRow[col] != null ? monthRow[col] : ''), isMonth: true, monthKey: mKey };
        }));
        if (collapsed.indexOf(mKey) < 0) {
          (monthRow.children || []).forEach(function (dayRow) {
            rowHeaders[0].push(rowNum++);
            rows.push(allCols.map(function (col) {
              return { data: String(dayRow[col] != null ? dayRow[col] : ''), isMonth: false, monthKey: mKey };
            }));
          });
        }
      });

      this._utilizationFlatRows = rows;
      this._utilizationAllCols  = allCols;
      this._utilizationGridProvider = new DemoArrayDataGridProvider(
        { data: rows, rowHeader: rowHeaders, columnHeader: columnHeaders },
        {}, {}, {}, {}, {}
      );
      return this._utilizationGridProvider;
    }

    toggleUtilMonth(currentCollapsed, monthKey) {
      var arr = (currentCollapsed || []).slice();
      var idx = arr.indexOf(monthKey);
      if (idx >= 0) arr.splice(idx, 1); else arr.push(monthKey);
      return arr;
    }

    getUtilizationColumnHeaderStyle(headerContext) {
      var base = 'font-weight: bold; background-color: #f1f5f9; color: #475569; padding: 8px 10px; text-align: left;';
      var idx  = headerContext.index;
      var w;
      if (idx === 0) {
        w = 130;
      } else {
        var pos = (idx - 1) % 3;
        w = pos === 0 ? 250 : pos === 1 ? 220 : 160;
      }
      return base + 'width:' + w + 'px; min-width:' + w + 'px;';
    }

    formatDate(val) {
      if (!val) return '';
      var s = String(val).substring(0, 10);
      var p = s.split('-');
      if (p.length !== 3) return s;
      return parseInt(p[1], 10) + '/' + parseInt(p[2], 10) + '/' + p[0];
    }

    // Apply smart-search filterCriterion against an in-memory array.
    // aliasMap maps criterion attribute names → actual row field names.
    _filterRows(rows, criterion, aliasMap) {
      console.log('[AnalyticsFilter] rows:', rows && rows.length, 'criterion:', JSON.stringify(criterion));
      if (!criterion || !rows || !rows.length) return rows;
      var leaves = [];
      function collect(c) {
        if (!c) return;
        if (c.op === '$and' || c.op === '$or') { (c.criteria || []).forEach(collect); return; }
        leaves.push(c);
      }
      collect(criterion);
      if (!leaves.length) return rows;
      return rows.filter(function (r) {
        return leaves.every(function (leaf) {
          var attr  = leaf.attribute || '';
          var field = (aliasMap && aliasMap[attr]) || attr;
          var val   = String(leaf.value != null ? leaf.value : '').toLowerCase();
          if (!val) return true;
          if (!attr) {
            // text search: scan all field values
            return Object.keys(r).some(function (k) {
              return String(r[k] != null ? r[k] : '').toLowerCase().indexOf(val) >= 0;
            });
          }
          var rowVal = String(r[field] != null ? r[field] : '').toLowerCase();
          if (leaf.op === '$co' || leaf.op === '$sw') return rowVal.indexOf(val) >= 0;
          return rowVal === val;  // $eq and default
        });
      });
    }

    getPendingGridProvider(pendingRows, filterCriterion, filterVersion) {
      var self   = this;
      // Rows arrive already filtered by the server (analyticsData passes the
      // criterion to the active tab's endpoint as scoped params), so no
      // client-side filtering here.
      var source = pendingRows || [];
      var fcKey  = (filterCriterion ? JSON.stringify(filterCriterion) : '') + '|v:' + (filterVersion || 0);
      var dataKey = 'len:' + source.length + '|fc:' + fcKey;
      if (this._pendingGridProvider && this._pendingDataKey === dataKey) return this._pendingGridProvider;
      this._pendingDataKey = dataKey;
      var rowHeaders = [[]];
      var data = source.map(function (item, index) {
        rowHeaders[0].push(index + 1);
        return PENDING_COLS.map(function (col) {
          var raw = item[col.field];
          if (col.field === 'line_status') raw = lineStatusLabels.formatLineStatus(raw);
          if (col.field === 'start_date' || col.field === 'end_date') raw = self.formatDate(raw);
          return { data: raw != null ? String(raw) : '' };
        });
      });
      this._pendingGridProvider = new DemoArrayDataGridProvider(
        { data: data, rowHeader: rowHeaders, columnHeader: [PENDING_COLS.map(function (c) { return c.header; })] },
        {}, {}, {}, {}, {}
      );
      return this._pendingGridProvider;
    }

    getPendingColumnHeaderStyle(headerContext) {
      var base = 'font-weight: bold; background-color: #f1f5f9; color: #475569; padding: 12px;';
      var col  = PENDING_COLS[headerContext.index];
      return base + 'width:' + (col ? col.width : '120px') + ';';
    }

    getOnhandGridProvider(onhandRows, filterCriterion, filterVersion) {
      // Rows arrive already filtered by the server (analyticsData passes the
      // criterion to the active tab's endpoint as scoped params), so no
      // client-side filtering here.
      var source  = onhandRows || [];
      var fcKey   = (filterCriterion ? JSON.stringify(filterCriterion) : '') + '|v:' + (filterVersion || 0);
      var dataKey = 'len:' + source.length + '|fc:' + fcKey;
      if (this._onhandGridProvider && this._onhandDataKey === dataKey) return this._onhandGridProvider;
      this._onhandDataKey = dataKey;
      var rowHeaders = [[]];
      var data = source.map(function (item, index) {
        rowHeaders[0].push(index + 1);
        return ONHAND_COLS.map(function (col) {
          var raw = item[col.field];
          return { data: raw != null ? String(raw) : '' };
        });
      });
      this._onhandGridProvider = new DemoArrayDataGridProvider(
        { data: data, rowHeader: rowHeaders, columnHeader: [ONHAND_COLS.map(function (c) { return c.header; })] },
        {}, {}, {}, {}, {}
      );
      return this._onhandGridProvider;
    }

    getOnhandColumnHeaderStyle(headerContext) {
      var base = 'font-weight: bold; background-color: #f1f5f9; color: #475569; padding: 12px;';
      var col  = ONHAND_COLS[headerContext.index];
      return base + 'width:' + (col ? col.width : '120px') + ';';
    }


    getDonutTooltip(context) {
      return {
        insert: '<div style="padding:4px 8px; font-size:0.8rem;">' +
                '<div><b>Name:</b> ' + context.series + '</div>' +
                '<div><b>Count:</b> ' + context.value + '</div>' +
                '</div>'
      };
    }

    // Export the LIVE rows shown in the active tab, with the current grid
    // columns. `data` = { stock, pending, onhand, util } passed by ButtonActionChain
    // (page-module functions can't read $page.variables). Columns mirror the
    // refactored grids; statuses use the friendly label maps.
    exportCSV(activeTab, data) {
      var self = this;
      data = data || {};
      var headers, rows, filename;

      if (activeTab === 'equipment-master') {
        headers  = ['Equipment Class', 'Equipment Name', 'Unit / Serial #', 'Unit Type', 'Asset #', 'Yard', 'Status', 'On-Hand Qty', 'Current Project', 'Start', 'End'];
        rows     = (data.stock || []).map(function (r) {
          return [r.equip_class, r.equip_name, r.unit_number, r.unit_type, r.asset_number,
                  (r.yard || r.location), r.unit_status, r.onhand_qty, r.project_name,
                  self.formatDate(r.start_date), self.formatDate(r.end_date)];
        });
        filename = 'Equipment_Stock.csv';
      } else if (activeTab === 'equipment-pending') {
        headers  = ['Req #', 'Line #', 'Equipment Class', 'Equipment Name', 'Qty', 'Project', 'Task', 'Requestor', 'Start', 'End', 'Request Line Status', 'Allocated Serial', 'Rate', 'Est Cost'];
        rows     = (data.pending || []).map(function (r) {
          return [r.req_number, r.line_no, r.equipment_class, r.equipment_name, r.qty,
                  r.project_name, r.task_name, r.requestor,
                  self.formatDate(r.start_date), self.formatDate(r.end_date),
                  lineStatusLabels.formatLineStatus(r.line_status),
                  r.allocated_serial, r.bill_rate, r.est_cost];
        });
        filename = 'Equipment_Manager_Pending_Approval.csv';
      } else if (activeTab === 'onhand') {
        headers  = ['Equipment ID', 'Equipment Class', 'Equipment Name', 'Yard', 'Inventory Item', 'UOM', 'On-Hand Qty'];
        rows     = (data.onhand || []).map(function (r) {
          return [r.equipment_id, r.equipment_class, r.equipment_name,
                  (r.yard || r.location), r.inventory_item, r.uom, r.onhand_qty];
        });
        filename = 'Equipment_Onhand_Quantity.csv';
      } else { // equip-utilization — flat per-(yard, day) rows
        headers  = ['Yard', 'Date', 'Month', 'Fleet Size', 'Deployed Units', 'Utilization %', 'Used Hours'];
        rows     = (data.util || []).map(function (r) {
          return [r.yardName, self.formatDate(r.dayDate), r.monthLabel,
                  r.fleetSize, r.deployedUnits, r.utilPercent, r.usedHours];
        });
        filename = 'Equipment_Utilization.csv';
      }

      var escape = function (v) {
        var s = v == null ? '' : String(v);
        if (s.search(/[,"\n\r]/) !== -1) { s = '"' + s.replace(/"/g, '""') + '"'; }
        return s;
      };

      var lines = [headers.map(escape).join(',')];
      rows.forEach(function (row) { lines.push(row.map(escape).join(',')); });

      var blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement('a');
      a.href        = url;
      a.download    = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    getIsEditable(cellContext) {
      return true;
    }

    getHeaderFilterable(headerContext) {
      return 'auto';
    }

    getEquipMasterGridProvider(masterRows, filterCriterion, filterVersion) {
      var self    = this;
      // Rows arrive already filtered by the server (analyticsData passes the
      // criterion to the active tab's endpoint as scoped params), so no
      // client-side filtering here.
      var source  = masterRows || [];
      var fcKey   = (filterCriterion ? JSON.stringify(filterCriterion) : '') + '|v:' + (filterVersion || 0);
      var dataKey = 'len:' + source.length + '|fc:' + fcKey;
      if (this._equipMasterGridProvider && this._equipMasterDataKey === dataKey) return this._equipMasterGridProvider;
      this._equipMasterDataKey = dataKey;
      var rowHeaders = [[]];
      var data = source.map(function (item, index) {
        rowHeaders[0].push(index + 1);
        return STOCK_COLS.map(function (col) {
          var raw = item[col.field];
          if (col.field === 'start_date' || col.field === 'end_date') raw = self.formatDate(raw);
          return { data: raw != null ? String(raw) : '' };
        });
      });
      this._equipMasterGridProvider = new DemoArrayDataGridProvider(
        { data: data, rowHeader: rowHeaders, columnHeader: [STOCK_COLS.map(function (c) { return c.header; })] },
        {}, {}, {}, {}, {}
      );
      return this._equipMasterGridProvider;
    }

    getEquipMasterColumnHeaderStyle(headerContext) {
      var base = 'font-weight: bold; background-color: #f1f5f9; color: #475569; padding: 12px;';
      var col  = STOCK_COLS[headerContext.index];
      return base + 'width:' + (col ? col.width : '120px') + ';';
    }

  }

  return PageModule;
});
