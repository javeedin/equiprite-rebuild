define([
  'ojs/ojdatagridprovider',
  'ojs/ojeventtarget'
], function (ojdatagridprovider, ojeventtarget) {
  'use strict';

  // ══════════════════════════════════════════════════════════════
  // DemoArrayDataGridProvider — shared by both report tabs
  // ══════════════════════════════════════════════════════════════
  function DemoArrayDataGridProvider(dataParameters, sortParameters, mergeStrategy, requiredParameters, filterParameters, itemMetadata) {
    this.dataParameters    = dataParameters;
    this.sortParameters    = sortParameters    || {};
    this.mergeStrategy     = mergeStrategy     || {};
    this.requiredParameters = requiredParameters || {};
    this.filterParameters  = filterParameters  || {};
    this.itemMetadata      = itemMetadata      || {};
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
    this.levels.row       = Math.max(0, dp.rowHeader       ? dp.rowHeader.length       : 0);
    this.levels.column    = Math.max(0, dp.columnHeader    ? dp.columnHeader.length    : 0);
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
      rowIndex:  mergeResults.outerOffset, columnIndex:  mergeResults.innerOffset,
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


  // ══════════════════════════════════════════════════════════════
  // TAB 1 — Equipment History
  // ══════════════════════════════════════════════════════════════
  var EH_COLUMN_HEADERS = [[
    'Equipment Name', 'Equipment No.', 'Serial Number',
    'Start Date', 'End Date', 'Allocation Status', 'Line Status',
    'Project Number', 'Project Name', 'Customer Name'
  ]];

  var EH_COLUMN_WIDTHS = [
    '220px',  // Equipment Name
    '140px',  // Equipment No.
    '200px',  // Serial Number
    '115px',  // Start Date
    '115px',  // End Date
    '160px',  // Allocation Status
    '150px',  // Line Status
    '150px',  // Project Number
    '220px',  // Project Name
    '190px'   // Customer Name
  ];


  // ══════════════════════════════════════════════════════════════
  // Rental Requests Report — one row per request line
  // ══════════════════════════════════════════════════════════════
  // The status dropdowns are driven by the CK enums rather than by
  // filter-options, which only reports statuses currently in the data. A user
  // must be able to filter for a legal-but-unused status (DECLINED today) and
  // get an honest zero rows, instead of the option being missing entirely.
  // Project/Customer/Class stay on filter-options — those values are data, not
  // contract, so enumerating them here would go stale.
  var RR_LINE_STATUS_VALUES = [
    'DRAFT', 'SUBMITTED', 'IN_PROCESS', 'ALLOCATED', 'QUOTE_GENERATED',
    'QUOTE_ACCEPTED', 'UNDER_PROCUREMENT', 'PICK_INITIATED', 'SHIP_TO_SITE',
    'DELIVERED', 'DEPLOYED', 'CONSUMED', 'RETURN_INITIATED',
    'RETURN_IN_PROCESS', 'SHIPPED_TO_YARD', 'CLOSED', 'REJECTED'
  ];
  var RR_REQUEST_STATUS_VALUES = [
    'DRAFT', 'SUBMITTED', 'IN_PROCESS', 'QUOTE_GENERATED', 'QUOTE_ACCEPTED',
    'DEPLOYED', 'CLOSED', 'DECLINED', 'REJECTED'
  ];

  var RR_COLUMN_HEADERS = [[
    'Request No.', 'Project', 'Customer', 'Task', 'Request Status',
    'Internal Customer', 'Requestor', 'Req. Start', 'Req. End', 'Location',
    'Equipment Name', 'Class', 'Qty', 'Line Status', 'Line Start', 'Line End',
    'Rate', 'Purchase Requisition No.', 'Purchase Order No.',
    'Outbound TO No.', 'Inbound TO No.'
  ]];

  var RR_COLUMN_WIDTHS = [
    '170px',  // Request No.
    '200px',  // Project
    '200px',  // Customer
    '180px',  // Task
    '150px',  // Request Status
    '180px',  // Internal Customer
    '160px',  // Requestor
    '110px',  // Req. Start
    '110px',  // Req. End
    '260px',  // Location
    '230px',  // Equipment Name
    '160px',  // Class
    '70px',   // Qty
    '150px',  // Line Status
    '110px',  // Line Start
    '110px',  // Line End
    '110px',  // Rate
    '190px',  // Purchase Requisition No.
    '170px',  // Purchase Order No.
    '150px',  // Outbound TO No.
    '150px'   // Inbound TO No.
  ];

  // ══════════════════════════════════════════════════════════════
  // TAB 2 — Project Cost Detail
  // ══════════════════════════════════════════════════════════════
  var PC_COLUMN_HEADERS = [[
    'Project No.', 'Project Name', 'Request No.', 'Line No.',
    'Equip. No.', 'Equipment Name', 'Equipment Description',
    'Posted Date', 'Posted Status', 'Cost Amount', 'Qty', 'Total Cost'
  ]];

  var PC_COLUMN_WIDTHS = [
    '120px',  // Project No.
    '240px',  // Project Name
    '130px',  // Request No.
    '80px',   // Line No.
    '150px',  // Equip. No.
    '230px',  // Equipment Name
    '300px',  // Equipment Description
    '110px',  // Posted Date
    '120px',  // Posted Status
    '120px',  // Cost Amount
    '60px',   // Qty
    '120px'   // Total Cost
  ];


  // ══════════════════════════════════════════════════════════════
  // TAB 3 — Rate Exceptions
  // ══════════════════════════════════════════════════════════════
  var RE_COLUMN_HEADERS = [[
    'Yard', 'Equipment No.', 'Equipment Name',
    'Class', 'Subclass', 'Exception Reason'
  ]];

  var RE_COLUMN_WIDTHS = [
    '170px',  // Yard
    '150px',  // Equipment No.
    '250px',  // Equipment Name
    '150px',  // Class
    '180px',  // Subclass
    '250px'   // Exception Reason
  ];


  // ══════════════════════════════════════════════════════════════
  // Rate Schedule Report — static data
  // ══════════════════════════════════════════════════════════════

  var RS_COLUMN_HEADERS = [[
    'Schedule #', 'Schedule Name', 'Class', 'Effective From', 'Effective To',
    'Rate Period', 'Rate Type', 'Threshold (Hrs)', 'Rate'
  ]];
  var RS_COLUMN_WIDTHS = [
    '115px',  // Schedule #
    '210px',  // Schedule Name
    '140px',  // Class
    '120px',  // Effective From
    '120px',  // Effective To
    '110px',  // Rate Period
    '120px',  // Rate Type
    '140px',  // Threshold
    '120px'   // Rate
  ];

  var RSE_COLUMN_HEADERS = [[
    'Equipment #', 'Description', 'Class', 'Subclass', 'Yard', 'Gap Start', 'Reason'
  ]];
  var RSE_COLUMN_WIDTHS = [
    '140px',  // Equipment #
    '240px',  // Description
    '140px',  // Class
    '170px',  // Subclass
    '170px',  // Yard
    '115px',  // Gap Start
    '210px'   // Reason
  ];


  // ── Agreement Expiry Report ─────────────────────────────────

  var AE_COLUMN_HEADERS = [[
    'Agreement #', 'Name', 'Type', 'Customer', 'Currency',
    'Eff. From', 'Eff. To', 'Expiry Status', 'Days to Expiry', 'Lines', 'Status',
    'Renewal Action', 'Total Value', 'Active Requests'
  ]];
  var AE_COLUMN_WIDTHS = [
    '150px',  // Agreement #
    '200px',  // Name
    '120px',  // Type
    '180px',  // Customer
    '90px',   // Currency
    '120px',  // Eff. From
    '120px',  // Eff. To
    '130px',  // Expiry Status
    '130px',  // Days to Expiry
    '80px',   // Lines
    '110px',  // Status
    '140px',  // Renewal Action
    '130px',  // Total Value
    '140px'   // Active Requests
  ];


  // ══════════════════════════════════════════════════════════════
  // Smart Search — filter alias maps
  // criterion.attribute (camelCase from search config field) → row field name
  // ══════════════════════════════════════════════════════════════
  var EH_FILTER_ALIAS = {
    equipmentName:    'equipment_name',
    serialNumber:     'serial_number',
    projectName:      'project_name',
    allocationStatus: 'allocation_status',
    lineStatus:       'line_status',
    equipmentClass:   'equipment_class'
  };
  var RR_FILTER_ALIAS = {
    equipmentName:    'equipmentName',
    serialNumber:     'serialNumber',
    projectName:      'projectName',
    allocationStatus: 'requestStatus',
    lineStatus:       'lineStatus',
    equipmentClass:   'equipmentClass'
  };
  var PC_FILTER_ALIAS = {
    equipmentName: 'equip_desc',
    projectName:   'project_name',
    equipmentClass: 'equip_class',
    yard:          'yard'
  };
  var RE_FILTER_ALIAS = {
    equipmentName:  'equip_desc',
    equipmentClass: 'equip_class',
    yard:           'yard'
  };
  var RS_FILTER_ALIAS = {
    equipmentName:  'equip_name',
    equipmentClass: 'equip_class'
  };
  var AE_FILTER_ALIAS = {
    equipmentName: 'agreementName',
    expiryStatus:  'expiryStatus',
    agreementType: 'agreementType'
  };

  // ══════════════════════════════════════════════════════════════
  // Page Module
  // ══════════════════════════════════════════════════════════════
  class PageModule {
    constructor() {
      this._historyGridProvider  = null;
      this._historyDataKey       = null;
      this._projCostGridProvider = null;
      this._projCostDataKey      = null;
      this._rateExcGridProvider  = null;
      this._rateExcDataKey       = null;
      this._rateSchedGridProvider    = null;
      this._rateSchedDataKey         = null;
      this._rateSchedExcGridProvider = null;
      this._rateSchedExcDataKey      = null;
    }

    // ── Shared helpers ───────────────────────────────────────────
    formatDate(val) {
      if (!val) return '';
      var s = String(val).substring(0, 10);
      var p = s.split('-');
      if (p.length !== 3) return s;
      // ISO YYYY-MM-DD: year is 4 digits in p[0]
      if (p[0].length === 4) return p[1] + '/' + p[2] + '/' + p[0];
      // Already MM-DD-YYYY: reformat separators
      return p[0] + '/' + p[1] + '/' + p[2];
    }

    formatCurrency(val) {
      if (val == null || val === '') return '';
      var n = Number(val);
      if (isNaN(n)) return String(val);
      return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    _filterRows(rows, criterion, aliasMap) {
      if (!criterion || !rows || !rows.length) return rows;
      var filters = [];
      if (criterion.op === '$and' && Array.isArray(criterion.criteria)) {
        filters = criterion.criteria;
      } else if (criterion.attribute) {
        filters = [criterion];
      }
      if (!filters.length) return rows;
      return rows.filter(function (row) {
        return filters.every(function (f) {
          var field = (aliasMap && aliasMap[f.attribute]) || f.attribute;
          var val   = row[field];
          var fv    = f.value;
          if (fv === null || fv === undefined || fv === '') return true;
          if (f.op === '$ne') return String(val) !== String(fv);
          if (Array.isArray(fv)) return fv.indexOf(val) !== -1;
          return String(val || '').toLowerCase().indexOf(String(fv).toLowerCase()) !== -1;
        });
      });
    }


    getEquipHistoryGridProvider(historyRows, filterCriterion, filterVersion) {
      var self   = this;
      var raw    = historyRows || [];
      // Rows arrive already filtered by the server (reportsData.loadTab sends the
      // criterion as scoped query params), so no client-side filtering here.
      var source = raw;
      var fcKey  = (filterCriterion ? JSON.stringify(filterCriterion) : '') + '|v:' + (filterVersion || 0);
      var dataKey = 'eh:len:' + source.length + '|fc:' + fcKey;
      if (this._historyGridProvider && this._historyDataKey === dataKey) {
        return this._historyGridProvider;
      }
      this._historyDataKey = dataKey;
      var rowHeaders = [[]];
      var data = source.map(function (item, index) {
        rowHeaders[0].push(index + 1);
        return [
          { data: item.equipment_name    || '' },
          { data: item.equipment_number  || '' },
          { data: item.serial_number     || '' },
          { data: self.formatDate(item.start_date)  },
          { data: self.formatDate(item.end_date)    },
          { data: item.allocation_status || '' },
          { data: item.line_status       || '' },
          { data: item.project_number    || '' },
          { data: item.project_name      || '' },
          { data: item.customer_name     || '' }
        ];
      });
      this._historyGridProvider = new DemoArrayDataGridProvider(
        { data: data, rowHeader: rowHeaders, columnHeader: EH_COLUMN_HEADERS },
        {}, {}, {}, {}, {}
      );
      return this._historyGridProvider;
    }

    getEquipHistoryColumnHeaderStyle(headerContext) {
      var base  = 'font-weight: bold; background-color: #f1f5f9; color: #475569; padding: 12px;';
      var width = EH_COLUMN_WIDTHS[headerContext.index] || '140px';
      return base + 'width:' + width + '; min-width:' + width + ';';
    }

    // ── Rental Requests Report ───────────────────────────────────
    // This tab filters SERVER-side: every filter maps to a query param on
    // views/rental-requests, so there is no client-side filter function and no
    // static fallback. An empty result renders the noData slot.

    // filter-options returns plain string arrays; oj-select-single/many need
    // {label, value} pairs. Underscores become spaces for display while the
    // value keeps the exact enum the API expects.
    toLovOptions(values) {
      return (values || []).map(function (v) {
        return { label: String(v).replace(/_/g, ' '), value: v };
      });
    }

    // Status LOVs come from the published CK enums, in lifecycle order rather
    // than the alphabetical order filter-options returns — a status dropdown
    // reads far better as DRAFT→SUBMITTED→…→CLOSED than ALLOCATED→CLOSED→….
    getRentalReqLineStatusValues()    { return RR_LINE_STATUS_VALUES; }
    getRentalReqRequestStatusValues() { return RR_REQUEST_STATUS_VALUES; }

    // Builds the uriParams for a filtered fetch. Empty filters are OMITTED
    // rather than sent blank — the backend treats a present-but-empty param as
    // a real filter value and would match nothing. Array params (lineStatus,
    // requestStatus) are passed as arrays; VB serialises them as repeated
    // query params, which is the multi-select contract.
    buildRentalReqUriParams(filterQ, filterRequest, filterProject, filterCustomer, filterLineStatus, filterReqStatus, filterClass, filterFrom, filterTo, filterProcurement) {
      var p = { page: 0, size: 10000 };
      var str = function (v) { return v ? String(v).trim() : ''; };
      var day = function (v) { return v ? String(v).substring(0, 10).trim() : ''; };

      // Free-text search spans request number, project, customer, equipment and
      // requestor — one box instead of a field-per-column.
      if (str(filterQ))           p.q              = str(filterQ);
      if (str(filterRequest))     p.requestNumber  = str(filterRequest);
      if (str(filterProject))     p.projectName    = str(filterProject);
      if (str(filterCustomer))    p.customerName   = str(filterCustomer);
      if (str(filterClass))       p.equipmentClass = str(filterClass);
      if (day(filterFrom))        p.dateFrom       = day(filterFrom);
      if (day(filterTo))          p.dateTo         = day(filterTo);
      if (str(filterProcurement)) p.procurement    = str(filterProcurement);

      if (Array.isArray(filterLineStatus) && filterLineStatus.length) {
        p.lineStatus = filterLineStatus.slice();
      }
      if (Array.isArray(filterReqStatus) && filterReqStatus.length) {
        p.requestStatus = filterReqStatus.slice();
      }
      return p;
    }

    // How many of the SIX drawer filters are set. Drives the badge on the "More
    // filters" button so collapsing the drawer never hides active state. The two
    // primary filters (search, line status) are visible anyway, so excluded.
    countRentalReqDrawerFilters(filterProject, filterCustomer, filterReqStatus, filterClass, filterFrom, filterTo, filterProcurement) {
      var n = 0;
      if (filterProject)     n++;
      if (filterCustomer)    n++;
      if (filterClass)       n++;
      if (filterProcurement) n++;
      if (filterFrom)        n++;
      if (filterTo)          n++;
      if (Array.isArray(filterReqStatus) && filterReqStatus.length) n++;
      return n;
    }

    getRentalReqGridProvider(rows, filterCriterion, filterVersion) {
      var self   = this;
      var raw    = rows || [];
      // Rows arrive already filtered by the server (reportsData.loadTab sends the
      // criterion as scoped query params), so no client-side filtering here.
      var source = raw;
      var fcKey  = (filterCriterion ? JSON.stringify(filterCriterion) : '') + '|v:' + (filterVersion || 0);
      var dataKey = 'rr:len:' + source.length + '|fc:' + fcKey;
      if (this._rentalReqGridProvider && this._rentalReqDataKey === dataKey) {
        return this._rentalReqGridProvider;
      }
      this._rentalReqDataKey = dataKey;
      var rowHeaders = [[]];
      var data = source.map(function (item, index) {
        rowHeaders[0].push(index + 1);
        return [
          { data: item.requestNumber    || '' },
          { data: item.projectName      || item.projectNumber || '' },
          { data: item.customerName     || '' },
          { data: item.taskName         || '' },
          { data: item.requestStatus    || '' },
          { data: item.internalCustomer || '' },
          { data: item.requestor        || '' },
          { data: self.formatDate(item.requestStartDate) },
          { data: self.formatDate(item.requestEndDate)   },
          { data: item.location         || '' },
          { data: item.equipmentName    || '' },
          { data: item.equipmentClass   || '' },
          { data: String(item.quantity != null ? item.quantity : '') },
          { data: item.lineStatus       || '' },
          { data: self.formatDate(item.lineStartDate) },
          { data: self.formatDate(item.lineEndDate)   },
          { data: item.rate != null ? self.formatCurrency(item.rate) : '' },
          { data: item.requisitionNumber || '' },
          { data: item.poNumber          || '' },
          { data: item.outboundToNumber  || '' },
          { data: item.inboundToNumber   || '' }
        ];
      });
      this._rentalReqGridProvider = new DemoArrayDataGridProvider(
        { data: data, rowHeader: rowHeaders, columnHeader: RR_COLUMN_HEADERS },
        {}, {}, {}, {}, {}
      );
      return this._rentalReqGridProvider;
    }

    getRentalReqColumnHeaderStyle(headerContext) {
      var base  = 'font-weight: bold; background-color: #f1f5f9; color: #475569; padding: 12px;';
      var width = RR_COLUMN_WIDTHS[headerContext.index] || '140px';
      return base + 'width:' + width + '; min-width:' + width + ';';
    }

    // ── Project Cost Detail ──────────────────────────────────────
    getProjOptions(rows) {
      var source = rows || [];
      var seen = {}, opts = [];
      source.forEach(function (r) {
        if (r.project_number && !seen[r.project_number]) {
          seen[r.project_number] = true;
          opts.push({ label: r.project_number + ' — ' + (r.project_name || ''), value: r.project_number });
        }
      });
      opts.sort(function (a, b) { return a.value.localeCompare(b.value); });
      return opts;
    }

    getReqOptions(rows) {
      var source = rows || [];
      var seen = {}, opts = [];
      source.forEach(function (r) {
        if (r.request_number && !seen[r.request_number]) {
          seen[r.request_number] = true;
          opts.push({ label: r.request_number, value: r.request_number });
        }
      });
      opts.sort(function (a, b) { return a.value.localeCompare(b.value); });
      return opts;
    }

    filterProjCostData(rows, filterProject, filterRequest, filterCostType, filterFrom, filterTo) {
      var source = rows || [];
      var proj  = filterProject  ? String(filterProject).trim().toLowerCase()  : '';
      var req   = filterRequest  ? String(filterRequest).trim().toLowerCase()  : '';
      var type  = filterCostType ? String(filterCostType).trim()               : '';
      var from  = filterFrom     ? String(filterFrom).substring(0, 10).trim()  : '';
      var to    = filterTo       ? String(filterTo).substring(0, 10).trim()    : '';

      function ciHas(haystack, needle) {
        return (haystack || '').toLowerCase().indexOf(needle) !== -1;
      }

      // DEAD PATH — the only caller was the per-tab filter drawer, which is
      // disabled in the markup (oj-bind-if test="false") and whose FilterChain
      // is a no-op stub. Left in place, but note the cost_type / cost_date
      // clauses below read row fields that no longer exist: re-enabling this
      // without rewriting it would filter on undefined. Filtering is server-side
      // now (reportsData.loadTab + reportCriterion).
      return source.filter(function (r) {
        if (proj && !ciHas(r.project_number, proj) && !ciHas(r.project_name, proj)) return false;
        if (req  && !ciHas(r.request_number, req))                                   return false;
        if (type && (r.cost_type || '') !== type)                                    return false;
        if (from && (r.cost_date || '') < from)                                      return false;
        if (to   && (r.cost_date || '') > to)                                        return false;
        return true;
      });
    }

    getProjCostGridProvider(rows, filterCriterion, filterVersion) {
      var self   = this;
      var raw    = rows || [];
      // Rows arrive already filtered by the server (reportsData.loadTab sends the
      // criterion as scoped query params), so no client-side filtering here.
      var source = raw;
      var fcKey  = (filterCriterion ? JSON.stringify(filterCriterion) : '') + '|v:' + (filterVersion || 0);
      var dataKey = 'pc:len:' + source.length + '|fc:' + fcKey;
      if (this._projCostGridProvider && this._projCostDataKey === dataKey) {
        return this._projCostGridProvider;
      }
      this._projCostDataKey = dataKey;
      var rowHeaders = [[]];
      var data = source.map(function (item, index) {
        rowHeaders[0].push(index + 1);
        return [
          { data: item.project_number || '' },
          { data: item.project_name   || '' },
          { data: item.request_number || '' },
          { data: item.line_number    || '' },
          { data: item.equip_number   || '' },
          { data: item.equip_name     || '' },
          { data: item.equip_desc     || '' },
          { data: self.formatDate(item.posted_date) },
          { data: item.posted_status  || '' },
          { data: self.formatCurrency(item.cost_amount) },
          { data: String(item.quantity != null ? item.quantity : '') },
          { data: self.formatCurrency(item.total_cost) }
        ];
      });
      this._projCostGridProvider = new DemoArrayDataGridProvider(
        { data: data, rowHeader: rowHeaders, columnHeader: PC_COLUMN_HEADERS },
        {}, {}, {}, {}, {}
      );
      return this._projCostGridProvider;
    }

    getProjCostColumnHeaderStyle(headerContext) {
      var base  = 'font-weight: bold; background-color: #f1f5f9; color: #475569; padding: 12px;';
      var width = PC_COLUMN_WIDTHS[headerContext.index] || '140px';
      return base + 'width:' + width + '; min-width:' + width + ';';
    }

    // ── Rate Exceptions ──────────────────────────────────────────
    getRateExcYardOptions(rows) {
      var source = rows || [];
      var seen = {}, opts = [];
      source.forEach(function (r) {
        if (r.yard && !seen[r.yard]) {
          seen[r.yard] = true;
          opts.push({ label: r.yard, value: r.yard });
        }
      });
      opts.sort(function (a, b) { return a.label.localeCompare(b.label); });
      return opts;
    }

    getRateExcClassOptions(rows) {
      var source = rows || [];
      var seen = {}, opts = [];
      source.forEach(function (r) {
        if (r.equip_class && !seen[r.equip_class]) {
          seen[r.equip_class] = true;
          opts.push({ label: r.equip_class, value: r.equip_class });
        }
      });
      opts.sort(function (a, b) { return a.label.localeCompare(b.label); });
      return opts;
    }

    filterRateExcData(rows, filterYard, filterClass, filterReason, filterFrom, filterTo) {
      var source = rows || [];
      var yard   = filterYard   ? filterYard.trim()                           : '';
      var cls    = filterClass  ? filterClass.trim()                           : '';
      var reason = filterReason ? filterReason.trim()                          : '';
      var from   = filterFrom   ? String(filterFrom).substring(0, 10).trim()  : '';
      var to     = filterTo     ? String(filterTo).substring(0, 10).trim()    : '';

      // DEAD PATH — the only caller was the per-tab filter drawer, which is
      // disabled in the markup (oj-bind-if test="false") and whose FilterChain
      // is a no-op stub. Left in place, but note the eval_from / eval_to
      // clauses below read row fields that no longer exist: re-enabling this
      // without rewriting it would filter on undefined. Filtering is server-side
      // now (reportsData.loadTab + reportCriterion).
      return source.filter(function (r) {
        if (yard   && (r.yard           || '') !== yard)   return false;
        if (cls    && (r.equip_class    || '') !== cls)    return false;
        if (reason && (r.exception_reason || '') !== reason) return false;
        // date overlap: eval period must overlap with [from, to]
        if (from   && (r.eval_to   || '') < from)          return false;
        if (to     && (r.eval_from || '') > to)            return false;
        return true;
      });
    }

    getRateExcGridProvider(rows, filterCriterion, filterVersion) {
      var self   = this;
      var raw    = rows || [];
      // Rows arrive already filtered by the server (reportsData.loadTab sends the
      // criterion as scoped query params), so no client-side filtering here.
      var source = raw;
      var fcKey  = (filterCriterion ? JSON.stringify(filterCriterion) : '') + '|v:' + (filterVersion || 0);
      var dataKey = 're:len:' + source.length + '|fc:' + fcKey;
      if (this._rateExcGridProvider && this._rateExcDataKey === dataKey) {
        return this._rateExcGridProvider;
      }
      this._rateExcDataKey = dataKey;
      var rowHeaders = [[]];
      var data = source.map(function (item, index) {
        rowHeaders[0].push(index + 1);
        return [
          { data: item.yard             || '' },
          { data: item.equip_number     || '' },
          { data: item.equip_name       || '' },
          { data: item.equip_class      || '' },
          { data: item.subclass         || '' },
          { data: item.exception_reason || '' }
        ];
      });
      this._rateExcGridProvider = new DemoArrayDataGridProvider(
        { data: data, rowHeader: rowHeaders, columnHeader: RE_COLUMN_HEADERS },
        {}, {}, {}, {}, {}
      );
      return this._rateExcGridProvider;
    }

    getRateExcColumnHeaderStyle(headerContext) {
      var base  = 'font-weight: bold; background-color: #f1f5f9; color: #475569; padding: 12px;';
      var width = RE_COLUMN_WIDTHS[headerContext.index] || '140px';
      return base + 'width:' + width + '; min-width:' + width + ';';
    }

    // ── Rate Schedule Report ─────────────────────────────────────
    getGroupedRateSchedData(rows, filterCriterion, filterVersion) {
      var raw    = rows || [];
      // Rows arrive already filtered by the server (reportsData.loadTab sends the
      // criterion as scoped query params), so no client-side filtering here.
      var source = raw;
      var groups = [];
      var groupMap = {};
      source.forEach(function (r) {
        if (!groupMap[r.schedule_id]) {
          groupMap[r.schedule_id] = {
            schedule_id:    r.schedule_id,
            schedule_name:  r.schedule_name,
            equip_class:    r.equip_class,
            effective_from: r.effective_from,
            effective_to:   r.effective_to,
            status:         r.status || 'ACTIVE',
            lines: []
          };
          groups.push(groupMap[r.schedule_id]);
        }
        groupMap[r.schedule_id].lines.push({
          period:         r.period,
          rate_type:      r.rate_type,
          threshold:      r.threshold,
          rate:           r.rate,
          equip_name:     r.equip_name,
          equip_class:    r.equip_class,
          equip_subclass: r.equip_subclass
        });
      });
      return groups;
    }

    getExcReasonStyle(reason) {
      var styles = {
        'Rate Not Defined':              'background:#fee2e2; color:#991b1b;',
        'No Active Rate for Date Range': 'background:#ffedd5; color:#9a3412;',
        'Missing Class Rate':            'background:#fef3c7; color:#92400e;',
        'Missing Subclass Rate':         'background:#fef9c3; color:#713f12;',
        'Missing Yard-Specific Rate':    'background:#ede9fe; color:#5b21b6;'
      };
      var base = 'font-size:0.72rem; font-weight:700; padding:3px 10px; border-radius:20px; display:inline-block; white-space:nowrap;';
      return (styles[reason] || 'background:#f1f5f9; color:#475569;') + base;
    }

    getRateSchedClassOptions(rows) {
      var source = rows || [];
      var seen = {};
      var opts = [{ label: 'All Classes', value: '' }];
      source.forEach(function (r) {
        if (r.equip_class && !seen[r.equip_class]) {
          seen[r.equip_class] = true;
          opts.push({ label: r.equip_class, value: r.equip_class });
        }
      });
      return opts;
    }

    filterRateSchedData(rows, filterClass, filterFrom, filterTo) {
      var source = rows || [];
      return source.filter(function (r) {
        if (filterClass && r.equip_class !== filterClass) return false;
        if (filterFrom && r.effective_to < filterFrom) return false;
        if (filterTo   && r.effective_from > filterTo)  return false;
        return true;
      });
    }

    filterRateSchedExcData(rows, filterClass, filterFrom, filterTo) {
      var source = rows || [];
      return source.filter(function (r) {
        if (filterClass && r.equip_class !== filterClass) return false;
        if (filterTo    && r.gap_from > filterTo) return false;
        return true;
      });
    }

    getRateSchedGridProvider(rows) {
      var self = this;
      var source = rows || [];
      var dataKey = 'rs:len:' + source.length + '|first:' + (source[0] ? source[0].schedule_id + '|' + source[0].period : '');
      if (this._rateSchedGridProvider && this._rateSchedDataKey === dataKey) {
        return this._rateSchedGridProvider;
      }
      this._rateSchedDataKey = dataKey;
      var rowHeaders = [[]];
      var data = source.map(function (item, index) {
        rowHeaders[0].push(index + 1);
        return [
          { data: item.schedule_id    || '' },
          { data: item.schedule_name  || '' },
          { data: item.equip_class    || '' },
          { data: self.formatDate(item.effective_from) },
          { data: self.formatDate(item.effective_to)   },
          { data: item.period         || '' },
          { data: item.rate_type      || '' },
          { data: item.threshold      || '' },
          { data: self.formatCurrency(item.rate) }
        ];
      });
      this._rateSchedGridProvider = new DemoArrayDataGridProvider(
        { data: data, rowHeader: rowHeaders, columnHeader: RS_COLUMN_HEADERS },
        {}, {}, {}, {}, {}
      );
      return this._rateSchedGridProvider;
    }

    getRateSchedExcGridProvider(rows) {
      var self = this;
      var source = rows || [];
      var dataKey = 'rse:len:' + source.length + '|first:' + (source[0] ? source[0].equip_number : '');
      if (this._rateSchedExcGridProvider && this._rateSchedExcDataKey === dataKey) {
        return this._rateSchedExcGridProvider;
      }
      this._rateSchedExcDataKey = dataKey;
      var rowHeaders = [[]];
      var data = source.map(function (item, index) {
        rowHeaders[0].push(index + 1);
        return [
          { data: item.equip_number || '' },
          { data: item.equip_desc   || '' },
          { data: item.equip_class  || '' },
          { data: item.subclass     || '' },
          { data: item.yard         || '' },
          { data: self.formatDate(item.gap_from) },
          { data: item.reason       || '' }
        ];
      });
      this._rateSchedExcGridProvider = new DemoArrayDataGridProvider(
        { data: data, rowHeader: rowHeaders, columnHeader: RSE_COLUMN_HEADERS },
        {}, {}, {}, {}, {}
      );
      return this._rateSchedExcGridProvider;
    }

    getRateSchedColumnHeaderStyle(headerContext) {
      var base  = 'font-weight: bold; background-color: #f1f5f9; color: #475569; padding: 12px;';
      var width = RS_COLUMN_WIDTHS[headerContext.index] || '140px';
      return base + 'width:' + width + '; min-width:' + width + ';';
    }

    getRateSchedExcColumnHeaderStyle(headerContext) {
      var base  = 'font-weight: bold; background-color: #f1f5f9; color: #475569; padding: 12px;';
      var width = RSE_COLUMN_WIDTHS[headerContext.index] || '140px';
      return base + 'width:' + width + '; min-width:' + width + ';';
    }

    // ── Agreement Expiry Report ──────────────────────────────────
    getAgreementExpiryStatusOptions(rows) {
      var source = rows || [];
      var seen = {};
      var opts = [];
      source.forEach(function (r) {
        if (r.expiryStatus && !seen[r.expiryStatus]) {
          seen[r.expiryStatus] = true;
          opts.push({ label: r.expiryStatus, value: r.expiryStatus });
        }
      });
      return opts;
    }

    getAgreementExpiryTypeOptions(rows) {
      var source = rows || [];
      var seen = {};
      var opts = [];
      source.forEach(function (r) {
        if (r.agreementType && !seen[r.agreementType]) {
          seen[r.agreementType] = true;
          opts.push({ label: r.agreementType, value: r.agreementType });
        }
      });
      return opts;
    }

    filterAgreementExpiryData(rows, filterStatus, filterType) {
      var source = rows || [];
      var statuses = Array.isArray(filterStatus) ? filterStatus : [];
      var types    = Array.isArray(filterType)   ? filterType   : [];
      return source.filter(function (r) {
        if (statuses.length > 0 && statuses.indexOf(r.expiryStatus)  === -1) return false;
        if (types.length    > 0 && types.indexOf(r.agreementType)    === -1) return false;
        return true;
      });
    }

    getAgreementExpiryGridProvider(rows, filterCriterion, filterVersion) {
      var self   = this;
      var raw    = rows || [];
      // Rows arrive already filtered by the server (reportsData.loadTab sends the
      // criterion as scoped query params), so no client-side filtering here.
      var source = raw;
      var fcKey  = (filterCriterion ? JSON.stringify(filterCriterion) : '') + '|v:' + (filterVersion || 0);
      var dataKey = 'ae:len:' + source.length + '|fc:' + fcKey;
      if (this._aeGridProvider && this._aeDataKey === dataKey) {
        return this._aeGridProvider;
      }
      this._aeDataKey = dataKey;
      var rowHeaders = [[]];
      var data = source.map(function (item, index) {
        rowHeaders[0].push(index + 1);
        return [
          { data: item.agreementNumber          || '' },
          { data: item.agreementName            || '' },
          { data: item.agreementType            || '' },
          { data: item.customerName             || '' },
          { data: item.currencyCode             || '' },
          { data: self.formatDate(item.effectiveFrom) },
          { data: self.formatDate(item.effectiveTo)   },
          { data: item.expiryStatus || '' },
          { data: item.daysToExpiry    != null ? String(item.daysToExpiry)    : '' },
          { data: item.lineCount       != null ? String(item.lineCount)       : '' },
          { data: item.status                         || '' },
          { data: item.renewalActionRequired           || '' },
          { data: item.totalAgreementValue != null ? self.formatCurrency(item.totalAgreementValue) : '' },
          { data: item.activeRequestCount  != null ? String(item.activeRequestCount)               : '' }
        ];
      });
      this._aeGridProvider = new DemoArrayDataGridProvider(
        { data: data, rowHeader: rowHeaders, columnHeader: AE_COLUMN_HEADERS },
        {}, {}, {}, {}, {}
      );
      return this._aeGridProvider;
    }

    getAgreementExpiryColumnHeaderStyle(headerContext) {
      var base  = 'font-weight: bold; background-color: #f1f5f9; color: #475569; padding: 12px;';
      var width = AE_COLUMN_WIDTHS[headerContext.index] || '130px';
      return base + 'width:' + width + '; min-width:' + width + ';';
    }

    // ── Shared grid helpers ──────────────────────────────────────
    getIsEditable() { return true; }
    getHeaderFilterable() { return 'auto'; }

    // ── CSV Export ───────────────────────────────────────────────
    exportCSV(activeTab, data) {
      var self = this;
      var headers, rows, filename;
      // Output YYYY-MM-DD so Excel in any regional locale cannot auto-detect and
      // reformat these as dates — all cells stay plain text, fully consistent.
      var fmtD = function(val) {
        if (!val) return '';
        var s = String(val).substring(0, 10);
        var p = s.split('-');
        if (p.length !== 3) return s;
        if (p[0].length === 4) return s;          // already YYYY-MM-DD
        return p[2] + '-' + p[0] + '-' + p[1];   // MM-DD-YYYY → YYYY-MM-DD
      };

      if (activeTab === 'equip-history') {
        headers  = EH_COLUMN_HEADERS[0];
        rows     = (data.history || []).map(function (r) {
          return [
            r.equipment_name    || '',
            r.equipment_number  || '',
            r.serial_number     || '',
            fmtD(r.start_date),
            fmtD(r.end_date),
            r.allocation_status || '',
            r.line_status       || '',
            r.project_number    || '',
            r.project_name      || '',
            r.customer_name     || ''
          ];
        });
        filename = 'Equipment_History.csv';

      } else if (activeTab === 'rental-requests') {
        headers  = RR_COLUMN_HEADERS[0];
        rows     = (data.rentalReq || []).map(function (r) {
          return [
            r.requestNumber    || '',
            r.projectName      || r.projectNumber || '',
            r.customerName     || '',
            r.taskName         || '',
            r.requestStatus    || '',
            r.internalCustomer || '',
            r.requestor        || '',
            self.formatDate(r.requestStartDate),
            self.formatDate(r.requestEndDate),
            r.location         || '',
            r.equipmentName    || '',
            r.equipmentClass   || '',
            String(r.quantity != null ? r.quantity : ''),
            r.lineStatus       || '',
            self.formatDate(r.lineStartDate),
            self.formatDate(r.lineEndDate),
            r.rate != null ? self.formatCurrency(r.rate) : '',
            r.requisitionNumber || '',
            r.poNumber          || '',
            r.outboundToNumber  || '',
            r.inboundToNumber   || ''
          ];
        });
        filename = 'Rental_Requests.csv';

      } else if (activeTab === 'proj-cost-detail') {
        headers  = PC_COLUMN_HEADERS[0];
        rows     = (data.projCost || []).map(function (r) {
          return [
            r.project_number || '',
            r.project_name   || '',
            r.request_number || '',
            r.line_number    || '',
            r.equip_number   || '',
            r.equip_name     || '',
            r.equip_desc     || '',
            fmtD(r.posted_date),
            r.posted_status  || '',
            self.formatCurrency(r.cost_amount),
            String(r.quantity != null ? r.quantity : ''),
            self.formatCurrency(r.total_cost)
          ];
        });
        filename = 'Project_Cost_Detail.csv';

      } else if (activeTab === 'rate-exceptions') {
        headers  = RE_COLUMN_HEADERS[0];
        rows     = (data.rateExc || []).map(function (r) {
          return [
            r.yard             || '',
            r.equip_number     || '',
            r.equip_name       || '',
            r.equip_class      || '',
            r.subclass         || '',
            r.exception_reason || ''
          ];
        });
        filename = 'Rate_Exceptions.csv';

      } else if (activeTab === 'rate-schedule-rpt') {
        if (data.rateSchedType === 'exceptions') {
          headers  = RSE_COLUMN_HEADERS[0];
          rows     = (data.rateSchedExc || []).map(function (r) {
            return [
              r.equip_number || '',
              r.equip_desc   || '',
              r.equip_class  || '',
              r.subclass     || '',
              r.yard         || '',
              fmtD(r.gap_from),
              r.reason       || ''
            ];
          });
          filename = 'Rate_Schedule_Exceptions.csv';
        } else {
          headers  = RS_COLUMN_HEADERS[0];
          rows     = (data.rateSched || []).map(function (r) {
            return [
              r.schedule_id   || '',
              r.schedule_name || '',
              r.equip_class   || '',
              fmtD(r.effective_from),
              fmtD(r.effective_to),
              r.period        || '',
              r.rate_type     || '',
              r.threshold     || '',
              self.formatCurrency(r.rate)
            ];
          });
          filename = 'Rate_Schedule_Details.csv';
        }

      } else if (activeTab === 'agreement-expiry') {
        // Export as HTML table (.xls) so Excel renders coloured cells natively.
        var th = function (label) {
          return '<th style="background:#f1f5f9;font-weight:700;padding:6px 10px;border:1px solid #cbd5e1;white-space:nowrap;">' + label + '</th>';
        };
        var td = function (val, style) {
          var base = 'padding:4px 8px;border:1px solid #e2e8f0;';
          return '<td style="' + base + (style || '') + '">' + (val == null ? '' : val) + '</td>';
        };
        var htmlLines = [
          '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">',
          '<head><meta charset="UTF-8"/></head><body>',
          '<table border="0" cellspacing="0" cellpadding="0">',
          '<tr>' + AE_COLUMN_HEADERS[0].map(th).join('') + '</tr>'
        ];
        (data.agreementExpiry || []).forEach(function (r) {
          htmlLines.push(
            '<tr>' +
            td(r.agreementNumber || '') +
            td(r.agreementName   || '') +
            td(r.agreementType   || '') +
            td(r.customerName    || '') +
            td(r.currencyCode    || '') +
            td(self.formatDate(r.effectiveFrom)) +
            td(self.formatDate(r.effectiveTo))   +
            td(r.expiryStatus    || '') +
            td(r.daysToExpiry    != null ? r.daysToExpiry    : '') +
            td(r.lineCount       != null ? r.lineCount       : '') +
            td(r.status          || '') +
            td(r.renewalActionRequired || '') +
            td(r.totalAgreementValue != null ? self.formatCurrency(r.totalAgreementValue) : '') +
            td(r.activeRequestCount  != null ? r.activeRequestCount : '') +
            '</tr>'
          );
        });
        htmlLines.push('</table></body></html>');
        var aeBlob = new Blob([htmlLines.join('')], { type: 'application/vnd.ms-excel' });
        var aeUrl  = URL.createObjectURL(aeBlob);
        var aeA    = document.createElement('a');
        aeA.href = aeUrl; aeA.download = 'Agreement_Expiry.xls'; aeA.style.display = 'none';
        document.body.appendChild(aeA); aeA.click(); document.body.removeChild(aeA);
        URL.revokeObjectURL(aeUrl);
        return;

      } else {
        return;
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
  }

  return PageModule;
});
