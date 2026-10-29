define([
  'ojs/ojdatagridprovider',
  'ojs/ojeventtarget',
  'ojs/ojarraydataprovider',
  'resources/js/lineStatusLabels',
  'resources/js/expenditureTypes'
], function (ojdatagridprovider, ojeventtarget, ArrayDataProvider, lineStatusLabels, expenditureTypes) {
  'use strict';

  var MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // DemoArrayDataGridProvider â€” embeddded from Oracle JET cookbookk
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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
    if (capabilityName === 'filter') return { capability: 'filter' }; // Tell JET we support custom filtering
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

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // Column definitions  (cr_time_card_lines architecture)
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  // Keys match cr_time_card_lines API fields; 'person_name' is a display-only field
  // derived from the persons API (not stored directly on lines).
  var COLUMN_KEYS = [
    'request_number',     // 0
    'class_name',         // 1
    'equipment_name',     // 2
    'hours_type',         // 3
    'status',             // 4
    'task_name',          // 5
    'start_date',         // 6
    'end_date',           // 7
    'non_labor_resource', // 8
    'hours_day1',         // 9
    'hours_day2',         // 10
    'hours_day3',         // 11
    'hours_day4',         // 12
    'hours_day5',         // 13
    'hours_day6',         // 14
    'hours_day7',         // 15
    // APPENDED, never inserted: indices 3 (rate type), 4 (status) and 9..15 (hours)
    // are hardcoded all over this module, so anything but the end shifts them.
    // Appending moves the Actions column from 16 to 17 -- initColumnOrder() names
    // that number literally, so it is updated to match.
    'expenditure_type'    // 16
  ];
  // Actions column is always at index COLUMN_KEYS.length (= 17)

  var COLUMN_HEADERS = [
    'Request Number', 'Class', 'Equipment Name', 'Rate Type', 'Status',
    'Task Name', 'Start Date', 'End Date', 'Non Labor Resource',
    'Day 1 Hours', 'Day 2 Hours', 'Day 3 Hours', 'Day 4 Hours', 'Day 5 Hours', 'Day 6 Hours', 'Day 7 Hours',
    // "(all weeks)" because the value is per request LINE: editing it on one week
    // row sets it for every week of that equipment. Without this the column reads as
    // week-grain, which it is not. There is no cell tooltip available -- the shared
    // cellTemplate has no title binding -- so the header is the only place to say it.
    'Expenditure Type (all weeks)',
    '' // Actions
  ];

  // 'readonly' = display-only, 'dropdown' = oj-select-one, 'number' = number input,
  // 'text' = text input, 'dropdown-time-type' = time type dropdown (REG/OT/DT/SICK/VAC/HOL)
  // equipment_name is 'readonly', not a dropdown.
  //
  // It used to be typed 'dropdown-equip', which getDropdownProviderForCell has no
  // branch for -- so it fell through to the default and opened getClassLOV(), a
  // hardcoded demo list of Light / Medium / Heavy. Picking one wrote "Heavy" into
  // the Equipment Name cell.
  //
  // Read-only is the right type rather than a real equipment picker: a timesheet
  // row IS a request line, and which equipment that line is for was decided when
  // the request was raised. There is nothing to choose here. EQUIP_COLS_SKIP_SAVE
  // already listed equipment_name, so nothing ever sent the value anywhere -- the
  // corruption was confined to the screen until the next refresh.
  var COLUMN_TYPES = [
    'readonly', 'readonly', 'readonly', 'dropdown-rate-type', 'readonly',
    'readonly', 'readonly', 'readonly', 'text',
    'number', 'number', 'number', 'number', 'number', 'number', 'number',
    'dropdown-exp-type'
  ];

  // hours_day1..hours_day7 occupy COLUMN_KEYS indices 9..15.
  var HOURS_FIRST_ORIG_IDX = 9;
  var HOURS_LAST_ORIG_IDX  = 15;

  // Rate Type (hours_type, orig idx 3) -> EQR_TIME_ENTRY.ENTRY_TYPE. Values are constrained
  // by CHK_TE_ENTRY_TYPE; keep this list in sync with it.
  //
  // BLACKOUT is deliberately NOT offered here, even though V267 made it legal on
  // CHK_TE_ENTRY_TYPE. Excluded days live on EQR_LINE_DAY_EXCEPTION, keyed
  // (request line, date), and are marked from the POST COST page — blackout only
  // applies when timesheets are OFF, in which case this page is not part of the
  // flow at all. With timesheets ON the timesheet itself records which days were
  // not used, so there is nothing for a blackout rate type to add here.
  //
  // It also could not work if it were offered: ENTRY_TYPE is week-grain, and
  // POST /time-entries is a find-or-create keyed on (request line + ISO week) that
  // ignores entryType — it returns 201 with the EXISTING row's id and saves
  // nothing, so hours entered as blackout land on the USAGE entry as billable
  // time. That happened once (entry 1000000665, 2026-08-05).
  // See MD/Post Cost/blackout/BACKEND_HANDOFF_blackout.md.
  // Expenditure type = the PPM classification the cost posts under. Seeded with the
  // values PROVEN accepted by unprocessedProjectCosts; the page can replace this at
  // runtime with the list Fusion returns for the request's project, the same way the
  // Post Cost drawer and the PR drawer do. Stored and shown as the NAME, because the
  // OIC map sends _EXPENDITURE_TYPE_ID_Display.
  var EXP_TYPE_OPTIONS = [
    { value: 'Equipment',           label: 'Equipment' },
    { value: 'Purchased Equipment', label: 'Purchased Equipment' },
    { value: 'Supplies',            label: 'Supplies' },
    { value: 'Miscellaneous',       label: 'Miscellaneous' }
  ];

  var RATE_TYPE_OPTIONS = [
    { value: 'USAGE',        label: 'Usage' },
    { value: 'MOBILIZATION', label: 'Mobilization' },
    { value: 'RETURNING',    label: 'Return' },
    { value: 'STANDBY',      label: 'Standby' }
  ];

  // Fields shown in the grid but excluded from the save body (system/derived values)
  var COLS_SKIP_SAVE = {
    // PERMANENT, not a placeholder. Expenditure type is a per-REQUEST-LINE attribute
    // and is saved by PATCHing the request line, never as part of the time-entry
    // body -- EQR_TIME_ENTRY is week-grain and has no expenditure column, and the
    // value applies to every week of the equipment. This entry only comes out if the
    // decision ever changes to per-time-entry storage, which the coverage numbers
    // argue against: only 45 of 545 post-cost rows carry a time entry at all.
    expenditure_type: true,
    person_code: true, person_name: true, work_week: true,
    created_by: true, creation_date: true,
    last_updated_by: true, last_update_date: true
  };

  // Original index of the person_name column (stores person_id)
  var PERSON_ORIG_IDX = 1;

  // Original index of the combination_id column (crew labor grid)
  var COMBO_ORIG_IDX = 2;

  // Fields auto-populated when combination_id changes: { apiFieldName → COLUMN_KEYS original index }
  var COMBO_AUTO_COLS = {
    time_type_code:          3,
    project_number:          4,
    task_number:             5,
    shift_code:              6,
    project_id:              9,
    task_id:                 10,
    state_code:              11,
    county_name:             12,
    city_name:               13,
    project_pay_rate_code:   14,
    trade_code:              15,
    trade_name:              16,
    ot_threshold_measure:    17,
    ot_hours:                18,
    salary_ot_override_flag: 19,
    differential_amount:     20,
    write_in_rate:           21,
    differential_reason:     22,
    department:              23,
    meal_per_diem_amount:    24,
    silica_exposure_flag:    25,
    federally_funded_flag:   26,
    created_by:              29,
    creation_date:           30,
    last_updated_by:         31,
    last_update_date:        32
  };

  // Display order as original COLUMN_KEYS indices. -1 is the row-select column;
  // COLUMN_KEYS.length (17) is the Actions column, which hosts the row menu
  // (Duplicate / Delete) -- omitting it leaves duplicateRow unreachable. Actions
  // sits immediately after the checkbox so both row controls are together on the
  // left. Position is not load-bearing: every lookup resolves through
  // _columnOrder.indexOf(origIdx), and getColumnType() keys the select column off
  // display index 0 only.
  function initColumnOrder() {
    return [
      // 17 = Actions (was 16 before expenditure_type was appended to COLUMN_KEYS).
      // 16 = Expenditure Type, placed next to Rate Type (3): both classify the
      // entry rather than measuring it, so they read as a pair.
      -1, 17, 2, 3, 16, 9, 10, 11, 12, 13, 14, 15, 4, 1, 5, 6, 7
    ];
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // Combinations Grid Column Definitions
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  var COMBO_KEYS = [
    'cost_code',               //  0 – text (Cost Code from mockup)
    'description',             //  1 – text (Description from mockup)
    'qty_installed',           //  2 – number (Qty Installed from mockup)
    'uom',                     //  3 – text (UOM from mockup)
    'qty_budgeted',            //  4 – number (Qty Budgeted from mockup)
    'pct_complete',            //  5 – number (% Complete from mockup)
    'notes'                    //  6 – text (Notes from mockup)
  ];
  // Actions at COMBO_KEYS.length (= 7)

  var COMBO_HEADERS = [
    'Cost Code', 'Description', 'Qty Installed', 'UOM', 'Qty Budgeted',
    '% Complete', 'Notes', ''
  ];

  var COMBO_TYPES = [
    'text',               //  0  cost_code
    'text',               //  1  description
    'number',             //  2  qty_installed
    'text',               //  3  uom
    'number',             //  4  qty_budgeted
    'number',             //  5  pct_complete
    'text'                //  6  notes
  ];

  // All columns in order for the Installed Qty grid
  var COMBO_DISPLAY_ORDER = (function () {
    var o = [];
    o.push(COMBO_KEYS.length); // Actions first
    for (var i = 0; i < COMBO_KEYS.length; i++) {
      o.push(i);
    }
    return o;
  }());

  // ═══════════════════════════════════════════════════════════════════════════
  // Equipment Grid Column Definitions (mirrors cr_time_card_lines with equipment instead of person)
  // ═══════════════════════════════════════════════════════════════════════════

  var EQUIP_COLUMN_KEYS = [
    'request_number',     // 0
    'class_name',         // 1
    'equipment_name',     // 2
    'hours_type',         // 3
    'status',             // 4
    'task_name',          // 5
    'start_date',         // 6
    'end_date',           // 7
    'non_labor_resource', // 8
    'hours_day1',         // 9
    'hours_day2',         // 10
    'hours_day3',         // 11
    'hours_day4',         // 12
    'hours_day5',         // 13
    'hours_day6',         // 14
    'hours_day7'          // 15
  ];

  var EQUIP_COLUMN_HEADERS = [
    'Request Number', 'Class', 'Equipment Name', 'Hours Type', 'Status',
    'Task Name', 'Start Date', 'End Date', 'Non Labor Resource',
    'Day 1 Hours', 'Day 2 Hours', 'Day 3 Hours', 'Day 4 Hours', 'Day 5 Hours', 'Day 6 Hours', 'Day 7 Hours',
    '' // Actions
  ];

  // equipment_name read-only here too -- see the note on COLUMN_TYPES above.
  var EQUIP_COLUMN_TYPES = [
    'readonly', 'text', 'readonly', 'text', 'text',
    'text', 'text', 'text', 'text',
    'number', 'number', 'number', 'number', 'number', 'number', 'number'
  ];

  var EQUIP_COLS_SKIP_SAVE = {
    equipment_code: true, equipment_name: true, work_week: true,
    created_by: true, creation_date: true,
    last_updated_by: true, last_update_date: true
  };

  var EQUIP_ORIG_IDX     = 1; // equipment_name column stores equipment_id
  var EQUIP_COMBO_ORIG_IDX = 2; // combination_id column

  function initEquipColumnOrder() {
    return [
      1, 2, 9, 10, 11, 12, 13, 14, 15, 5, 3, 4, 6, 7
    ];
  }


  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // VBCS Page Module
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  var PageModule = function PageModule() {
    this._data = [];           // Currently displayed (filtered) rows
    this._allData = [];        // Master list of all rows (including filtered-out)
    this._rowHeaders = [[]];
    this._columnOrder = initColumnOrder(); // Maps display position → original COLUMN_KEYS index
    this._columnHeaders = [this._columnOrder.map(function (origIdx) { return origIdx === -1 ? '' : COLUMN_HEADERS[origIdx]; })];
    this._history = [];        // Undo snapshot stack

    // â”€â”€â”€ Row Metadata (parallel to _allData / _data) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // _rowMetaAll[i] corresponds to _allData[i]:
    //   { time_entry_line_id, person_id, time_card_id, work_date, crew_id }
    // null time_entry_line_id means the row has not yet been saved to the API.
    this._rowMetaAll = [];
    this._rowMetaFiltered = []; // parallel to _data (rebuilt on filter)

    // Maps _data[i] â†’ _allData[j] index (identity map when no filter)
    this._dataToAllIdx = [];

    // â”€â”€â”€ Current context â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this._currentTimeCardId = null;
    this._currentCrewId = null;
    this._currentWorkDate = null;

    // â”€â”€â”€ Persons lookup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this._personsMap = {};           // { person_id â†’ name }

    // â”€â”€â”€ Combinations lookup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this._combinationsMap = {};      // { combination_id â†’ CombinationItem }
    this._combinationsProvider = null;

    // â”€â”€â”€ Pay Rate Code LOV â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    var PAY_RATE_CODES = [
      { value: 'Prevailing', label: 'Prevailing' },
      { value: 'Contracted', label: 'Contracted' },
      { value: 'Not Applicable', label: 'Not Applicable' }
    ];
    this._payRateCodeProvider = new ArrayDataProvider(PAY_RATE_CODES, { keyAttributes: 'value' });

    // â”€â”€â”€ Change Tracking â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this._deletedIds = [];     // time_entry_line_ids of deleted existing rows
    this._modifiedIds = {};    // { time_entry_line_id: true } for edited existing rows

    // â”€â”€â”€ Pending operation queues (used during save) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this._pendingDeletes = [];
    this._pendingUpdates = [];
    this._pendingCreates = [];
    this._pendingExpTypes = [];

    // â”€â”€â”€ Current header item (stored for PUT calls) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this._currentHeaderItem = null;

    // â”€â”€â”€ Combinations Grid State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this._comboColumnOrder = COMBO_DISPLAY_ORDER.slice(); // mutable display order (for DnD reorder)
    this._comboData = [];
    this._comboAllData = [];
    this._comboRowHeaders = [[]];
    this._comboColumnHeaders = [this._comboColumnOrder.map(function (i) { return COMBO_HEADERS[i]; })];
    this._comboGridProvider = null;
    this._comboRowMetaAll = [];      // { combination_id }
    this._comboRowMetaFiltered = [];
    this._comboDataToAllIdx = [];
    this._comboDeletedIds = [];
    this._comboModifiedIds = {};
    this._comboPendingDeletes = [];
    this._comboPendingUpdates = [];
    this._comboPendingCreates = [];
    this._comboHistory = [];
    this._comboCurrentFilterText = '';
    this._comboCurrentFilterColumnIndex = -1;
    this._comboDraggedIndex = [];

    // â”€â”€â”€ Projects Cache (for auto-populate on project selection) â”€â”€â”€â”€â”€â”€
    this._projectsCache = {};        // { project_number â†’ project item }

    // ─── Equipment Grid State ──────────────────────────────────────────────────────────────────────
    this._equipColumnOrder    = initEquipColumnOrder().slice();
    this._equipData           = [];
    this._equipAllData        = [];
    this._equipRowHeaders     = [[]];
    this._equipColumnHeaders  = [this._equipColumnOrder.map(function (i) { return EQUIP_COLUMN_HEADERS[i]; })];
    this._equipGridProvider   = null;
    this._equipRowMetaAll     = [];
    this._equipRowMetaFiltered = [];
    this._equipDataToAllIdx   = [];
    this._equipDeletedIds     = [];
    this._equipModifiedIds    = {};
    this._equipPendingDeletes = [];
    this._equipPendingUpdates = [];
    this._equipPendingCreates = [];
    this._equipHistory        = [];
    this._equipCurrentFilterText = '';
    this._equipCurrentFilterColumnIndex = -1;
    this._equipDraggedIndex   = [];
    this._equipmentMap        = {};
    this._equipmentCodeMap    = {};
    this._equipmentProvider   = null;

    // ─── Row Selection (for Submit selected rows) ─────────────────────────
    this._selectedRows = new Set();

    // Auto-bind all prototype methods to this instance so they can be safely passed to Oracle JET components without .bind() in HTML
    for (var prop in PageModule.prototype) {
      if (typeof PageModule.prototype[prop] === 'function') {
        this[prop] = PageModule.prototype[prop].bind(this);
      }
    }
  };

  // â”€â”€â”€ Initialize helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // Clears all change-tracking state (called after load or successful save)
  PageModule.prototype._clearChangeTracking = function () {
    this._deletedIds = [];
    this._modifiedIds = {};
    this._pendingDeletes = [];
    this._pendingUpdates = [];
    this._pendingCreates = [];
    this._pendingExpTypes = [];
    this._history = [];
  };

  PageModule.prototype._calculateOverallTotals = function() {
    var self = this;
    var totalHrs = 0;
    var billAmt = 0;

    // Sum from Labor grid
    var hoursOrigIdx = COLUMN_KEYS.indexOf('hours');
    var hoursDispPos = self._columnOrder.indexOf(hoursOrigIdx);
    if (hoursDispPos >= 0 && self._allData) {
      self._allData.forEach(function(row) {
        var hrs = parseFloat(row[hoursDispPos].data);
        if (!isNaN(hrs)) totalHrs += hrs;
      });
    }

    // Sum from Equipment grid
    var equipHoursOrigIdx = EQUIP_COLUMN_KEYS.indexOf('hours'); // Operating Hrs
    var equipHoursDispPos = self._equipColumnOrder.indexOf(equipHoursOrigIdx);
    if (equipHoursDispPos >= 0 && self._equipAllData) {
      self._equipAllData.forEach(function(row) {
        var hrs = parseFloat(row[equipHoursDispPos].data);
        if (!isNaN(hrs)) totalHrs += hrs;
      });
    }

    // Mock Bill Calculation ($150 / hr for labor + equipment combined)
    billAmt = totalHrs * 150;

    // Dispatch custom event so VBCS can pick it up via JS listener or action chain
    var event = new CustomEvent('timesheetTotalsUpdated', {
      detail: {
        totalHours: totalHrs,
        billAmount: billAmt
      }
    });
    document.dispatchEvent(event);
  };

  // Core data setup â€” accepts pre-built rows and parallel meta array.
  // rows: array of cell arrays (each cell is { data: value })
  // metas: array of { time_entry_line_id, person_id, time_card_id, work_date, crew_id }
  PageModule.prototype._buildRows = function (rows, metas) {
    var self = this;
    self._data = [];
    self._allData = [];
    self._rowMetaAll = metas ? metas.slice() : [];
    self._rowMetaFiltered = self._rowMetaAll.slice();
    self._rowHeaders = [[]];
    self._columnOrder = initColumnOrder();
    self._dataToAllIdx = [];

    rows.forEach(function (row, index) {
      // row arrives in original COLUMN_KEYS order; reorder to current display order
      var displayRow = self._columnOrder.map(function (origIdx) {
        return row[origIdx] || { data: '' };
      });
      self._rowHeaders[0].push(index + 1);
      self._data.push(displayRow);
      self._allData.push(displayRow.map(function (c) { return { data: c.data }; }));
      self._dataToAllIdx.push(index);
    });
  };

  // Initialize grid from cr_time_card_lines API items.
  // The person_name column stores person_id (displayed as a name via getPersonName lookup).
  PageModule.prototype.initProviderFromLines = function (lines, weekStart) {
    var self = this;

    // 1. Recalculate Headers if weekStart is provided
    if (weekStart) {
      this._currentWorkDate = weekStart; // Cache for other methods
      var start = new Date(weekStart + 'T00:00:00');
      var headers = COLUMN_HEADERS.slice();
      for (var i = 0; i < 7; i++) {
        var d = new Date(start);
        d.setDate(start.getDate() + i);
        var formatted = d.getDate() + '-' + MONTH_NAMES[d.getMonth()] + '-' + d.getFullYear();
        headers[9 + i] = formatted + ' Hours';
      }
      this._columnHeaders = [this._columnOrder.map(function (idx) {
        if (idx === -1 || idx === COLUMN_KEYS.length) return '';
        return headers[idx];
      })];
    }

    var rows = [];
    var metas = [];
    (lines || []).forEach(function (item) {
      var hasEntry    = !!item.eqr_time_entry_id;
      var defaultHrs  = (!hasEntry && item.default_hours) ? Number(item.default_hours) : null;
      var startDate   = item.start_date || null;
      var endDate     = item.end_date   || null;
      var weekStartDt = weekStart ? new Date(weekStart + 'T00:00:00') : null;

      var row = COLUMN_KEYS.map(function (key) {
        var v = item[key];

        if (defaultHrs && defaultHrs > 0 && weekStartDt) {
          var dayMatch = key.match(/^hours_day(\d)$/);
          if (dayMatch) {
            var dayOffset = parseInt(dayMatch[1], 10) - 1;
            var dayDt     = new Date(weekStartDt);
            dayDt.setDate(dayDt.getDate() + dayOffset);
            var dayStr    = dayDt.getFullYear() + '-' + String(dayDt.getMonth() + 1).padStart(2, '0') + '-' + String(dayDt.getDate()).padStart(2, '0');
            var inRange   = (!startDate || dayStr >= startDate) &&
                            (!endDate   || dayStr <= endDate);
            v = inRange ? defaultHrs : 0;
          }
        }

        return { data: v !== undefined && v !== null ? v : '' };
      });
      row.push({ data: '' }); // Actions placeholder
      rows.push(row);
      metas.push({
        time_entry_line_id: item.time_entry_line_id || null,
        person_id:          item.request_number || item.person_id,
        time_card_id:       item.time_card_id,
        work_date:          item.start_date || item.work_date,
        crew_id:            item.crew_id,
        project_id:         item.project_id || null,
        task_id:            item.task_id    || null,
        request_line_id:    item.request_line_id || null,
        eqr_time_entry_id:  item.eqr_time_entry_id || item.eqrTimeEntryId || null,
        // Baseline for the per-LINE expenditure type: what this row was LOADED with.
        // prepareExpTypeChanges diffs the cell against this rather than consulting
        // _modifiedIds, which never sees a row that has no time entry yet.
        expenditure_type:   (item.expenditure_type !== undefined && item.expenditure_type !== null)
                              ? String(item.expenditure_type) : null,
        // Keys the per-row narrowing of the expenditure-type picker. Lives on the
        // meta rather than in a column because it is an identifier, never shown.
        equipment_master_id: item.equipment_master_id || null
      });
    });
    self._buildRows(rows, metas);
    self._createProvider();
    self._clearChangeTracking();
    return self._dataGridProvider;
  };

  // Initialize grid with one empty row per person (new time card header just created)
  PageModule.prototype.initProviderFromPersons = function (persons, timeCardId, crewId, workDate) {
    var self = this;
    self._currentTimeCardId = timeCardId;
    self._currentCrewId     = crewId;
    self._currentWorkDate   = workDate;

    var rows = [];
    var metas = [];
    (persons || []).forEach(function (person) {
      var row = COLUMN_KEYS.map(function (key) {
        if (key === 'person_code') return { data: person.person_code || person.person_number || person.number || '' };
        if (key === 'person_name') return { data: person.cr_persons_id || '' };
        if (key === 'hours')       return { data: 0 };
        if (key === 'work_date')   return { data: workDate || '' };
        return { data: '' };
      });
      row.push({ data: '' }); // Actions placeholder
      rows.push(row);
      metas.push({
        time_entry_line_id: null,
        person_id:          person.cr_persons_id,
        time_card_id:       timeCardId,
        work_date:          workDate,
        crew_id:            crewId,
        project_id:         null,
        task_id:            null,
        request_line_id:    null
      });
    });
    self._buildRows(rows, metas);
    self._createProvider();
    self._clearChangeTracking();
    return self._dataGridProvider;
  };

  // Initializes grid with demo data (called at page load and on revert)
  PageModule.prototype.initProviderFromData = function () {
    var self = this;
    
    // 1. Setup Dynamic Headers
    var weekStart = this._pendingWeekStart || this._currentWorkDate || '2026-03-30';
    this._currentWorkDate = weekStart;
    this._pendingWeekStart = null;
    var start = new Date(weekStart + 'T00:00:00');
    var headers = COLUMN_HEADERS.slice();
    for (var i = 0; i < 7; i++) {
      var d = new Date(start);
      d.setDate(start.getDate() + i);
      var formatted = d.getDate() + '-' + MONTH_NAMES[d.getMonth()] + '-' + d.getFullYear();
      headers[9 + i] = formatted + ' Hours';
    }
    this._columnHeaders = [this._columnOrder.map(function (i) { 
      if (i === COLUMN_KEYS.length) return '';
      return headers[i]; 
    })];

    // 2. High-Fidelity Demo Data (50 rows)
    var demoRows = [
      { request_number: '2277', class_name: 'CRAWLER CRANE', equipment_name: 'Multi-Axle Trailer', hours_type: 'Usage', status: 'Draft', project_name: 'Highway Expansion', task_name: 'Site Prep', start_date: '2026-03-30', end_date: '2026-04-05', non_labor_resource: 'Crane Ops', hours_day1: 8, hours_day2: 8, hours_day3: 8, hours_day4: 8, hours_day5: 8, hours_day6: 0, hours_day7: 0 },
      { request_number: '2256', class_name: 'EXCAVATOR', equipment_name: 'HDPE Pipes', hours_type: 'Usage', status: 'Draft', project_name: 'Highway Expansion', task_name: 'Utility Work', start_date: '2026-03-30', end_date: '2026-04-05', non_labor_resource: 'Ground Work', hours_day1: 4, hours_day2: 4, hours_day3: 4, hours_day4: 4, hours_day5: 4, hours_day6: 0, hours_day7: 0 },
      { request_number: '2190', class_name: 'BULLDOZER', equipment_name: 'Bulldozer D6', hours_type: 'Usage', status: 'Draft', project_name: 'Highway Expansion', task_name: 'Grading', start_date: '2026-03-30', end_date: '2026-04-05', non_labor_resource: 'Grading Ops', hours_day1: 6, hours_day2: 6, hours_day3: 6, hours_day4: 6, hours_day5: 6, hours_day6: 2, hours_day7: 0 }
    ];

    // Generate 47 more rows to reach 50
    var classes = ['CRAWLER CRANE', 'EXCAVATOR', 'BULLDOZER', 'FORKLIFT', 'GENERATOR', 'BACKHOE'];
    var equipNames = ['Trailer A', 'Pipe X', 'Dozer Y', 'Forklift 5T', 'GenSet 500', 'Backhoe Z'];
    for (var j = 0; j < 47; j++) {
      var reqNum = (3000 + j).toString();
      var cls = classes[j % classes.length];
      var name = equipNames[j % equipNames.length] + ' ' + (j + 1);
      demoRows.push({
        request_number: reqNum,
        class_name: cls,
        equipment_name: name,
        hours_type: 'Usage',
        status: 'Draft',
        project_name: 'General Construction Phase ' + (j % 5 + 1),
        task_name: 'Maintenance ' + (j % 3 + 1),
        start_date: '2026-03-30',
        end_date: '2026-04-05',
        non_labor_resource: 'Fleet Mgr',
        hours_day1: (j % 8 + 1),
        hours_day2: (j % 8 + 1),
        hours_day3: (j % 8 + 1),
        hours_day4: (j % 8 + 1),
        hours_day5: (j % 8 + 1),
        hours_day6: 0,
        hours_day7: 0
      });
    }

    var rows = [];
    var metas = [];
    demoRows.forEach(function (item) {
      var row = COLUMN_KEYS.map(function (key) {
        var v = item[key];
        return { data: v !== undefined && v !== null ? v : '' };
      });
      row.push({ data: '' }); // Actions placeholder
      rows.push(row);
      metas.push({
        time_entry_line_id: null,
        person_id: item.request_number,
        time_card_id: 'DEMO-TC-001',
        work_date: item.start_date,
        crew_id: 'DEMO-CREW-001',
        project_id: null,
        task_id: null
      });
    });
    this._buildRows(rows, metas);
    this._createProvider();
    this._clearChangeTracking();
    return this._dataGridProvider;
  };

  // Timesheet status renders as plain text — colour pills are reserved for the
  // request header status. The free-text-to-status-code normalisation this
  // used to do existed only to pick a pill colour, so it is no longer needed.
  // See resources/js/lineStatusLabels.js.
  PageModule.prototype.getStatusBadgeClass = function (status) {
    return lineStatusLabels.statusTextClass(status);
  };

  // â”€â”€â”€ Filter Functions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  PageModule.prototype.getHeaderFilterable = function (headerContext) {
    return 'disable';
  };

  PageModule.prototype.handleFilterRequest = function (event) {
    var attributeName = event.detail.item.data;
    var popup = document.getElementById('filterPopup');

    // Stash which column index this header corresponds to
    this._currentFilterColumnIndex = event.detail.item.index;
    
    if (popup) {
      popup.open(event.detail.launcher, {
        of: event.detail.anchor,
        at: { horizontal: 'right', vertical: 'top' }
      });
    }
    return attributeName;
  };

  PageModule.prototype.closeFilterPopup = function () {
    var datagrid = document.getElementById('datagrid');
    if (datagrid) datagrid.focus();
  };

  PageModule.prototype.applyFilter = function (filterText) {
    var self = this;
    this._currentFilterText = (filterText || "").toString().toLowerCase();
    
    // Clear popup
    var popup = document.getElementById('filterPopup');
    if (popup) popup.close();

    this._rebuildFilteredData();
  };

  PageModule.prototype.applyBannerFilters = function (searchText, status, usageType, className) {
    console.log('[applyBannerFilters] called with', { searchText: searchText, status: status, usageType: usageType, className: className });
    this._bannerFilters = {
      searchText: searchText,
      status: status,
      usageType: usageType,
      className: className
    };
    this._rebuildFilteredData();
    console.log('[applyBannerFilters] rebuilt — filtered rows:', this._data ? this._data.length : 0, 'allData rows:', this._allData ? this._allData.length : 0);
    // Return the (now newly-created) provider so the chain can assign it
    // to $page.variables.dataGridProvider — KO only fires the data binding
    // on a fresh reference. In-place mutation + doRefresh() wasn't enough.
    return this._dataGridProvider;
  };

  PageModule.prototype._rebuildFilteredData = function () {
    var self = this;
    var searchText = this._bannerFilters ? this._bannerFilters.searchText : null;
    var status = this._bannerFilters ? this._bannerFilters.status : null;
    var usageType = this._bannerFilters ? this._bannerFilters.usageType : null;
    var className = this._bannerFilters ? this._bannerFilters.className : null;

    // Rebuild _data / _rowMetaFiltered / _dataToAllIdx from _allData using all active filters
    this._data = [];
    this._rowHeaders = [[]];
    this._rowMetaFiltered = [];
    this._dataToAllIdx = [];

    // Resolve original column index for the filtered column (needed to handle dropdowns)
    var filterOrigIdx = (self._currentFilterColumnIndex >= 0)
      ? self._columnOrder[self._currentFilterColumnIndex]
      : -1;

    var classIdx = self._columnOrder.indexOf(1);
    var equipNameIdx = self._columnOrder.indexOf(2);
    var usageTypeIdx = self._columnOrder.indexOf(3);
    var statusIdx = self._columnOrder.indexOf(4);

    self._allData.forEach(function (row, allIdx) {
      var matches = true;

      // 0. Banner Search Filter (Equipment Name)
      if (searchText) {
        var equipCell = row[equipNameIdx];
        if (equipCell && equipCell.data !== undefined) {
          var eqVal = (self._equipmentMap && self._equipmentMap[equipCell.data] ? self._equipmentMap[equipCell.data] : equipCell.data).toString().toLowerCase();
          if (eqVal.indexOf(searchText.toLowerCase()) === -1) {
            matches = false;
          }
        } else {
          matches = false;
        }
      }

      // 1. Banner Status Filter
      if (status && row[statusIdx] && row[statusIdx].data !== status) matches = false;

      // 2. Banner Usage Type Filter
      if (usageType && row[usageTypeIdx] && row[usageTypeIdx].data !== usageType) matches = false;

      // 3. Banner Class Filter
      if (className && row[classIdx] && row[classIdx].data !== className) matches = false;

      // 4. Existing Column Filter
      if (matches && self._currentFilterText !== "" && self._currentFilterColumnIndex !== -1) {
        var cell = row[self._currentFilterColumnIndex];
        if (cell && cell.data !== undefined) {
          var cellValue;
          if (filterOrigIdx === PERSON_ORIG_IDX) {
            cellValue = (self._personsMap[cell.data] || '').toLowerCase();
          } else if (filterOrigIdx === COMBO_ORIG_IDX) {
            var combo = self._combinationsMap[cell.data];
            cellValue = (combo ? (combo.combination_name || '') : '').toLowerCase();
          } else {
            cellValue = (cell.data || "").toString().toLowerCase();
          }
          if (cellValue.indexOf(self._currentFilterText) === -1) {
            matches = false;
          }
        }
      }

      if (matches) {
        // Deep copy the row so edits to _data don't mutatively break the master reference un-tracked
        var rowCopy = row.map(function(c) { return { data: c.data }; });
        self._data.push(rowCopy);
        self._rowMetaFiltered.push(self._rowMetaAll[allIdx]);
        self._dataToAllIdx.push(allIdx);
        self._rowHeaders[0].push(self._data.length);
      }
    });

    // Build a fresh provider instance so the KO binding on
    // $page.variables.dataGridProvider can observe the change. Mutating
    // the existing provider's dataParameters + calling doRefresh() did
    // NOT trigger the data-grid to re-render in this setup, which is why
    // the banner search appeared to do nothing.
    this._createProvider();
  };

  // â”€â”€â”€ Master Data Synchronization â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // Sync _allData[j] with the current state of _data[dataRowIdx]
  PageModule.prototype._syncToAllData = function (dataRowIdx) {
    var allIdx = this._dataToAllIdx[dataRowIdx];
    if (allIdx === undefined) return;
    this._allData[allIdx] = this._data[dataRowIdx].map(function (c) { return { data: c.data }; });
  };

  // Remove the _allData entry corresponding to _data[dataRowIdx].
  // Also updates _rowMetaAll, _rowMetaFiltered, and _dataToAllIdx.
  PageModule.prototype._deleteFromAllData = function (dataRowIdx) {
    var allIdx = this._dataToAllIdx[dataRowIdx];
    if (allIdx === undefined) return;
    this._allData.splice(allIdx, 1);
    this._rowMetaAll.splice(allIdx, 1);
    // Remove this data row's mapping and decrement higher allData indices
    this._dataToAllIdx.splice(dataRowIdx, 1);
    for (var i = 0; i < this._dataToAllIdx.length; i++) {
      if (this._dataToAllIdx[i] > allIdx) this._dataToAllIdx[i]--;
    }
    this._rowMetaFiltered.splice(dataRowIdx, 1);
  };

  // Append a new row to _allData and insert its mapping at dataInsertIdx in _dataToAllIdx.
  // dataInsertIdx must match the position just inserted into _data.
  PageModule.prototype._addToAllData = function (dataArray, metaItem, dataInsertIdx) {
    var newAllIdx = this._allData.length;
    this._allData.push(dataArray.map(function (c) { return { data: c.data }; }));
    var meta = metaItem || {
      time_entry_line_id: null,
      person_id:    null,
      time_card_id: this._currentTimeCardId,
      work_date:    this._currentWorkDate,
      crew_id:      this._currentCrewId,
      project_id:   null,
      task_id:      null
    };
    this._rowMetaAll.push(meta);
    var pos = (dataInsertIdx !== undefined) ? dataInsertIdx : (this._data.length - 1);
    this._dataToAllIdx.splice(pos, 0, newAllIdx);
    this._rowMetaFiltered.splice(pos, 0, meta);
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

  // â”€â”€â”€ Column Header Formatting â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  PageModule.prototype.formatColumnHeader = function (headerContext) {
    return headerContext.item.data;
  };

  PageModule.prototype.getColumnHeaderStyle = function (headerContext) {
    var origIdx = this._columnOrder[headerContext.index];
    if (origIdx === -1) return 'width:40px;';
    if (origIdx === COLUMN_KEYS.length) return 'width:57px;';
    var key = COLUMN_KEYS[origIdx];
    if (key === 'request_number')     return 'width:120px;';
    if (key === 'class_name')         return 'width:140px;';
    if (key === 'equipment_name')     return 'width:240px;';
    if (key === 'hours_type')         return 'width:100px;';
    if (key === 'status')             return 'width:110px;';
    if (key === 'project_name')       return 'width:280px;';
    if (key === 'task_name')          return 'width:140px;';
    if (key === 'start_date')         return 'width:110px;';
    if (key === 'end_date')           return 'width:110px;';
    if (key === 'non_labor_resource') return 'width:180px;';
    // Wide enough for 'Purchased Equipment', the longest proven value. This landed
    // in getEquipColumnHeaderStyle first -- the EQUIPMENT grid's function, which is
    // dead on this page -- so the live column silently took the 140px default and
    // truncated.
    if (key === 'expenditure_type')   return 'width:170px;';
    if (key && key.indexOf('hours_day') === 0) return 'width:135px;';
    return 'width:140px;';
  };

  // â”€â”€â”€ Column Order Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // Returns the original COLUMN_KEYS index for a given display column position.
  PageModule.prototype.getOriginalColIdx = function (displayIdx) {
    return this._columnOrder[displayIdx];
  };

  // Returns the cell render type ('id', 'text', 'number', 'actions') for a display column.
  PageModule.prototype.getColumnType = function (displayIdx) {
    if (displayIdx === 0) return 'select';
    var origIdx = this._columnOrder[displayIdx];
    if (origIdx === COLUMN_KEYS.length) return 'actions';
    var type = COLUMN_TYPES[origIdx] || 'text';
    // Map specific dropdown types to 'dropdown' for the shared template logic
    if (type.startsWith('dropdown')) return 'dropdown';
    return type;
  };

  PageModule.prototype.isRowSelected = function (rowIndex) {
    return this._selectedRows.has(rowIndex);
  };

  PageModule.prototype.toggleRowSelected = function (rowIndex, pageVars, event) {
    if (event.target.checked) {
      // Block selection of non-DRAFT rows
      var statusDisplayIdx = this._columnOrder.indexOf(4);
      if (statusDisplayIdx !== -1) {
        var statusCell = this._data[rowIndex] && this._data[rowIndex][statusDisplayIdx];
        var rowStatus  = statusCell && statusCell.data;
        if (rowStatus && rowStatus !== 'DRAFT' && rowStatus !== 'REJECTED') {
          event.target.checked = false;
          return;
        }
      }
      this._selectedRows.add(rowIndex);
    } else {
      this._selectedRows.delete(rowIndex);
    }
    if (pageVars) pageVars.selectedRowCount = this._selectedRows.size;
  };

  PageModule.prototype.getSelectedTimeEntryIds = function () {
    var self = this;
    var ids = [];
    self._selectedRows.forEach(function (rowIndex) {
      var allIdx = self._dataToAllIdx[rowIndex];
      if (allIdx === undefined) return;
      var meta = self._rowMetaAll[allIdx];
      if (meta && meta.eqr_time_entry_id) {
        ids.push(meta.eqr_time_entry_id);
      }
    });
    return ids;
  };

  // Request-line ids of the selected rows. Used to submit rows that were
  // pre-populated from the create-request flow and therefore have no
  // eqr_time_entry_id until they are saved during Submit's Phase 1.
  PageModule.prototype.getSelectedRequestLineIds = function () {
    var self = this;
    var ids = [];
    self._selectedRows.forEach(function (rowIndex) {
      var allIdx = self._dataToAllIdx[rowIndex];
      if (allIdx === undefined) return;
      var meta = self._rowMetaAll[allIdx];
      if (meta && meta.request_line_id) {
        ids.push(meta.request_line_id);
      }
    });
    return ids;
  };

  PageModule.prototype.clearSelection = function (pageVars) {
    this._selectedRows = new Set();
    if (pageVars) pageVars.selectedRowCount = 0;
  };

  PageModule.prototype.getExcelLabel = function(displayIdx) {
    var origIdx = this._columnOrder[displayIdx];
    if (origIdx === COLUMN_KEYS.length) return ''; // Actions
    return COLUMN_HEADERS[origIdx] || '';
  };

  PageModule.prototype.getCsvData = function () {
    var self = this;
    var headers = self._columnHeaders && self._columnHeaders[0] ? self._columnHeaders[0] : [];
    var order   = self._columnOrder || [];
    var actionsIdx = COLUMN_KEYS.length;

    var headerRow = [];
    for (var h = 0; h < order.length; h++) {
      if (order[h] === actionsIdx) continue;
      var label = headers[h] || COLUMN_HEADERS[order[h]] || '';
      headerRow.push(self._csvQuote(label));
    }

    var lines = [headerRow.join(',')];

    var allData = self._allData || [];
    for (var r = 0; r < allData.length; r++) {
      var row = allData[r];
      var cells = [];
      for (var c = 0; c < order.length; c++) {
        if (order[c] === actionsIdx) continue;
        var val = (row[c] && row[c].data !== undefined) ? row[c].data : '';
        cells.push(self._csvQuote(String(val)));
      }
      lines.push(cells.join(','));
    }

    return lines.join('\r\n');
  };

  PageModule.prototype._csvQuote = function (value) {
    if (value === null || value === undefined) return '';
    var str = String(value);
    if (str.indexOf(',') >= 0 || str.indexOf('"') >= 0 || str.indexOf('\n') >= 0) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  PageModule.prototype.getDropdownDisplayValue = function(displayIdx, rawValue) {
    var origIdx = this._columnOrder[displayIdx];
    var type = COLUMN_TYPES[origIdx];
    if (type === 'dropdown-person') {
      return this.getPersonName(rawValue);
    }
    if (type === 'dropdown') { // Combination
      var combo = this._combinationsMap[rawValue];
      return combo ? (combo.combination_name || rawValue) : rawValue;
    }
    if (type === 'dropdown-exp-type') {
      // Value and label are the same string (the Fusion type NAME), so there is
      // nothing to map -- but return it explicitly rather than falling through.
      //
      // When a unit is known, append it. The unit is what the choice actually
      // decides (see getExpTypeUom), so it belongs where the choice is READ, not
      // only where it is made. No unit -> the unchanged string, exactly as before.
      var expUom = this.getExpTypeUom(rawValue, this._lastVariables);
      return expUom ? (rawValue + '  ·  ' + expUom) : rawValue;
    }
    if (type === 'dropdown-rate-type') {
      // Without this the grid shows the stored code (BLACKOUT) in navigation mode while the
      // editor shows the label -- the same cell reads two different ways.
      for (var i = 0; i < RATE_TYPE_OPTIONS.length; i++) {
        if (RATE_TYPE_OPTIONS[i].value === rawValue) return RATE_TYPE_OPTIONS[i].label;
      }
      return rawValue;
    }
    return rawValue;
  };

  // rowIndex is OPTIONAL and only the expenditure-type picker reads it: that one
  // list differs per row, because it is narrowed to the equipment on that row.
  // A caller that omits it gets the unnarrowed list, which is what every other
  // dropdown here wants anyway.
  PageModule.prototype.getDropdownProviderForCell = function(displayIdx, variables, rowIndex) {
    var origIdx = this._columnOrder[displayIdx];
    var type = COLUMN_TYPES[origIdx];
    if (type === 'dropdown-person') return this.getPersonsProvider();
    if (type === 'dropdown') return variables.combinationsProvider;
    if (type === 'dropdown-time-type') return this.getTimeTypeProvider();
    if (type === 'dropdown-pay-rate') return this.getPayRateCodeProvider();
    if (type === 'dropdown-rate-type') return this.getRateTypeProvider();
    if (type === 'dropdown-exp-type')  return this.getExpTypeProvider(variables, rowIndex);

    // Nothing should reach here. A column typed 'dropdown-<something>' with no
    // branch above used to land on getClassLOV() in silence, which is how the
    // Equipment Name column spent its life offering Light / Medium / Heavy. If a
    // new dropdown type is added and its branch forgotten, say so rather than
    // quietly serving a demo list that looks deliberate on screen.
    console.warn('[TIMESHEET] no dropdown provider for column type "%s" - falling back. '
      + 'Add a branch in getDropdownProviderForCell.', type);
    return this.getClassLOV();
  };

  // Prefers the project-scoped list the page loaded; falls back to the proven four
  // so the picker is never empty. Not cached on `this`: the list can be replaced
  // after the fetch resolves, and a cached provider would keep serving the seed.
  PageModule.prototype.getExpTypeProvider = function (variables, rowIndex) {
    // getDropdownDisplayValue() is called by the cell template without the page
    // variables, so keep the last list seen here. Stale is harmless: the lookup
    // is by expenditure-type NAME, so the worst case is a missing unit suffix,
    // never a wrong one.
    this._lastVariables = variables;
    var list = (variables && Array.isArray(variables.expTypeList) && variables.expTypeList.length)
      ? variables.expTypeList
      : EXP_TYPE_OPTIONS;

    // Narrow to what was AUTHORED for this row's equipment, when we know it.
    // expTypeMap arrives after the grid renders, so this widens-then-narrows as
    // the lookup lands; VBCS re-evaluates the binding when the variable is
    // reassigned, which is why the chain replaces the object rather than
    // mutating it.
    //
    // Every failure path here keeps the full list. An unmapped model, a failed
    // lookup, a mapping whose names are not chargeable on this project -- all of
    // them show the 84 rather than showing nothing. Blanking the picker would
    // stop the user recording their week, which is worse than a long list.
    var narrowed = list;
    if (rowIndex !== undefined && rowIndex !== null
        && variables && variables.expTypeMap) {
      var meta     = this._rowMetaFiltered ? this._rowMetaFiltered[rowIndex] : null;
      var masterId = meta && meta.equipment_master_id;
      if (masterId) {
        narrowed = expenditureTypes.narrowForMaster(list, variables.expTypeMap[masterId]);

        // The row's OWN saved value always survives narrowing, even when the
        // mapping no longer contains it. oj-select-single is two-way bound to
        // the cell: a value with no matching key in its data renders blank and
        // can write null back through the binding, which would silently clear
        // an expenditure type that was recorded correctly before the mapping
        // was authored or changed. Losing saved data to a picker filter is far
        // worse than showing one extra option.
        narrowed = expenditureTypes.withCurrentValue(narrowed, list, this.getRowExpType(rowIndex));
      }
    }
    // Search on the NAME only. Without textFilterAttributes the ADP text filter
    // matches every attribute -- the numeric id and the unit too -- so typing
    // "day" would hit every Day-unit type. Typing is also how users reach past
    // the dropdown's 500-row cap: the full list is ~2,500 at Oceaneering, and
    // oj-select-single stops rendering at 500 on scroll ("Fabricated Plate
    // Assemblies" was row 500), while a typed filter searches all of them.
    return new ArrayDataProvider(narrowed, { keyAttributes: 'value', textFilterAttributes: ['label'] });
  };

  // ── Unit of measure on the expenditure type ───────────────────────
  //
  // Under PPM rates the Fusion rate line carries a UnitOfMeasureName per LINE,
  // and the same equipment can hold both a Day-based and an Hours-based line
  // (AUV OS-7 - Operational Day Rate / - Operational Hourly Rate). The picked
  // expenditure type therefore decides what the day boxes MEAN, not just how
  // they are labelled.
  //
  // EquipRite 1.0 got this wrong in a way worth not repeating: it read the unit
  // off the matched Fusion rate, stored it on the row, then never read it again
  // -- hours typed into day boxes posted against a DY rate as days.
  //
  // `uom` is OPTIONAL on the option objects. Nothing populates it yet (it comes
  // from the rate-schedule cache, which does not exist), so every helper below
  // returns null today and every caller degrades to the pre-existing behaviour.
  // The mechanism lands now, inert, and switches itself on when the cache
  // starts supplying units.
  PageModule.prototype.getExpTypeUom = function (value, variables) {
    if (!value) return null;
    var list = (variables && Array.isArray(variables.expTypeList) && variables.expTypeList.length)
      ? variables.expTypeList
      : EXP_TYPE_OPTIONS;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].value === value) return list[i].uom || null;
    }
    return null;
  };

  /** The expenditure type currently on a row, or null. */
  PageModule.prototype.getRowExpType = function (rowIndex) {
    var expOrigIdx = COLUMN_KEYS.indexOf('expenditure_type');
    var dispPos    = this._columnOrder ? this._columnOrder.indexOf(expOrigIdx) : -1;
    if (dispPos < 0 || !this._data || !this._data[rowIndex]) return null;
    var cell = this._data[rowIndex][dispPos];
    return (cell && cell.data) ? cell.data : null;
  };

  /** The unit for the row's expenditure type, or null when unknown. */
  PageModule.prototype.getRowUom = function (rowIndex, variables) {
    var expOrigIdx = COLUMN_KEYS.indexOf('expenditure_type');
    var dispPos    = this._columnOrder ? this._columnOrder.indexOf(expOrigIdx) : -1;
    if (dispPos < 0 || !this._data || !this._data[rowIndex]) return null;
    var cell = this._data[rowIndex][dispPos];
    return this.getExpTypeUom(cell ? cell.data : null, variables || this._lastVariables);
  };

  /**
   * Upper bound for an hours cell. 24 is the historical cap and stays the
   * default; a Day-based line caps at 1, because "1" means a whole day there
   * and typing 8 would bill eight days.
   */
  PageModule.prototype.getHoursMax = function (rowIndex, variables) {
    var uom = this.getRowUom(rowIndex, variables);
    if (!uom) return 24;
    var u = String(uom).toUpperCase();
    if (u === 'DAY' || u === 'DAYS' || u === 'DY') return 1;
    if (u === 'EACH' || u === 'EA')                return 99;
    return 24;
  };

  /** Step for an hours cell: quarter-hours as today, whole units otherwise. */
  PageModule.prototype.getHoursStep = function (rowIndex, variables) {
    var uom = this.getRowUom(rowIndex, variables);
    if (!uom) return 0.25;
    var u = String(uom).toUpperCase();
    return (u === 'HOURS' || u === 'HOUR' || u === 'HRS') ? 0.25 : 1;
  };

  /**
   * Hands over a pending unit-change notice, once, and clears it.
   *
   * The module cannot fire a VB notification itself and this page has no
   * message surface of its own, so the grid's inline oj-before-edit-end handler
   * drains this straight after handleEditEnd and passes it to a chain. Clearing
   * hours without saying why would be worse than not clearing at all.
   */
  PageModule.prototype.takeUomNotice = function () {
    var n = this._pendingUomNotice || null;
    this._pendingUomNotice = null;
    return n;
  };

  PageModule.prototype.getClassLOV = function() {
    return new ArrayDataProvider([
      { value: 'Light', label: 'Light' },
      { value: 'Medium', label: 'Medium' },
      { value: 'Heavy', label: 'Heavy' }
    ], { keyAttributes: 'value' });
  };

  PageModule.prototype.getStatusLOV = function() {
    return new ArrayDataProvider([
      { value: 'Draft', label: 'Draft' },
      { value: 'Pending', label: 'Pending' },
      { value: 'Allocated', label: 'Allocated' },
      { value: 'Failed', label: 'Failed' }
    ], { keyAttributes: 'value' });
  };

  PageModule.prototype.getPersonsProvider = function() {
    var options = Object.keys(this._personsMap).map(function(id) {
      return { value: id, label: this._personsMap[id] };
    }.bind(this));
    return new ArrayDataProvider(options, { keyAttributes: 'value' });
  };

  PageModule.prototype.getTimeTypeProvider = function() {
    return new ArrayDataProvider([
      { value: 'Straight', label: 'Straight' },
      { value: 'Overtime', label: 'Overtime' },
      { value: 'Double', label: 'Double' }
    ], { keyAttributes: 'value' });
  };

  // Returns null if all rows have a Rate Type value, or an error message listing the bad rows.
  PageModule.prototype.validateRateTypes = function() {
    var rateTypeOrigIdx = 3; // COLUMN_KEYS index for 'hours_type' (Rate Type)
    var dispIdx = this._columnOrder.indexOf(rateTypeOrigIdx);
    if (dispIdx < 0 || !this._allData || this._allData.length === 0) return null;

    var missing = [];
    for (var i = 0; i < this._allData.length; i++) {
      var cell = this._allData[i][dispIdx];
      var val  = cell && cell.data;
      if (!val || String(val).trim() === '') {
        missing.push(i + 1); // 1-based row numbers for the message
      }
    }
    if (missing.length === 0) return null;
    return 'Rate Type is required for row' + (missing.length > 1 ? 's' : '') + ' ' + missing.join(', ') + '. Please select a Rate Type before submitting.';
  };

  /**
   * PPM rates only (the submit chain gates the call): every LINE with hours this
   * week must carry an expenditure type the picker offers. Under PPM the hours
   * post to Fusion under that type, and a missing one is otherwise only caught
   * by Fusion -- after approval.
   *
   * The type is per request LINE, so a line passes when any of its rows holds
   * one. A line's type is its last non-empty cell, else the saved value: the
   * same rule prepareExpTypeChanges saves by (it never clears a type). A value
   * the picker does not offer (paste / fill) fails here instead of being
   * silently dropped by that save. Rows with no hours post nothing and pass.
   *
   * @param variables $page.variables, for the live LOV
   * @returns null when valid, else a message naming the 1-based rows
   */
  PageModule.prototype.validateExpenditureTypes = function (variables) {
    var self = this;
    if (!self._allData || !self._allData.length) { return null; }
    for (var s = 0; s < self._data.length; s++) { self._syncToAllData(s); }

    var expDisp = self._columnOrder.indexOf(COLUMN_KEYS.indexOf('expenditure_type'));
    var dayDisp = [9, 10, 11, 12, 13, 14, 15].map(function (o) { return self._columnOrder.indexOf(o); });

    var allowed = {};
    var lov = (variables && Array.isArray(variables.expTypeList) && variables.expTypeList.length)
      ? variables.expTypeList : EXP_TYPE_OPTIONS;
    lov.forEach(function (o) { if (o && o.value) { allowed[String(o.value)] = 1; } });

    // key = request line (rows without one stand alone)
    var lines = {}, order = [];
    for (var i = 0; i < self._allData.length; i++) {
      var row  = self._allData[i];
      var meta = self._rowMetaAll[i] || {};
      var key  = meta.request_line_id ? 'L' + meta.request_line_id : 'R' + i;
      if (!lines[key]) {
        lines[key] = { rows: [], hours: 0, type: meta.expenditure_type ? String(meta.expenditure_type) : null };
        order.push(key);
      }
      var ln = lines[key];
      ln.rows.push(i + 1);
      dayDisp.forEach(function (d) {
        var h = d >= 0 && row[d] ? parseFloat(row[d].data) : 0;
        if (h > 0) { ln.hours += h; }
      });
      var cell = expDisp >= 0 ? row[expDisp] : null;
      if (cell && cell.data !== undefined && cell.data !== null && String(cell.data).trim() !== '') {
        ln.type = String(cell.data);
      }
    }

    var missing = [], unknown = [];
    order.forEach(function (k) {
      var ln = lines[k];
      if (!ln.hours) { return; }
      if (!ln.type) { missing = missing.concat(ln.rows); }
      else if (!allowed[ln.type]) { unknown.push('row ' + ln.rows.join('/') + ' ("' + ln.type + '")'); }
    });
    if (!missing.length && !unknown.length) { return null; }

    var msg = [];
    if (missing.length) {
      msg.push('Expenditure Type is required for row' + (missing.length > 1 ? 's' : '') + ' '
        + missing.join(', ') + '.');
    }
    if (unknown.length) {
      msg.push('Not an expenditure type in the list: ' + unknown.join(', ') + '.');
    }
    return msg.join(' ') + ' Hours post to Fusion PPM under this type, so please pick one before submitting.';
  };

  // Values must match CHK_TE_ENTRY_TYPE on EQR_TIME_ENTRY. BLACKOUT was added by V267
  // for non-billable days (maintenance / breakdown / shutdown) -- tag a row BLACKOUT and
  // those days drop out of the billed period. Duplicate a row and switch its Rate Type to
  // split one day across two types.
  PageModule.prototype.getRateTypeProvider = function() {
    if (!this._rateTypeProvider) {
      this._rateTypeProvider = new ArrayDataProvider(RATE_TYPE_OPTIONS, { keyAttributes: 'value' });
    }
    return this._rateTypeProvider;
  };

  PageModule.prototype.getPayRateCodeProvider = function() {
    return this._payRateCodeProvider;
  };

  /**
   * Generates a provider with weekly ranges (e.g., "Mar 30 - Apr 5") for the dropdown.
   * Includes 4 previous weeks and 4 future weeks around the current week.
   * @param {string} currentWeekStart ISO date string (YYYY-MM-DD)
   * @returns {ArrayDataProvider}
   */
  PageModule.prototype.buildWeekRangeOptions = function (currentWeekStart) {
    if (!currentWeekStart) return new ArrayDataProvider([], { keyAttributes: 'value' });
    
    var start = new Date(currentWeekStart + 'T00:00:00');
    var options = [];
    
    for (var i = -4; i <= 4; i++) {
      var dStart = new Date(start);
      dStart.setDate(start.getDate() + (i * 7));
      
      var dEnd = new Date(dStart);
      dEnd.setDate(dStart.getDate() + 6);
      
      var startLabel = dStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      var endLabel = dEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      var year = dEnd.getFullYear();
      
      var value = dStart.toISOString().split('T')[0];
      var label = startLabel + ' - ' + endLabel + ', ' + year;
      
      options.push({ value: value, label: label });
    }
    
    return new ArrayDataProvider(options, { keyAttributes: 'value' });
  };


  // â”€â”€â”€ Editable Check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  PageModule.prototype.getIsEditable = function (cellContext) {
    var rowIndex = cellContext.indexes.row;

    // Disable editing for non-editable statuses — only DRAFT and REJECTED rows are editable
    var statusDisplayIdx = this._columnOrder.indexOf(4);
    if (statusDisplayIdx !== -1) {
      var statusCell = this._data[rowIndex] && this._data[rowIndex][statusDisplayIdx];
      var rowStatus  = statusCell && statusCell.data;
      if (rowStatus === 'APPROVED' || rowStatus === 'SUBMITTED' || rowStatus === 'POSTED') {
        return 'disable';
      }
    }

    var origIdx = this._columnOrder[cellContext.indexes.column];
    if (origIdx === COLUMN_KEYS.length) return 'disable'; // Actions
    if (COLUMN_TYPES[origIdx] === 'readonly') return 'disable';

    // For hours columns (origIdx 9–15), disable if the day falls outside the
    // equipment's requested start/end date range.
    if (origIdx >= 9 && origIdx <= 15 && this._currentWorkDate) {
      var dayOffset = origIdx - 9; // 0 = day1, 6 = day7
      var base = new Date(this._currentWorkDate + 'T00:00:00');
      base.setDate(base.getDate() + dayOffset);
      var dayDate = base.getFullYear() + '-' + String(base.getMonth() + 1).padStart(2, '0') + '-' + String(base.getDate()).padStart(2, '0');

      var row = this._data[rowIndex];
      if (row) {
        // start_date is origIdx 6, end_date is origIdx 7 — find their display positions
        var startDisplayIdx = this._columnOrder.indexOf(6);
        var endDisplayIdx   = this._columnOrder.indexOf(7);
        var startDate = startDisplayIdx >= 0 && row[startDisplayIdx] ? String(row[startDisplayIdx].data).slice(0, 10) : null;
        var endDate   = endDisplayIdx   >= 0 && row[endDisplayIdx]   ? String(row[endDisplayIdx].data).slice(0, 10)   : null;
        if (startDate && dayDate < startDate) return 'disable';
        if (endDate   && dayDate > endDate)   return 'disable';
      }
    }

    return undefined;
  };

  // â”€â”€â”€ Edit Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  PageModule.prototype.handleBeforeEdit = function (event) {
    this._originalData = Object.assign({}, event.detail.cellContext.data);
    console.log('[handleBeforeEdit] row:', event.detail.cellContext.indexes.row, 'col:', event.detail.cellContext.indexes.column, 'originalValue:', this._originalData.data);
    // Take a snapshot BEFORE two-way binding mutates the current cell's underlying data
    this._tempSnapshot = this.takeSnapshotObj();
  };

  PageModule.prototype.handleEditEnd = function (event) {
    var detail = event.detail;
    var self = this;

    console.log('[handleEditEnd] cancelEdit:', detail.cancelEdit, 'row:', detail.cellContext.indexes.row, 'col:', detail.cellContext.indexes.column);

    if (detail.cancelEdit) {
      detail.cellContext.data.data = this._originalData.data;
      return false;
    }

    var rowIndex    = detail.cellContext.indexes.row;
    var columnIndex = detail.cellContext.indexes.column;

    // {{ }} two-way binding keeps _data[row][col].data in sync as the user types.
    // Read from there rather than event.detail (which oj-input-text doesn't update
    // before oj-before-edit-end fires).
    var currentValue = (this._data[rowIndex] && this._data[rowIndex][columnIndex] !== undefined)
      ? this._data[rowIndex][columnIndex].data
      : detail.cellContext.data.data;

    console.log('[handleEditEnd] originalData:', this._originalData && this._originalData.data, 'currentValue:', currentValue);

    if (this._originalData && String(this._originalData.data) !== String(currentValue)) {
      if (this._tempSnapshot) {
        this._history.push(this._tempSnapshot);
        this._tempSnapshot = null;
      }

      this._data[rowIndex][columnIndex].data = currentValue;

      var meta = self._rowMetaFiltered[rowIndex];
      console.log('[handleEditEnd] meta:', JSON.stringify(meta));
      if (meta && meta.time_entry_line_id !== null) {
        self._modifiedIds[meta.time_entry_line_id] = true;
      }

      self._syncToAllData(rowIndex);

      var updateRanges = [{ rowOffset: rowIndex, columnOffset: columnIndex, rowCount: 1, columnCount: 1 }];

      var origIdx = self._columnOrder[columnIndex];

      // Expenditure type is per request LINE, not per week row. Duplicates share a
      // request_line_id, so write the new value onto every row of that line at once --
      // two rows of one line showing different types would be a screen that cannot be
      // true, whichever one the save happened to pick.
      //
      // MUST sit after `origIdx` and `updateRanges` are declared: both are `var`, so
      // placing this above them made the guard compare against `undefined`, which is
      // silently false. The propagation simply never ran -- a no-op, not a crash.
      //
      // Deliberately NOT marking the siblings in _modifiedIds: that would queue a
      // patchTimeEntry for each, and saveTimesheetChain writes status:'DRAFT'
      // unconditionally, so an expenditure-only edit would reset a REJECTED row.
      if (origIdx === COLUMN_KEYS.indexOf('expenditure_type') && meta && meta.request_line_id) {
        for (var q = 0; q < self._data.length; q++) {
          if (q === rowIndex) continue;
          var qm = self._rowMetaFiltered[q];
          if (!qm || Number(qm.request_line_id) !== Number(meta.request_line_id)) continue;
          self._data[q][columnIndex].data = currentValue;
          self._syncToAllData(q);
          updateRanges.push({ rowOffset: q, columnOffset: columnIndex, rowCount: 1, columnCount: 1 });
        }

        // A change of expenditure type can be a change of UNIT -- the same
        // equipment may carry both an Operational DAY line and an Operational
        // HOURLY one. The numbers already in the row were typed against the old
        // unit, so leaving them would silently reinterpret them: 8 entered as
        // hours becomes 8 days, a 24x error, which is exactly what 1.0 shipped.
        //
        // Clearing is the conservative half of that trade. Retyping four numbers
        // is cheap; discovering the overcharge after it has posted is not.
        // No unit on either side (the case today, since nothing populates one)
        // -> nothing is cleared and this block is a no-op.
        var prevUom = self.getExpTypeUom(self._originalData ? self._originalData.data : null, self._lastVariables);
        var nextUom = self.getExpTypeUom(currentValue, self._lastVariables);
        if (prevUom && nextUom && prevUom !== nextUom) {
          for (var h = HOURS_FIRST_ORIG_IDX; h <= HOURS_LAST_ORIG_IDX; h++) {
            var hPos = self._columnOrder.indexOf(h);
            if (hPos < 0) continue;
            for (var hr = 0; hr < self._data.length; hr++) {
              var hm = self._rowMetaFiltered[hr];
              if (!hm || Number(hm.request_line_id) !== Number(meta.request_line_id)) continue;
              if (!Number(self._data[hr][hPos].data)) continue;
              self._data[hr][hPos].data = 0;
              self._syncToAllData(hr);
              updateRanges.push({ rowOffset: hr, columnOffset: hPos, rowCount: 1, columnCount: 1 });
            }
          }
          self._pendingUomNotice = { from: prevUom, to: nextUom };
        }
      }

      // Person selection: sync meta.person_id and person_code
      if (origIdx === PERSON_ORIG_IDX) {
        if (meta) meta.person_id = currentValue;
        var personCodeStr = self.getPersonCode(currentValue);
        var pCodeDispPos = self._columnOrder.indexOf(0);
        if (pCodeDispPos >= 0) {
          self._data[rowIndex][pCodeDispPos].data = personCodeStr;
          updateRanges.push({ rowOffset: rowIndex, columnOffset: pCodeDispPos, rowCount: 1, columnCount: 1 });
        }
      }

      // Combination auto-populate
      if (origIdx === COMBO_ORIG_IDX) {
        var combo = self._combinationsMap[currentValue];
        if (combo) {
          if (meta) {
            meta.project_id = (combo.project_id !== null && combo.project_id !== undefined) ? combo.project_id : null;
            meta.task_id    = (combo.task_id    !== null && combo.task_id    !== undefined) ? combo.task_id    : null;
          }
          Object.keys(COMBO_AUTO_COLS).forEach(function (fieldName) {
            // Resolve by KEY NAME, not by COMBO_AUTO_COLS' hardcoded index. Those
            // indices belong to the crew-labor key list, and several exceed this
            // grid's COLUMN_KEYS -- trade_name is 16, which used to land on the
            // Actions column (harmless: it renders a button, not cell data) and
            // now lands on expenditure_type, which would silently overwrite it.
            // This is the pattern the equipment grid already uses below.
            var autoOrigIdx  = COLUMN_KEYS.indexOf(fieldName);
            if (autoOrigIdx === -1) return;
            var autoDispPos  = self._columnOrder.indexOf(autoOrigIdx);
            if (autoDispPos >= 0) {
              var val = combo[fieldName];
              self._data[rowIndex][autoDispPos].data = (val !== null && val !== undefined) ? val : '';
              updateRanges.push({ rowOffset: rowIndex, columnOffset: autoDispPos, rowCount: 1, columnCount: 1 });
            }
          });
          self._syncToAllData(rowIndex);
        }
      }

      if (this._dataGridProvider) {
        this._dataGridProvider.doUpdate({ ranges: updateRanges, version: 0 });
      }

      this._calculateOverallTotals();
      return true;
    }
    return false;
  };

  // â”€â”€â”€ Add Row â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  PageModule.prototype.addRow = function () {
    var self = this;
    this.saveSnapshot();

    // Build a blank row in original COLUMN_KEYS order
    var baseRow = COLUMN_TYPES.map(function (type) {
      if (type === 'number') return { data: 0 };
      return { data: '' };
    });
    baseRow.push({ data: '' }); // Actions placeholder

    // Re-order to match the current display column order
    var newRow = self._columnOrder.map(function (origIdx) {
      return { data: baseRow[origIdx].data };
    });

    var rowIndex = self._data.length;
    this._data.push(newRow);
    this._rowHeaders[0].push(rowIndex + 1);
    var newMeta = {
      time_entry_line_id: null,
      person_id:    null,
      time_card_id: self._currentTimeCardId,
      work_date:    self._currentWorkDate,
      crew_id:      self._currentCrewId,
      project_id:   null,
      task_id:      null,
      request_line_id: null
    };
    this._addToAllData(newRow, newMeta, rowIndex);

    if (this._dataGridProvider) {
      this._dataGridProvider.doAdd({
        axis: 'row',
        ranges: [{ offset: rowIndex, count: 1 }],
        version: 0
      });
    }
    return true;
  };

  // â”€â”€â”€ Duplicate Row â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  PageModule.prototype.duplicateRow = function (rowIndex) {
    if (rowIndex < 0 || rowIndex >= this._data.length) return false;
    this.saveSnapshot();

    var self = this;
    var sourceRow = this._data[rowIndex];
    var actionsDisplayPos = this._columnOrder.indexOf(COLUMN_KEYS.length);
    // Copy the row's context (equipment, dates, task) but NOT its hours. The copy
    // exists to record a different rate type on specific days -- e.g. Monday as
    // Blackout -- so it starts empty and the user fills in only the affected days.
    var newRow = sourceRow.map(function (cell, colIdx) {
      if (colIdx === actionsDisplayPos) return { data: '' };
      var origIdx = self._columnOrder[colIdx];
      // Empty hours must be null, NOT ''. These cells render as oj-input-number,
      // which rejects a string value ("Invalid type 'string' found for property
      // 'value'") -- the binding throws, the editor never renders, and the failed
      // re-render paints stray cells on neighbouring rows.
      if (origIdx >= HOURS_FIRST_ORIG_IDX && origIdx <= HOURS_LAST_ORIG_IDX) return { data: null };
      return { data: cell.data };
    });
    var sourceMeta = self._rowMetaFiltered[rowIndex] || {};
    var newMeta = {
      time_entry_line_id: null,
      person_id:    sourceMeta.person_id    || null,
      time_card_id: sourceMeta.time_card_id || self._currentTimeCardId,
      work_date:    sourceMeta.work_date    || self._currentWorkDate,
      crew_id:      sourceMeta.crew_id      || self._currentCrewId,
      project_id:   sourceMeta.project_id  || null,
      task_id:      sourceMeta.task_id     || null,
      // Carry the source line forward: a duplicate is the SAME rental line under a
      // different rate type (e.g. splitting a day into Usage + Blackout), not a new
      // line. saveTimesheetChain skips any CREATE with no request_line_id, so nulling
      // it here made duplicated rows vanish on save with only a console warning.
      // time_entry_line_id stays null -- that is what marks the row as a CREATE.
      request_line_id: sourceMeta.request_line_id || null,
      // Inherit the expenditure-type baseline too. Without it every duplicate reads
      // as a change against a null baseline and re-PATCHes a line that never changed.
      expenditure_type: sourceMeta.expenditure_type || null,
      // Same equipment as the row it was duplicated from, so it must offer the same
      // narrowed expenditure types. Dropping this would only widen the duplicate's
      // picker back to the full list, but the two rows are the same rental line and
      // showing different options on them would look like a bug.
      equipment_master_id: sourceMeta.equipment_master_id || null
    };

    var insertAt = rowIndex + 1;
    this._data.splice(insertAt, 0, newRow);
    // Insert the row-number header AT the same position, then renumber. Pushing the
    // new number onto the end left index insertAt still holding the old value, so
    // after doAdd -- which re-reads only the inserted row and shifts the rest -- the
    // numbers rendered as 1, 2, 2.
    this._rowHeaders[0].splice(insertAt, 0, 0);
    this._renumberRowHeaders();
    this._addToAllData(newRow, newMeta, insertAt);

    if (this._dataGridProvider) {
      // Must be a full refresh, NOT doAdd(). doAdd makes the grid shift its cached
      // row headers down and fetch only the inserted row -- it never re-reads the
      // rows below. That is right for stable keys but wrong for a positional 1..n
      // row-number column, where every row below the insert changes: the new row
      // and the one it displaced both render the same number.
      // Clearing focus first is what removes the phantom edit cell that a plain
      // refresh would otherwise leave behind on stale coordinates.
      this._clearGridFocus();
      this._dataGridProvider._setTotalCounts();
      this._dataGridProvider.doRefresh();
    }
    return true;
  };

  // â”€â”€â”€ Delete Row â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // Row-number column is always a plain 1..n sequence, so rebuild it after any
  // structural change rather than trying to patch individual entries.
  PageModule.prototype._renumberRowHeaders = function () {
    var hdr = this._rowHeaders && this._rowHeaders[0];
    if (!hdr) return;
    for (var r = 0; r < hdr.length; r++) { hdr[r] = r + 1; }
  };

  // Drop the grid's active cell and selection before a structural refresh. Those are
  // stored as row/column coordinates, so after inserting or removing a row they point
  // at whatever now occupies that index -- which paints as a phantom edit cell on a
  // neighbouring row.
  PageModule.prototype._clearGridFocus = function () {
    var grid = document.getElementById('datagrid');
    if (!grid) return;
    try { grid.currentCell = null; } catch (e) { /* element not upgraded yet */ }
    try { grid.selection = []; } catch (e) { /* element not upgraded yet */ }
  };

  // A row is a duplicate if an earlier row in the grid already covers the same request
  // line. The first row for a line is the parent -- it is generated from the deployed
  // request line, so deleting it is meaningless (it returns on the next refresh).
  PageModule.prototype.isDuplicateRow = function (rowIndex) {
    if (rowIndex < 0 || rowIndex >= this._data.length) return false;
    var meta = this._rowMetaFiltered[rowIndex];
    if (!meta || !meta.request_line_id) return true; // ad-hoc row, not tied to a line
    for (var i = 0; i < rowIndex; i++) {
      var prev = this._rowMetaFiltered[i];
      if (prev && prev.request_line_id === meta.request_line_id) return true;
    }
    return false;
  };

  PageModule.prototype.deleteRow = function (rowIndex) {
    if (rowIndex < 0 || rowIndex >= this._data.length) return false;
    // Backstop for the disabled menu item -- never drop a parent line.
    if (!this.isDuplicateRow(rowIndex)) {
      console.warn('[deleteRow] refusing to delete parent row', rowIndex);
      return false;
    }
    this.saveSnapshot();

    var meta = this._rowMetaFiltered[rowIndex];
    if (meta && meta.time_entry_line_id !== null) {
      this._deletedIds.push(meta.time_entry_line_id);
      delete this._modifiedIds[meta.time_entry_line_id];
    }

    this._deleteFromAllData(rowIndex);
    this._data.splice(rowIndex, 1);
    // Remove the header AT rowIndex (not the last one) then renumber, for the same
    // reason duplicateRow splices rather than pushes.
    this._rowHeaders[0].splice(rowIndex, 1);
    this._renumberRowHeaders();

    if (this._dataGridProvider) {
      // Same reasoning as duplicateRow: full refresh, not doRemove().
      this._clearGridFocus();
      this._dataGridProvider._setTotalCounts();
      this._dataGridProvider.doRefresh();
    }
    return true;
  };

  // â”€â”€â”€ Absence Balance Lookup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Returns the person code + person name from a given row index.
   * Column index 0 = person_code (display code like "PR-221").
   * Column index 1 = person_name but actually stores person_id;
   *   the display name is resolved via _personsMap (same as getPersonName).
   */
  PageModule.prototype.getPersonNameFromRow = function (rowIndex) {
    if (this._data && rowIndex >= 0 && rowIndex < this._data.length) {
      var personCodeCell = this._data[rowIndex][0]; // person_code column (display code)
      var personIdCell   = this._data[rowIndex][1]; // person_name column (stores person_id)
      var code = (personCodeCell && personCodeCell.data) ? String(personCodeCell.data) : '';
      var personId = (personIdCell && personIdCell.data) ? personIdCell.data : null;
      var name = this.getPersonName(personId); // resolve via _personsMap
      if (code && name && name !== String(personId)) {
        return code + ' â€” ' + name;
      }
      return code || name || 'Unknown Person';
    }
    return 'Unknown Person';
  };

  // â”€â”€â”€ Batch Operations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  PageModule.prototype.selectionChange = function (selection) {
    if (!selection || selection.length === 0) {
      return { inputTextValue: '', updateDisabled: true, addRemoveDisabled: true };
    }

    // Cache the non-empty selection so updateSelection can use it even if the
    // VBCS variable is cleared by the button-focus event before the chain fires.
    this._lastSelection = selection;

    // Attempt to grab current active cell value
    var inputTextValue = '';
    var datagrid = document.getElementById('datagrid');
    if (datagrid && datagrid.currentCell && datagrid.currentCell.type === 'cell') {
      var row = datagrid.currentCell.indexes.row;
      var col = datagrid.currentCell.indexes.column;
      if (this._data[row] && this._data[row][col]) {
        inputTextValue = this._data[row][col].data;
      }
    }

    return {
      inputTextValue: inputTextValue,
      updateDisabled: false,
      addRemoveDisabled: false
    };
  };

  PageModule.prototype.updateSelection = function (selection, inputTextValue) {
    // Fall back to the last known selection if VBCS cleared it before this chain ran
    // (happens when button focus causes datagrid to fire selection-changed first).
    var effectiveSelection = (selection && selection.length > 0) ? selection : this._lastSelection;
    if (!effectiveSelection || effectiveSelection.length === 0) return false;

    // If the passed inputTextValue is empty but selection is valid, try to read
    // the live value directly from the DOM input to recover from the race condition.
    var effectiveValue = inputTextValue;
    if ((effectiveValue === '' || effectiveValue === null || effectiveValue === undefined) &&
        selection && selection.length === 0 && this._lastSelection) {
      var inputEl = document.getElementById('bulkUpdateInput');
      if (inputEl && inputEl.rawValue !== undefined) {
        effectiveValue = inputEl.rawValue;
      } else if (inputEl && inputEl.value !== undefined) {
        effectiveValue = inputEl.value;
      }
    }

    var self = this;
    this.saveSnapshot();
    var isDirty = false;

    effectiveSelection.forEach(function (value) {
      var startRow = value.startIndex.row || 0;
      var startColumn = value.startIndex.column || 0;
      var endRow = value.endIndex.row === -1 ? self._data.length - 1 : value.endIndex.row;
      var endColumn = value.endIndex.column === -1 ? self._columnOrder.length - 1 : value.endIndex.column;

      for (var i = startRow; i <= endRow; i++) {
        for (var j = startColumn; j <= endColumn; j++) {
          var origColIdx = self._columnOrder[j];
          // Skip actions and readonly columns
          if (origColIdx === COLUMN_KEYS.length) continue;
          if (COLUMN_TYPES[origColIdx] === 'readonly') continue;

          var oldVal = self._data[i][j].data;
          if (String(oldVal) !== String(effectiveValue)) {
            self._data[i][j].data = effectiveValue;
            var rowMeta = self._rowMetaFiltered[i];
            if (rowMeta && rowMeta.time_entry_line_id !== null) {
              self._modifiedIds[rowMeta.time_entry_line_id] = true;
            }
            self._syncToAllData(i);
            isDirty = true;
          }
        }
      }
    });

    if (isDirty && self._dataGridProvider) {
      self._dataGridProvider._setTotalCounts();
      self._dataGridProvider.doRefresh();
    }
    return isDirty;
  };

  PageModule.prototype.removeSelection = function (selection) {
    if (!selection || selection.length === 0) return false;

    var self = this;
    this.saveSnapshot();
    var indexesToRemove = new Set();
    selection.forEach(function (value) {
      var startRow = value.startIndex.row || 0;
      var endRow = value.endIndex.row === -1 ? self._data.length - 1 : value.endIndex.row;
      for (var i = startRow; i <= endRow; i++) {
        indexesToRemove.add(i);
      }
    });

    var indexesToRemoveArray = Array.from(indexesToRemove).sort(function(a, b){return b-a});
    var isDirty = false;

    // Loop from bottom to top so array splicing doesn't mess up indexes
    indexesToRemoveArray.forEach(function (index) {
      if (index >= 0 && index < self._data.length) {
        var meta = self._rowMetaFiltered[index];
        if (meta && meta.time_entry_line_id !== null) {
          self._deletedIds.push(meta.time_entry_line_id);
          delete self._modifiedIds[meta.time_entry_line_id];
        }
        self._deleteFromAllData(index); // also removes from _rowMetaFiltered at index
        self._rowHeaders[0].splice(index, 1);
        self._data.splice(index, 1);
        isDirty = true;
      }
    });

    if (isDirty && self._dataGridProvider) {
      // Fix row headers sequence
      for(var r=0; r<self._rowHeaders[0].length; r++) { self._rowHeaders[0][r] = r+1; }
      self._dataGridProvider._setTotalCounts();
      self._dataGridProvider.doRefresh();
    }
    return isDirty;
  };

  PageModule.prototype.addSelection = function (selection) {
    if (!selection || selection.length === 0) return false;

    var self = this;
    this.saveSnapshot();
    var indexesToDuplicate = new Set();
    selection.forEach(function (value) {
      var startRow = value.startIndex.row || 0;
      var endRow = value.endIndex.row === -1 ? self._data.length - 1 : value.endIndex.row;
      for (var i = startRow; i <= endRow; i++) {
        indexesToDuplicate.add(i);
      }
    });

    var indexesToDuplicateArray = Array.from(indexesToDuplicate).sort(function(a, b){return b-a});
    var isDirty = false;

    // Loop from bottom to top so array splicing doesn't mess up indexes
    indexesToDuplicateArray.forEach(function (duplicateIndex) {
      if (duplicateIndex >= 0 && duplicateIndex < self._data.length) {
        var sourceRow = self._data[duplicateIndex];
        var actionsDisplayPos = self._columnOrder.indexOf(COLUMN_KEYS.length);
        var newRow = sourceRow.map(function (cell, colIdx) {
          if (colIdx === actionsDisplayPos) return { data: '' };
          return { data: cell.data };
        });
        var srcMeta = self._rowMetaFiltered[duplicateIndex] || {};
        var newMeta = {
          time_entry_line_id: null,
          person_id:    srcMeta.person_id    || null,
          time_card_id: srcMeta.time_card_id || self._currentTimeCardId,
          work_date:    srcMeta.work_date    || self._currentWorkDate,
          crew_id:      srcMeta.crew_id      || self._currentCrewId,
          project_id:   srcMeta.project_id  || null,
          task_id:      srcMeta.task_id     || null,
          request_line_id: null
        };
        var insertAt = duplicateIndex + 1;
        self._rowHeaders[0].splice(insertAt, 0, self._rowHeaders[0][duplicateIndex]);
        self._data.splice(insertAt, 0, newRow);
        self._addToAllData(newRow, newMeta, insertAt);
        isDirty = true;
      }
    });

    if (isDirty && self._dataGridProvider) {
      // Fix row headers sequence
      for(var r=0; r<self._rowHeaders[0].length; r++) { self._rowHeaders[0][r] = r+1; }
      self._dataGridProvider._setTotalCounts();
      self._dataGridProvider.doRefresh();
    }
    return isDirty;
  };

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // Data Transfer Operations (Cut, Copy, Paste, Fill)
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  PageModule.prototype._getDataFromRange = function (range) {
    var startRow = range.startIndex.row;
    var startColumn = range.startIndex.column;
    var endRow = range.endIndex.row === -1 ? this._data.length - 1 : range.endIndex.row;
    var endColumn = range.endIndex.column === -1 ? COLUMN_KEYS.length - 1 : range.endIndex.column;
    
    var dataMatrix = [];
    for (var i = startRow; i <= endRow; i++) {
      var rowArray = [];
      for (var j = startColumn; j <= endColumn; j++) {
        rowArray.push(this._data[i][j].data);
      }
      dataMatrix.push(rowArray);
    }
    return dataMatrix;
  };

  PageModule.prototype._writeToClipboard = function (event) {
    var dataMatrix = this._getDataFromRange(event.detail.sourceRange);
    var clipboardData = dataMatrix.map(function (row) {
      return row.join('\t');
    }).join('\n');

    return navigator.clipboard.writeText(clipboardData);
  };

  PageModule.prototype.handleCopy = function (event) {
    this._writeToClipboard(event);
  };

  PageModule.prototype.handleCut = function (event) {
    var self = this;
    var sourceRange = event.detail.sourceRange;
    
    this._writeToClipboard(event).then(function() {
      // Clear out the source range (but do not clear ID [0] or Actions [7])
      var startRow = sourceRange.startIndex.row;
      var startColumn = sourceRange.startIndex.column;
      var endRow = sourceRange.endIndex.row === -1 ? self._data.length - 1 : sourceRange.endIndex.row;
      var endColumn = sourceRange.endIndex.column === -1 ? COLUMN_KEYS.length - 1 : sourceRange.endIndex.column;

      self.saveSnapshot();
      var isDirty = false;
      for (var i = startRow; i <= endRow; i++) {
        for (var j = startColumn; j <= endColumn; j++) {
          var origColIdx = self._columnOrder[j];
          if (origColIdx === COLUMN_KEYS.length) continue;
          if (COLUMN_TYPES[origColIdx] === 'readonly') continue;
          if (String(self._data[i][j].data) !== "") {
            self._data[i][j].data = "";
            var cutMeta = self._rowMetaFiltered[i];
            if (cutMeta && cutMeta.time_entry_line_id !== null) {
              self._modifiedIds[cutMeta.time_entry_line_id] = true;
            }
            self._syncToAllData(i);
            isDirty = true;
          }
        }
      }

      if (isDirty && self._dataGridProvider) {
        self._dataGridProvider.doUpdate({
          ranges: [{
            rowOffset: startRow,
            columnOffset: startColumn,
            rowCount: endRow - startRow + 1,
            columnCount: endColumn - startColumn + 1
          }],
          version: 0
        });
      }
    });

    return true; // flag as dirty in the JSON chain
  };

  PageModule.prototype.handlePaste = function (event) {
    var self = this;
    var action = event.detail.action; // 'copy' or 'cut'

    return navigator.clipboard.readText().then(function (clipboardData) {
      // Deconstruct the clipboard TSV data to a 2D array
      var rows = clipboardData.replace(/(\r\n|\n|\r)$/, '').split(/\r\n|\n|\r/g);
      var matrix = rows.map(function (row) {
        return row.split(/\t/g);
      });

      var pasteRowCount = matrix.length;
      var pasteColumnCount = matrix[0].length;
      var targetRange = event.detail.targetRange;
      
      var rowPasteOffset = targetRange.startIndex.row;
      var columnPasteOffset = targetRange.startIndex.column;
      var rowPasteEnd = targetRange.startIndex.row + pasteRowCount - 1;
      var columnPasteEnd = targetRange.startIndex.column + pasteColumnCount - 1;
      
      var eventRanges = [];
      var isDirty = false;

      self.saveSnapshot();
      // Ensure we don't paste out of bounds of our grid
      rowPasteEnd = Math.min(rowPasteEnd, self._data.length - 1);
      columnPasteEnd = Math.min(columnPasteEnd, COLUMN_KEYS.length - 1);

      for (var i = rowPasteOffset; i <= rowPasteEnd; i++) {
        for (var j = columnPasteOffset; j <= columnPasteEnd; j++) {
          var origColIdx = self._columnOrder[j];
          // Do not paste over Actions or readonly columns
          if (origColIdx === COLUMN_KEYS.length) continue;
          if (COLUMN_TYPES[origColIdx] === 'readonly') continue;

          var matrixRow = (i - targetRange.startIndex.row) % pasteRowCount;
          var matrixColumn = (j - targetRange.startIndex.column) % pasteColumnCount;

          var newValue = matrix[matrixRow][matrixColumn];
          if (String(self._data[i][j].data) !== String(newValue)) {
            self._data[i][j].data = newValue;
            var pasteMeta = self._rowMetaFiltered[i];
            if (pasteMeta && pasteMeta.time_entry_line_id !== null) {
              self._modifiedIds[pasteMeta.time_entry_line_id] = true;
            }
            self._syncToAllData(i);
            isDirty = true;
          }
        }
      }

      eventRanges.push({
        rowOffset: rowPasteOffset,
        columnOffset: columnPasteOffset,
        rowCount: rowPasteEnd - rowPasteOffset + 1,
        columnCount: columnPasteEnd - columnPasteOffset + 1
      });

      if (isDirty && self._dataGridProvider) {
        self._dataGridProvider.doUpdate({ ranges: eventRanges, version: 0 });

        // Update selection range visually
        var datagrid = document.getElementById('datagrid');
        if (datagrid) {
          datagrid.selection = [{
            startIndex: { row: rowPasteOffset, column: columnPasteOffset },
            endIndex: { row: rowPasteEnd, column: columnPasteEnd }
          }];
        }
      }
      return isDirty;
    });
  };

  PageModule.prototype.handleFill = function (event) {
    var self = this;
    var sourceRange = event.detail.sourceRange;
    var targetRange = event.detail.targetRange;

    var fillMatrix = this._getDataFromRange(sourceRange);
    var fillRowOffset = targetRange.startIndex.row;
    var fillRowEnd = targetRange.endIndex.row === -1 ? self._data.length - 1 : targetRange.endIndex.row;
    var fillColumnOffset = targetRange.startIndex.column;
    var fillColumnEnd = targetRange.endIndex.column === -1 ? COLUMN_KEYS.length - 1 : targetRange.endIndex.column;

    var fillRowCount = fillMatrix.length;
    var fillColumnCount = fillMatrix[0].length;
    var isDirty = false;
    var hasComboFill = false;
    this.saveSnapshot();

    // Constrain to grid boundaries
    fillRowEnd = Math.min(fillRowEnd, self._data.length - 1);
    fillColumnEnd = Math.min(fillColumnEnd, COLUMN_KEYS.length - 1);

    for (var i = fillRowOffset; i <= fillRowEnd; i++) {
      for (var j = fillColumnOffset; j <= fillColumnEnd; j++) {
        var origColIdx = self._columnOrder[j];
        // Do not fill Actions or readonly columns
        if (origColIdx === COLUMN_KEYS.length) continue;
        if (COLUMN_TYPES[origColIdx] === 'readonly') continue;

        var matrixRow = Math.abs(i - targetRange.startIndex.row) % fillRowCount;
        var matrixColumn = Math.abs(j - targetRange.startIndex.column) % fillColumnCount;

        // Reverse direction mapping if filling upwards/leftwards
        if (fillRowOffset < sourceRange.startIndex.row) {
          matrixRow = fillRowCount - matrixRow - 1;
        }
        if (fillColumnOffset < sourceRange.startIndex.column) {
          matrixColumn = fillColumnCount - matrixColumn - 1;
        }

        var newValue = fillMatrix[matrixRow][matrixColumn];
        if (String(self._data[i][j].data) !== String(newValue)) {
          self._data[i][j].data = newValue;
          var fillMeta = self._rowMetaFiltered[i];
          if (fillMeta && fillMeta.time_entry_line_id !== null) {
            self._modifiedIds[fillMeta.time_entry_line_id] = true;
          }

          // Auto-populate combination fields when the combination column is filled
          if (origColIdx === COMBO_ORIG_IDX) {
            hasComboFill = true;
            var combo = self._combinationsMap[newValue];
            if (combo) {
              if (fillMeta) {
                fillMeta.project_id = (combo.project_id !== null && combo.project_id !== undefined) ? combo.project_id : null;
                fillMeta.task_id    = (combo.task_id    !== null && combo.task_id    !== undefined) ? combo.task_id    : null;
              }
              Object.keys(COMBO_AUTO_COLS).forEach(function (fieldName) {
                // By key name, not COMBO_AUTO_COLS' index -- see the note on the
                // other copy of this loop above.
                var autoOrigIdx = COLUMN_KEYS.indexOf(fieldName);
                if (autoOrigIdx === -1) return;
                var autoDispPos = self._columnOrder.indexOf(autoOrigIdx);
                if (autoDispPos >= 0) {
                  var val = combo[fieldName];
                  self._data[i][autoDispPos].data = (val !== null && val !== undefined) ? val : '';
                }
              });
            }
          }

          self._syncToAllData(i);
          isDirty = true;
        }
      }
    }

    if (isDirty && self._dataGridProvider) {
      // When combination was filled, expand the update range to cover all columns
      // so auto-populated fields outside the drag selection are refreshed in the grid
      var updateColOffset = hasComboFill ? 0 : fillColumnOffset;
      var updateColCount  = hasComboFill ? self._columnOrder.length : fillColumnEnd - fillColumnOffset + 1;
      self._dataGridProvider.doUpdate({
        ranges: [{
          rowOffset: fillRowOffset,
          columnOffset: updateColOffset,
          rowCount: fillRowEnd - fillRowOffset + 1,
          columnCount: updateColCount
        }],
        version: 0
      });

      // Update selection range visually
      var selectionRowStart = Math.min(sourceRange.startIndex.row, fillRowOffset);
      var selectionRowEnd = Math.max(sourceRange.endIndex.row, fillRowEnd);
      var selectionColumnStart = Math.min(sourceRange.startIndex.column, fillColumnOffset);
      var selectionColumnEnd = Math.max(sourceRange.endIndex.column, fillColumnEnd);
      
      var datagrid = document.getElementById('datagrid');
      if (datagrid) {
        datagrid.selection = [{
          startIndex: { row: selectionRowStart, column: selectionColumnStart },
          endIndex: { row: selectionRowEnd, column: selectionColumnEnd }
        }];
      }
    }
    return isDirty;
  };

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // Save â€” Change Set Preparation & Queue Processing
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  /**
   * Force-commits any active cell edit in the labor grid before the save
   * chain reads _modifiedIds. Without this, clicking Save steals focus and
   * the grid exits via the cancel path (detail.cancelEdit = true), so
   * handleEditEnd never marks the row dirty.
   */
  PageModule.prototype.commitActiveEdit = function () {
    var grid = document.getElementById('datagrid');
    if (!grid) return;

    var currentCell = grid.currentCell;
    if (!currentCell || currentCell.type !== 'cell' || grid.editMode !== 'cellEdit') return;

    var rowIndex = currentCell.indexes.row;
    var colIndex = currentCell.indexes.column;

    // Must be the editor INSIDE the active cell. grid.querySelector() returns the
    // first input anywhere in the grid, whose value belongs to a different row --
    // committing that into the current cell's coordinates moves one row's hours
    // onto another. Resolve via the focused element instead, and if that cannot be
    // established, commit nothing: the {{ }} two-way binding has already kept
    // _data in sync, so writing a guessed value can only corrupt it.
    var focused = document.activeElement;
    var activeInput = (focused && grid.contains(focused) && focused.closest)
      ? focused.closest('oj-input-number, oj-input-text, oj-select-single')
      : null;
    if (activeInput) {
      var liveValue = (activeInput.rawValue !== undefined) ? activeInput.rawValue : activeInput.value;
      if (liveValue !== undefined && liveValue !== null &&
          this._data[rowIndex] && this._data[rowIndex][colIndex] !== undefined) {

        var oldVal = this._originalData ? this._originalData.data : undefined;
        if (oldVal === undefined || String(oldVal) !== String(liveValue)) {
          this._data[rowIndex][colIndex].data = liveValue;
          var meta = this._rowMetaFiltered[rowIndex];
          if (meta && meta.time_entry_line_id !== null) {
            this._modifiedIds[meta.time_entry_line_id] = true;
          }
          this._syncToAllData(rowIndex);
        }
      }
    }

    try { grid.setProperty('editMode', 'none'); } catch(e) {}
    try { grid.setProperty('editMode', 'cellEdit'); } catch(e) {}
  };

  /**
   * Called first by the save chain. Builds the pending operation queues
   * from the tracked changes.
   */

  /**
   * Per-LINE expenditure-type changes, as [{requestLineId, expenditureType}].
   *
   * Independent of _modifiedIds on purpose. That map is keyed by time_entry_line_id
   * and handleEditEnd only populates it when a row already HAS a time entry -- which
   * most rows do not (only 45 of 545 post-cost rows carry one). Diffing each cell
   * against the baseline captured at load is the only derivation that sees a type set
   * on a line with no hours booked, which is the normal case and precisely the
   * "add it through a timesheet" path.
   *
   * @param variables $page.variables, for validating against the live LOV
   */
  PageModule.prototype.prepareExpTypeChanges = function (variables) {
    var self = this;
    self._pendingExpTypes = [];

    var origIdx = COLUMN_KEYS.indexOf('expenditure_type');
    var dispIdx = self._columnOrder.indexOf(origIdx);
    if (dispIdx < 0 || !self._allData.length) { return []; }   // column dragged out

    // _allData is stored in DISPLAY order, so read at dispIdx -- same resolution
    // shape validateRateTypes uses. Sync first: a dropdown edit may not have fired
    // handleEditEnd yet when Save steals focus.
    for (var s = 0; s < self._data.length; s++) { self._syncToAllData(s); }

    // Only values the picker actually offers. Paste/fill write raw text into cells,
    // and an unvalidated typo would reach EQR_REQUEST_LINE and then fail at OIC
    // submit -- AFTER the week has been recorded as posted locally.
    var allowed = {};
    var lov = (variables && Array.isArray(variables.expTypeList) && variables.expTypeList.length)
      ? variables.expTypeList : EXP_TYPE_OPTIONS;
    lov.forEach(function (o) { if (o && o.value) { allowed[String(o.value)] = 1; } });

    var byLine = {}, rejected = [];
    for (var i = 0; i < self._allData.length; i++) {
      var meta = self._rowMetaAll[i];
      if (!meta || !meta.request_line_id) { continue; }
      var cell = self._allData[i][dispIdx];
      var cur  = (cell && cell.data !== undefined && cell.data !== null && cell.data !== '')
                   ? String(cell.data) : null;
      if (cur === (meta.expenditure_type || null)) { continue; }  // unchanged
      if (cur === null) { continue; }                             // never clear from here
      if (!allowed[cur]) { rejected.push(cur); continue; }
      byLine[meta.request_line_id] = cur;                         // last row of a line wins
    }
    if (rejected.length) {
      console.warn('[prepareExpTypeChanges] ignoring %d value(s) not in the picker:',
        rejected.length, rejected);
    }

    self._pendingExpTypes = Object.keys(byLine).map(function (lid) {
      return { requestLineId: Number(lid), expenditureType: byLine[lid] };
    });
    return self._pendingExpTypes;
  };

  /**
   * Move the baseline after a successful PATCH, so a second Save is a no-op even
   * when the post-save re-fetch fails and the old metas survive.
   */
  PageModule.prototype.commitExpTypeBaseline = function (requestLineId, value) {
    for (var i = 0; i < this._rowMetaAll.length; i++) {
      var m = this._rowMetaAll[i];
      if (m && Number(m.request_line_id) === Number(requestLineId)) { m.expenditure_type = value; }
    }
    for (var j = 0; j < this._rowMetaFiltered.length; j++) {
      var f = this._rowMetaFiltered[j];
      if (f && Number(f.request_line_id) === Number(requestLineId)) { f.expenditure_type = value; }
    }
  };

  PageModule.prototype.prepareChangeSets = function () {
    var self = this;

    console.log('[prepareChangeSets] _allData length:', self._allData.length);
    console.log('[prepareChangeSets] _rowMetaAll length:', self._rowMetaAll.length);
    console.log('[prepareChangeSets] _modifiedIds:', JSON.stringify(self._modifiedIds));
    console.log('[prepareChangeSets] _deletedIds:', JSON.stringify(self._deletedIds));

    // 0) Push every visible row into _allData first.
    // _data is what the user sees and is kept live by the {{ }} two-way binding, but
    // _allData -- which is what we actually save from -- is only refreshed by
    // _syncToAllData() inside handleEditEnd/commitActiveEdit. If either fails to fire
    // (dropdown changes, or an edit still open when Save is clicked) the two drift, and
    // the row saves with its pre-edit values: a duplicated row would go out with the
    // hours it was created with (none, so it gets skipped as empty) and its original
    // rate type instead of BLACKOUT. Syncing here makes "what is on screen" the thing
    // that gets saved, regardless of which edit events fired.
    for (var s = 0; s < self._data.length; s++) {
      self._syncToAllData(s);
    }

    // 1) Pending deletes â€” IDs of rows that were deleted
    self._pendingDeletes = self._deletedIds.slice();

    // 2) Walk master data to find updates and creates (so filtered-out edits aren't lost)
    self._pendingUpdates = [];
    self._pendingCreates = [];

    for (var i = 0; i < self._allData.length; i++) {
      var row  = self._allData[i];
      var meta = self._rowMetaAll[i];
      if (!meta) continue;

      // Build body from visible columns (skip Actions and display-only person_name)
      var body = {};
      for (var k = 0; k < self._columnOrder.length; k++) {
        var origColIdx = self._columnOrder[k];
        if (origColIdx === COLUMN_KEYS.length) continue;  // skip Actions
        var fieldName = COLUMN_KEYS[origColIdx];
        if (COLS_SKIP_SAVE[fieldName]) continue;          // display-only / system fields
        var cellVal = row[k].data;
        body[fieldName] = (cellVal === '') ? null : cellVal;
      }
      // Add meta fields that are not in the grid columns
      body.person_id    = meta.person_id;
      body.work_date    = meta.work_date;
      body.crew_id      = meta.crew_id;
      body.time_card_id = meta.time_card_id;
      body.project_id   = meta.project_id || null;
      body.task_id      = meta.task_id    || null;
      body.request_line_id = meta.request_line_id || null;

      var lineId = meta.time_entry_line_id;
      if (lineId === null) {
        self._pendingCreates.push({ body: body });
      } else if (self._modifiedIds[lineId]) {
        self._pendingUpdates.push({ id: lineId, body: body });
      }
    }

    console.log('Change sets prepared:',
      self._pendingDeletes.length, 'deletes,',
      self._pendingUpdates.length, 'updates,',
      self._pendingCreates.length, 'creates');

    return true;
  };

  /**
   * Returns the next delete operation, or null if none remain.
   * Called repeatedly by the recursive save chain.
   */
  PageModule.prototype.getNextDelete = function () {
    if (this._pendingDeletes.length > 0) {
      return { id: this._pendingDeletes.shift() };
    }
    return null;
  };

  /**
   * Returns the next update operation { id, body }, or null if none remain.
   */
  PageModule.prototype.getNextUpdate = function () {
    if (this._pendingUpdates.length > 0) {
      return this._pendingUpdates.shift();
    }
    return null;
  };

  /**
   * Returns the next create operation { body }, or null if none remain.
   */
  PageModule.prototype.getNextCreate = function () {
    if (this._pendingCreates.length > 0) {
      return this._pendingCreates.shift();
    }
    return null;
  };

  /**
   * Clears all tracking state after a successful save.
   */
  PageModule.prototype.clearChangeSets = function () {
    this._deletedIds = [];
    this._modifiedIds = {};
    this._pendingDeletes = [];
    this._pendingUpdates = [];
    this._pendingCreates = [];
    this._pendingExpTypes = [];
    this._pendingExpTypes = [];
  };

  PageModule.prototype.getModifiedIds = function () {
    return this._modifiedIds;
  };

  // Re-renders the grid from the current _allData state without a REST re-fetch.
  // Used post-save because the VBCS proxy strips weekStartDate from query params,
  // causing a re-fetch to return the wrong week's rows.
  PageModule.prototype.rebuildProviderAfterSave = function () {
    this._clearChangeTracking();
    this._createProvider();
    return this._dataGridProvider;
  };

  // â”€â”€â”€ Hide/Show Index Panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  PageModule.prototype.getColumnHideOptions = function () {
    var options = COLUMN_HEADERS.map(function (label, index) {
      return { value: index, label: label };
    });
    return new ArrayDataProvider(options, { keyAttributes: 'value' });
  };

  PageModule.prototype.buildRowHideOptions = function () {
    var self = this;
    var personOrigIdx   = COLUMN_KEYS.indexOf('person_name'); // = 0
    var personDispPos   = self._columnOrder.indexOf(personOrigIdx);
    var options = self._data.map(function (row, index) {
      var name = (personDispPos >= 0 && row[personDispPos]) ? row[personDispPos].data : '';
      return { value: index, label: 'Row ' + (index + 1) + (name ? ' (' + name + ')' : '') };
    });
    return new ArrayDataProvider(options, { keyAttributes: 'value' });
  };

  PageModule.prototype.buildHiddenSet = function (indices) {
    return new Set(Array.isArray(indices) ? indices : []);
  };

  PageModule.prototype.getHiddenIndicesFromEvent = function (event) {
    if (event && event.detail && event.detail.updatedFrom === 'internal' && event.detail.value) {
      return Array.from(event.detail.value);
    }
    return null;
  };

  // â”€â”€â”€ Drag & Drop: Reorder â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  PageModule.prototype.handleDropColumns = function (event, dropHeaderContext) {
    var self = this;
    if (!self._dataGridProvider || !self._draggedIndex || self._draggedIndex.length === 0) {
      return false;
    }
    // Block column reorder while a filter is active
    if (self._currentFilterText !== '') {
      return false;
    }
    // Safety: confirm we have column drag data (not row drag data)
    if (self._draggedIndex[0].startIndex.column === undefined) {
      return false;
    }

    var dropColIndex = dropHeaderContext.index;
    var position = dropHeaderContext.position;
    var removeEventRanges = [];
    var draggedColData = [];
    var beforeDropIndexCount = 0;
    this.saveSnapshot();

    // Collect dragged column data from both _data and _allData
    for (var i = 0; i < self._draggedIndex.length; i++) {
      var colsInSelection = 0;
      var startIndex = self._draggedIndex[i].startIndex.column;
      var endIndex = self._draggedIndex[i].endIndex.column;
      for (var k = startIndex; k <= endIndex; k++) {
        colsInSelection += 1;
        var colDataFromData = self._data.map(function (row) { return row[k]; });
        var colDataFromAll  = self._allData.map(function (row) { return row[k]; });
        draggedColData.push({
          header:      self._columnHeaders[0][k],
          orderEntry:  self._columnOrder[k],
          colData:     colDataFromData,
          allColData:  colDataFromAll
        });
        if (k < dropColIndex) {
          beforeDropIndexCount += 1;
        }
      }
      removeEventRanges.push({ offset: startIndex, count: colsInSelection });
    }

    // Tell the grid to remove the dragged columns visually
    self._dataGridProvider.dispatchEvent(
      new ojdatagridprovider.DataGridProviderRemoveEvent({ axis: 'column', ranges: removeEventRanges, version: 0 })
    );

    // Splice columns out of all arrays (use indexOf by header to handle shifting)
    for (var j = 0; j < draggedColData.length; j++) {
      var matchIndex = self._columnHeaders[0].indexOf(draggedColData[j].header);
      self._columnHeaders[0].splice(matchIndex, 1);
      self._columnOrder.splice(matchIndex, 1);
      for (var r = 0; r < self._data.length; r++) {
        self._data[r].splice(matchIndex, 1);
      }
      for (var a = 0; a < self._allData.length; a++) {
        self._allData[a].splice(matchIndex, 1);
      }
    }

    // Adjust insertion index (dragged cols above drop target have been removed)
    var adjustedDropIndex = dropColIndex - beforeDropIndexCount;
    if (position === 'after') {
      adjustedDropIndex += 1;
    }
    adjustedDropIndex = Math.max(0, Math.min(adjustedDropIndex, self._columnHeaders[0].length));

    // Re-insert in reverse order so original relative order is preserved
    for (var m = draggedColData.length - 1; m >= 0; m--) {
      self._columnHeaders[0].splice(adjustedDropIndex, 0, draggedColData[m].header);
      self._columnOrder.splice(adjustedDropIndex, 0, draggedColData[m].orderEntry);
      for (var r2 = 0; r2 < self._data.length; r2++) {
        self._data[r2].splice(adjustedDropIndex, 0, draggedColData[m].colData[r2]);
      }
      for (var a2 = 0; a2 < self._allData.length; a2++) {
        self._allData[a2].splice(adjustedDropIndex, 0, draggedColData[m].allColData[a2]);
      }
    }

    // Tell the grid to add the columns at their new position
    self._dataGridProvider.dispatchEvent(
      new ojdatagridprovider.DataGridProviderAddEvent({
        axis: 'column',
        ranges: [{ offset: adjustedDropIndex, count: draggedColData.length }],
        version: 0
      })
    );

    return false; // Column reorder does NOT mark data dirty
  };

  PageModule.prototype.handleDragStart = function (event, dragContext) {
    this._draggedIndex = (dragContext && dragContext.range) ? dragContext.range : [];
  };

  PageModule.prototype.handleDropRows = function (event, dropHeaderContext) {
    var self = this;
    if (!self._dataGridProvider || !self._draggedIndex || self._draggedIndex.length === 0) {
      return false;
    }
    // Block reorder while a filter is active (_data and _allData have different lengths)
    if (self._currentFilterText !== '') {
      return false;
    }

    var dropRowIndex = dropHeaderContext.index;
    var removeEventRanges = [];
    var draggedRowData = [];
    var beforeDropIndexCount = 0;
    this.saveSnapshot();

    // Collect dragged rows and count how many are above the drop target
    for (var i = 0; i < self._draggedIndex.length; i++) {
      var rowsInSelection = 0;
      var startIndex = self._draggedIndex[i].startIndex.row;
      var endIndex = self._draggedIndex[i].endIndex.row;
      for (var k = startIndex; k <= endIndex; k++) {
        rowsInSelection += 1;
        draggedRowData.push({
          rowHeader:  self._rowHeaders[0][k],
          rowData:    self._data[k],
          allData:    self._allData[k],
          rowMeta:    self._rowMetaAll[k]
        });
        if (k < dropRowIndex) {
          beforeDropIndexCount += 1;
        }
      }
      removeEventRanges.push({ offset: startIndex, count: rowsInSelection });
    }

    // Notify the grid that these rows are being removed (also updates totals.row)
    self._dataGridProvider.doRemove({ axis: 'row', ranges: removeEventRanges, version: 0 });

    // Splice rows out by header value (indexOf handles index shifting from prior splices)
    for (var j = 0; j < draggedRowData.length; j++) {
      var matchIndex = self._rowHeaders[0].indexOf(draggedRowData[j].rowHeader);
      self._rowHeaders[0].splice(matchIndex, 1);
      self._data.splice(matchIndex, 1);
      self._allData.splice(matchIndex, 1);
      self._rowMetaAll.splice(matchIndex, 1);
      self._rowMetaFiltered.splice(matchIndex, 1);
    }

    // Adjust insert index: rows above the drop target have been removed, so shift down
    var adjustedDropIndex = dropRowIndex - beforeDropIndexCount;
    if (dropHeaderContext.position === 'after') {
      adjustedDropIndex += 1;
    }
    adjustedDropIndex = Math.max(0, Math.min(adjustedDropIndex, self._data.length));

    // Re-insert in reverse so they land in original relative order at adjustedDropIndex
    for (var m = draggedRowData.length - 1; m >= 0; m--) {
      self._rowHeaders[0].splice(adjustedDropIndex, 0, draggedRowData[m].rowHeader);
      self._data.splice(adjustedDropIndex, 0, draggedRowData[m].rowData);
      self._allData.splice(adjustedDropIndex, 0, draggedRowData[m].allData);
      self._rowMetaAll.splice(adjustedDropIndex, 0, draggedRowData[m].rowMeta);
      self._rowMetaFiltered.splice(adjustedDropIndex, 0, draggedRowData[m].rowMeta);
    }

    // Rebuild _dataToAllIdx as 1:1 (filter is blocked during drag)
    self._dataToAllIdx = self._data.map(function (_, idx) { return idx; });

    // Notify the grid that rows have been added at the new position (also updates totals.row)
    self._dataGridProvider.doAdd({
      axis: 'row',
      ranges: [{ offset: adjustedDropIndex, count: draggedRowData.length }],
      version: 0
    });

    return true;
  };

  // â”€â”€â”€ Undo Feature â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  PageModule.prototype.takeSnapshotObj = function () {
    return {
      _data:             JSON.parse(JSON.stringify(this._data)),
      _allData:          JSON.parse(JSON.stringify(this._allData)),
      _rowHeaders:       JSON.parse(JSON.stringify(this._rowHeaders)),
      _columnHeaders:    JSON.parse(JSON.stringify(this._columnHeaders)),
      _columnOrder:      JSON.parse(JSON.stringify(this._columnOrder)),
      _deletedIds:       JSON.parse(JSON.stringify(this._deletedIds)),
      _modifiedIds:      JSON.parse(JSON.stringify(this._modifiedIds)),
      _rowMetaAll:       JSON.parse(JSON.stringify(this._rowMetaAll)),
      _rowMetaFiltered:  JSON.parse(JSON.stringify(this._rowMetaFiltered)),
      _dataToAllIdx:     JSON.parse(JSON.stringify(this._dataToAllIdx))
    };
  };

  PageModule.prototype.saveSnapshot = function () {
    this._history.push(this.takeSnapshotObj());
  };

  PageModule.prototype.undoLastAction = function () {
    if (!this._history || this._history.length === 0) {
      return { isDirty: Object.keys(this._modifiedIds).length > 0 || this._deletedIds.length > 0 || this._rowMetaAll.some(function(m) { return m && m.time_entry_line_id === null; }), undoDisabled: true };
    }

    var lastSnapshot = this._history.pop();

    // Restore variables
    this._data            = lastSnapshot._data;
    this._allData         = lastSnapshot._allData;
    this._rowHeaders      = lastSnapshot._rowHeaders;
    this._columnHeaders   = lastSnapshot._columnHeaders;
    this._columnOrder     = lastSnapshot._columnOrder;
    this._deletedIds      = lastSnapshot._deletedIds;
    this._modifiedIds     = lastSnapshot._modifiedIds;
    this._rowMetaAll      = lastSnapshot._rowMetaAll;
    this._rowMetaFiltered = lastSnapshot._rowMetaFiltered;
    this._dataToAllIdx    = lastSnapshot._dataToAllIdx;

    // Rebuild the data provider tracking to handle dimension changes (like row/col drop)
    if (this._dataGridProvider) {
      this._dataGridProvider.dataParameters = {
        data: this._data,
        rowHeader: this._rowHeaders,
        columnHeader: this._columnHeaders
      };
      this._dataGridProvider._setTotalCounts();
      this._dataGridProvider.doRefresh();
    }

    // Determine dirty state
    var self2 = this;
    var isDirty = Object.keys(this._modifiedIds).length > 0 || this._deletedIds.length > 0 || this._rowMetaAll.some(function(m) { return m && m.time_entry_line_id === null; });
    var undoDisabled = this._history.length === 0;

    return {
      isDirty: isDirty,
      undoDisabled: undoDisabled
    };
  };

  // â”€â”€â”€ Time Card Header Creator helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  var DAY_NAMES   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  PageModule.prototype._formatDateDisplay = function (date) {
    return DAY_NAMES[date.getDay()] + ' ' + MONTH_NAMES[date.getMonth()] + ' ' +
           date.getDate() + ', ' + date.getFullYear();
  };

  // Build ArrayDataProvider for crew dropdown from REST response items
  PageModule.prototype.buildCrewsProvider = function (items) {
    var self = this;
    var options = (items || []).map(function (crew) {
      return {
        value: crew.cr_crews_id,
        label: crew.crew_code + ' \u2014 ' + crew.name
      };
    });
    return new ArrayDataProvider(options, { keyAttributes: 'value', textFilterAttributes: ['label'] });
  };

  // Build ArrayDataProvider of Fridays (12 past + current + 5 future)
  PageModule.prototype.buildWeekEndDateOptions = function () {
    var self = this;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    // Days since most recent Friday (0 = today is Friday)
    var dow = today.getDay(); // 0=Sun..6=Sat
    var daysSinceFri = (dow + 2) % 7; // Friâ†’0, Satâ†’1, Sunâ†’2, Monâ†’3, Tueâ†’4, Wedâ†’5, Thuâ†’6
    var mostRecentFri = new Date(today);
    mostRecentFri.setDate(today.getDate() - daysSinceFri);

    // Start 11 weeks before the most recent Friday, generate 18 Fridays
    var startFri = new Date(mostRecentFri);
    startFri.setDate(mostRecentFri.getDate() - 11 * 7);

    var options = [];
    for (var i = 0; i < 18; i++) {
      var d = new Date(startFri);
      d.setDate(startFri.getDate() + i * 7);
      var isoDate = d.getFullYear() + '-' +
                    (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1) + '-' +
                    (d.getDate() < 10 ? '0' : '') + d.getDate();
      options.push({ value: isoDate, label: self._formatDateDisplay(d) });
    }
    return new ArrayDataProvider(options, { keyAttributes: 'value' });
  };

  // Returns the ISO date string (YYYY-MM-DD) for the Friday of the current work week.
  // If today is Friday → today. If Mon–Thu → upcoming Friday. If Sat/Sun → next Friday.
  PageModule.prototype.getDefaultWeekEndDate = function () {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var dow = today.getDay(); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
    var daysToFri = (5 - dow + 7) % 7; // 0 on Friday, 4 on Monday, etc.
    var friday = new Date(today);
    friday.setDate(today.getDate() + daysToFri);
    var mm = friday.getMonth() + 1;
    var dd = friday.getDate();
    return friday.getFullYear() + '-' +
      (mm < 10 ? '0' : '') + mm + '-' +
      (dd < 10 ? '0' : '') + dd;
  };

  // Build ArrayDataProvider of Monâ€“Fri for the week ending on the given Friday
  PageModule.prototype.buildWorkDateOptions = function (weekEndDateStr) {
    var self = this;
    if (!weekEndDateStr) {
      return new ArrayDataProvider([], { keyAttributes: 'value' });
    }
    // Parse as local date to avoid timezone shifts
    var parts = weekEndDateStr.split('-');
    var endDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    var options = [];
    // endDate is Friday; Mon = endDate-4, Tue = endDate-3, ..., Fri = endDate
    for (var i = 4; i >= 0; i--) {
      var d = new Date(endDate);
      d.setDate(endDate.getDate() - i);
      var isoDate = d.getFullYear() + '-' +
                    (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1) + '-' +
                    (d.getDate() < 10 ? '0' : '') + d.getDate();
      options.push({ value: isoDate, label: self._formatDateDisplay(d) });
    }
    return new ArrayDataProvider(options, { keyAttributes: 'value' });
  };

  // Build the POST body for creating a time card header
  PageModule.prototype.prepareTimeCardHeaderBody = function (crewId, weekEndDate, workDate) {
    return {
      crew_id:          crewId,
      week_end_date:    weekEndDate + 'T00:00:00Z',
      work_date:        workDate   + 'T00:00:00Z',
      status:           'Draft',
      otl_export_status: 'Draft'
    };
  };

  // â”€â”€â”€ Persons helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // Builds _personsMap and returns an ArrayDataProvider of { value: person_id, label: name }.
  // Called from the action chain after fetchPersons so the person dropdown has options.
  PageModule.prototype.buildPersonsProvider = function (persons) {
    var self = this;
    self._personsMap = {};
    self._personsCodeMap = {};
    var options = (persons || []).map(function (p) {
      self._personsMap[p.cr_persons_id] = p.name;
      self._personsCodeMap[p.cr_persons_id] = p.person_code || p.person_number || p.number || '';
      return { value: p.cr_persons_id, label: p.name || String(p.cr_persons_id) };
    });
    self._personsProvider = new ArrayDataProvider(options, { keyAttributes: 'value' });
    return self._personsProvider;
  };

  PageModule.prototype.getPersonCode = function (personId) {
    if (!personId && personId !== 0) return '';
    return this._personsCodeMap ? (this._personsCodeMap[personId] || '') : '';
  };

  // Returns the cached persons ArrayDataProvider (used by the cell template via $functions.getPersonsProvider()).
  PageModule.prototype.getPersonsProvider = function () {
    return this._personsProvider || null;
  };

  // Returns an ArrayDataProvider for the Time Type dropdown (REG, OT, DT, SICK, VAC, HOL).
  PageModule.prototype.getTimeTypeProvider = function () {
    if (!this._timeTypeProvider) {
      var options = ['REG', 'OT', 'DT', 'SICK', 'VAC', 'HOL'].map(function (code) {
        return { value: code, label: code };
      });
      this._timeTypeProvider = new ArrayDataProvider(options, { keyAttributes: 'value' });
    }
    return this._timeTypeProvider;
  };

  PageModule.prototype.getPayRateCodeProvider = function () {
    return this._payRateCodeProvider;
  };

  PageModule.prototype.getTransferTargetProvider = function () {
    if (!this._transferTargetProvider) {
      var options = [
        { value: 'OTL', label: 'OTL' },
        { value: 'Payroll', label: 'Payroll' },
        { value: 'Projects', label: 'Projects' }
      ];
      this._transferTargetProvider = new ArrayDataProvider(options, { keyAttributes: 'value' });
    }
    return this._transferTargetProvider;
  };

  // Returns an ArrayDataProvider for the Shifts dropdown (Day, Evening, Night).
  PageModule.prototype.getShiftsProvider = function () {
    if (!this._shiftsProvider) {
      var options = [
        { value: 'Day', label: 'Day' },
        { value: 'Evening', label: 'Evening' },
        { value: 'Night', label: 'Night' }
      ];
      this._shiftsProvider = new ArrayDataProvider(options, { keyAttributes: 'value' });
    }
    return this._shiftsProvider;
  };

  // Returns the display name for a person_id (used in cell nav-mode template).
  PageModule.prototype.getPersonName = function (personId) {
    if (!personId && personId !== 0) return '';
    return this._personsMap[personId] || String(personId);
  };

  // â”€â”€â”€ Combinations helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // Builds _combinationsMap from CombinationsService items and returns the map
  PageModule.prototype.buildCombinationsMap = function (items) {
    var self = this;
    self._combinationsMap = {};
    (items || []).forEach(function (item) {
      self._combinationsMap[item.combination_id] = item;
    });
    return true;
  };

  // Returns an ArrayDataProvider of { value: combination_id, label: combination_name · project_number }
  // and stores it on this._combinationsProvider for use by the dropdown cell template.
  // The project number is shown in the dropdown only; cell display uses getCombinationName.
  PageModule.prototype.buildCombinationsProvider = function (items) {
    var options = (items || []).map(function (item) {
      var name = item.combination_name || String(item.combination_id);
      var label = item.project_number ? name + '  \u00b7  ' + item.project_number : name;
      return { value: item.combination_id, label: label };
    });
    this._combinationsProvider = new ArrayDataProvider(options, { keyAttributes: 'value' });
    return this._combinationsProvider;
  };

  // Returns the display name for a combination_id (used in cell nav-mode template)
  PageModule.prototype.getCombinationName = function (comboId) {
    if (!comboId && comboId !== 0) return '';
    var combo = this._combinationsMap[comboId];
    return combo ? (combo.combination_name || String(comboId)) : String(comboId);
  };

  // Raw fetch for combinations belonging to a crew, with URL-encoded q and a
  // defensive client-side re-filter. Returns a VBCS-rest-shaped result so
  // $chain.results.X.body.items expressions keep working.
  PageModule.prototype.fetchCombinationsForCrewWrapped = async function (crewId) {
    const empty = { body: { items: [] } };
    if (!crewId && crewId !== 0) return empty;
    try {
      const q = encodeURIComponent('{"crew_id":{"$eq":' + crewId + '}}');
      const url = 'https://crewrite.cianbro.com/ords/timerite/cr_combinations/?q=' + q + '&limit=1000';
      const resp = await fetch(url);
      if (!resp.ok) return empty;
      const data = await resp.json();
      const all = data.items || [];
      const scid = String(crewId);
      const filtered = all.filter(function (it) {
        var raw = it.crew_id !== undefined ? it.crew_id : it.CREW_ID;
        return raw !== undefined && raw !== null && String(raw) === scid;
      });
      return { body: { items: filtered } };
    } catch (e) {
      console.error('Error fetching combinations for crew:', crewId, e);
      return empty;
    }
  };

  // â”€â”€â”€ Pure data-processing helpers (all REST fetching done via VBCS restAction) â”€

  // Finds a matching header from a list of items returned by getTimeCardHeaders.
  // Returns { found: true, timeCardId: <id> } or { found: false, timeCardId: null }.
  // Date comparison uses startsWith to tolerate ORDS timestamp format variations
  // (e.g. stored as "2025-03-14T00:00:00.000000Z" but selected as "2025-03-14").
  PageModule.prototype.findMatchingHeader = function (headers, weekEndDate, workDate) {
    if (!weekEndDate || !workDate) {
      return { found: false, timeCardId: null };
    }
    var list = headers || [];
    for (var i = 0; i < list.length; i++) {
      var h = list[i];
      if (h.week_end_date && h.week_end_date.startsWith(weekEndDate) &&
          h.work_date     && h.work_date.startsWith(workDate)) {
        return { found: true, timeCardId: h.time_card_id, headerItem: h };
      }
    }
    return { found: false, timeCardId: null, headerItem: null };
  };

  // Initializes the grid from existing lines + persons arrays (both already fetched).
  // Sets _currentTimeCardId / _currentCrewId / _currentWorkDate and returns the provider.
  PageModule.prototype.initProviderFromLinesAndPersons = function (lines, persons, timeCardId, crewId, workDate) {
    var self = this;
    self._currentTimeCardId = timeCardId;
    self._currentCrewId     = crewId;
    self._currentWorkDate   = workDate + 'T00:00:00Z';
    // Refresh _personsMap so getPersonName works after a grid reload.
    self.buildPersonsProvider(persons);
    return self.initProviderFromLines(lines);
  };

  // Returns the current time card ID and crew ID so the save chain can re-fetch lines.
  PageModule.prototype.getReloadParams = function () {
    return { timeCardId: this._currentTimeCardId, crewId: this._currentCrewId };
  };

  // Rebuilds the provider from freshly-fetched lines + persons arrays after a save.
  PageModule.prototype.processReloadedLines = function (lines, persons) {
    // Refresh _personsMap so getPersonName works after the grid is rebuilt.
    this.buildPersonsProvider(persons);
    return this.initProviderFromLines(lines);
  };

  // â”€â”€â”€ Copy From Previous Day helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // Returns the previous Mon-Fri work date string given the current work date.
  // Monday â†’ previous Friday (skip weekend); Tue-Fri â†’ previous calendar day.
  PageModule.prototype.getPreviousWorkDate = function (workDateStr) {
    if (!workDateStr) return null;
    var parts = workDateStr.split('-');
    var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    var dow = d.getDay(); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
    var daysBack = (dow === 1) ? 3 : 1; // Monday â†’ back 3 days to Friday, else back 1 day
    d.setDate(d.getDate() - daysBack);
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  };

  // Finds a time card header matching work_date only (week boundary safe).
  PageModule.prototype.findHeaderByWorkDate = function (headers, workDate) {
    if (!workDate) return { found: false, timeCardId: null };
    var list = headers || [];
    for (var i = 0; i < list.length; i++) {
      var h = list[i];
      if (h.work_date && h.work_date.startsWith(workDate)) {
        return { found: true, timeCardId: h.time_card_id };
      }
    }
    return { found: false, timeCardId: null };
  };

  // Copies previous day's lines into the current time card.
  // Strips time_entry_line_id so all rows become new creates on save.
  PageModule.prototype.copyLinesFromPreviousDay = function (prevLines) {
    var self = this;
    // Capture existing row IDs so they get deleted when the copied grid is saved
    var idsToDelete = [];
    self._rowMetaAll.forEach(function (meta) {
      if (meta && meta.time_entry_line_id !== null) {
        idsToDelete.push(meta.time_entry_line_id);
      }
    });

    var lines = (prevLines || []).map(function (item) {
      var newItem = {};
      Object.keys(item).forEach(function (k) { newItem[k] = item[k]; });
      newItem.time_entry_line_id = null;
      newItem.time_card_id       = self._currentTimeCardId;
      newItem.work_date          = self._currentWorkDate;
      return newItem;
    });
    var provider = self.initProviderFromLines(lines); // _clearChangeTracking wipes deletedIds
    self._deletedIds = idsToDelete;                   // restore after wipe
    return provider;
  };

  // â”€â”€â”€ Current Header Item helpers (Status panel + PUT calls) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  PageModule.prototype.setCurrentHeaderItem = function (headerItem) {
    this._currentHeaderItem = headerItem || null;
    if (!headerItem) {
      return { status: '', printedBy: '', printedDate: '', balancedBy: '', balancedDate: '',
               otlTransferStatus: '', payrollTransferStatus: '', projectsTransferStatus: '' };
    }
    return {
      status:                 headerItem.status                   || '',
      printedBy:              headerItem.printed_by               || '',
      printedDate:            headerItem.printed_date             || '',
      balancedBy:             headerItem.balanced_by              || '',
      balancedDate:           headerItem.balanced_date            || '',
      otlTransferStatus:      headerItem.otl_transfer_status      || '',
      payrollTransferStatus:  headerItem.payroll_transfer_status  || '',
      projectsTransferStatus: headerItem.projects_transfer_status || ''
    };
  };

  PageModule.prototype.prepareHeaderSubmit = function () {
    var item = this._currentHeaderItem ? JSON.parse(JSON.stringify(this._currentHeaderItem)) : {};
    item.status = 'Submitted';
    this._currentHeaderItem = item;
    return { id: item.time_card_id, body: item };
  };

  // transferType: 'otl' | 'payroll' | 'projects'
  PageModule.prototype.prepareHeaderTransfer = function (transferType) {
    var item = this._currentHeaderItem ? JSON.parse(JSON.stringify(this._currentHeaderItem)) : {};
    if (transferType === 'otl')      item.otl_transfer_status      = 'Transferred';
    if (transferType === 'payroll')  item.payroll_transfer_status  = 'Transferred';
    if (transferType === 'projects') item.projects_transfer_status = 'Transferred';
    this._currentHeaderItem = item;
    return {
      id:                     item.time_card_id,
      body:                   item,
      otlTransferStatus:      item.otl_transfer_status      || '',
      payrollTransferStatus:  item.payroll_transfer_status  || '',
      projectsTransferStatus: item.projects_transfer_status || ''
    };
  };

  // Extract transferType from oj-menu ojAction event.
  // Tries .value property first, then getAttribute as a fallback for JET versions
  // where the oj-option custom element property may not be resolved at event time.
  PageModule.prototype.getTransferType = function (event) {
    if (!event || !event.detail) return null;
    var si = event.detail.selectedItem || event.detail.item;
    if (!si) return null;
    if (si.value !== undefined && si.value !== null && si.value !== '') {
      return si.value;
    }
    if (typeof si.getAttribute === 'function') {
      return si.getAttribute('value') || null;
    }
    return null;
  };

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // Combinations Grid Methods
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  PageModule.prototype._comboCreateProvider = function () {
    this._comboGridProvider = new DemoArrayDataGridProvider(
      { data: this._comboData, rowHeader: this._comboRowHeaders, columnHeader: this._comboColumnHeaders },
      {}, {}, {}, {}, {}
    );
  };

  PageModule.prototype._comboClearTracking = function () {
    this._comboDeletedIds    = [];
    this._comboModifiedIds   = {};
    this._comboPendingDeletes = [];
    this._comboPendingUpdates = [];
    this._comboPendingCreates = [];
    this._comboHistory       = [];
  };

  PageModule.prototype._comboSaveSnapshot = function () {
    this._comboHistory.push(JSON.parse(JSON.stringify({
      data:            this._comboData,
      allData:         this._comboAllData,
      rowHeaders:      this._comboRowHeaders,
      columnHeaders:   this._comboColumnHeaders,
      columnOrder:     this._comboColumnOrder,
      deletedIds:      this._comboDeletedIds,
      modifiedIds:     this._comboModifiedIds,
      rowMetaAll:      this._comboRowMetaAll,
      rowMetaFiltered: this._comboRowMetaFiltered,
      dataToAllIdx:    this._comboDataToAllIdx
    })));
  };

  PageModule.prototype.initComboGridFromItems = function (items) {
    var self = this;
    self._comboColumnOrder    = COMBO_DISPLAY_ORDER.slice(); // reset column order on reload
    self._comboColumnHeaders  = [self._comboColumnOrder.map(function (i) { return COMBO_HEADERS[i]; })];
    self._comboCurrentFilterText = '';
    self._comboCurrentFilterColumnIndex = -1;
    self._comboData           = [];
    self._comboAllData        = [];
    self._comboRowHeaders     = [[]];
    self._comboRowMetaAll     = [];
    self._comboRowMetaFiltered = [];
    self._comboDataToAllIdx   = [];

    // Installed Qty mockup demo rows
    var DEMO_IQ_ROWS = [
      { cost_code: '05-100', description: 'Structural Steel, W24x76 Beams', qty_installed: 12, uom: 'EA', qty_budgeted: 48, pct_complete: 25, notes: 'Level 3 complete', combination_id: 'IQ-001' },
      { cost_code: '05-200', description: 'Metal Decking, 3" Composite', qty_installed: 2400, uom: 'SF', qty_budgeted: 9600, pct_complete: 25, notes: 'Floors 1-3', combination_id: 'IQ-002' },
      { cost_code: '05-300', description: 'Misc Steel, Embed Plates', qty_installed: 36, uom: 'EA', qty_budgeted: 120, pct_complete: 30, notes: 'Foundation phase', combination_id: 'IQ-003' },
      { cost_code: '05-400', description: 'Rebar #8 Grade 60', qty_installed: 1800, uom: 'LF', qty_budgeted: 5400, pct_complete: 33, notes: 'Footings & walls', combination_id: 'IQ-004' },
      { cost_code: '05-500', description: 'Shear Studs 3/4"', qty_installed: 450, uom: 'EA', qty_budgeted: 2000, pct_complete: 23, notes: 'Composite deck', combination_id: 'IQ-005' }
    ];

    // Use demo data if no API items provided, or if the provided items don't
    // match the Installed Qty shape (e.g. real combinations from CombinationsService
    // carry combination_name / customer_id but no cost_code, which would render
    // every cell blank).
    var hasInstalledQtyShape = !!(items && items.length > 0 && items.some(function (it) {
      return it && (it.cost_code !== undefined || it.qty_installed !== undefined);
    }));
    var dataItems = hasInstalledQtyShape ? items : DEMO_IQ_ROWS;

    dataItems.forEach(function (item, index) {
      var row = self._comboColumnOrder.map(function (origIdx) {
        if (origIdx === COMBO_KEYS.length) return { data: '' }; // Actions placeholder
        var v = item[COMBO_KEYS[origIdx]];
        return { data: v !== undefined && v !== null ? v : '' };
      });
      self._comboData.push(row);
      self._comboAllData.push(row.map(function (c) { return { data: c.data }; }));
      self._comboRowHeaders[0].push(index + 1);
      var meta = { combination_id: item.combination_id };
      self._comboRowMetaAll.push(meta);
      self._comboRowMetaFiltered.push(meta);
      self._comboDataToAllIdx.push(index);
    });

    self._comboCreateProvider();
    self._comboClearTracking();
    return self._comboGridProvider;
  };

  PageModule.prototype.getComboColumnType = function (displayIdx) {
    var origIdx = this._comboColumnOrder[displayIdx];
    if (origIdx === COMBO_KEYS.length) return 'actions';
    return COMBO_TYPES[origIdx] || 'text';
  };

  PageModule.prototype.getComboIsEditable = function (cellContext) {
    var origIdx = this._comboColumnOrder[cellContext.indexes.column];
    return undefined;
  };

  PageModule.prototype.getComboHeaderFilterable = function (headerContext) {
    var origIdx = this._comboColumnOrder[headerContext.index];
    if (origIdx === COMBO_KEYS.length) return 'disable';
    return 'auto';
  };

  PageModule.prototype.getComboColumnHeaderStyle = function (headerContext) {
    var origIdx = this._comboColumnOrder[headerContext.index];
    if (origIdx === COMBO_KEYS.length) return 'width:57px;';
    var key = COMBO_KEYS[origIdx];
    if (key === 'cost_code')        return 'width:110px;';
    if (key === 'description')      return 'width:250px;';
    if (key === 'qty_installed')    return 'width:120px;';
    if (key === 'uom')              return 'width:80px;';
    if (key === 'qty_budgeted')     return 'width:120px;';
    if (key === 'pct_complete')     return 'width:110px;';
    if (key === 'notes')            return 'width:200px;';
    return 'width:120px;';
  };

  PageModule.prototype.handleComboEdit = function (event) {
    this._comboOriginalData = Object.assign({}, event.detail.cellContext.data);
  };

  // Caches project items and project_defaults_v items for auto-populate lookups.
  // projectItems: from TimeRiteService/getProjects (has project_number, task_number, project_id)
  // defaultsItems: from project_defaults/getProject_defaults_v (has project_id, otthresholdmeasure, otlimithours, perdiemamount, etc.)
  PageModule.prototype.cacheProjectsData = function (projectItems, defaultsItems) {
    var self = this;
    self._projectsCache = {};

    // Build a map of project_id â†’ defaults record
    var defaultsByProjectId = {};
    (defaultsItems || []).forEach(function (d) {
      if (d.project_id) {
        defaultsByProjectId[d.project_id] = d;
      }
    });

    // Build the final cache keyed by project_number, merging project + defaults
    (projectItems || []).forEach(function (item) {
      if (item.project_number) {
        var merged = { project_number: item.project_number, task_number: item.task_number, project_id: item.project_id };
        var def = defaultsByProjectId[item.project_id];
        if (def) {
          // Map project_defaults_v fields to COMBO_KEYS field names
          if (def.otthresholdmeasure !== undefined)   merged.ot_threshold_measure    = def.otthresholdmeasure;
          if (def.otlimithours !== undefined)          merged.ot_hours                = def.otlimithours;
          if (def.perdiemamount !== undefined)         merged.meal_per_diem_amount    = def.perdiemamount;
        }
        self._projectsCache[item.project_number] = merged;
      }
    });
    return true;
  };

  PageModule.prototype.handleComboEditEnd = function (event) {
    var detail = event.detail;
    if (detail.cancelEdit) {
      detail.cellContext.data.data = this._comboOriginalData.data;
      return false;
    }
    var rowIndex    = detail.cellContext.indexes.row;
    var columnIndex = detail.cellContext.indexes.column;
    var currentValue = (this._comboData[rowIndex] && this._comboData[rowIndex][columnIndex] !== undefined)
      ? this._comboData[rowIndex][columnIndex].data
      : detail.cellContext.data.data;

    if (this._comboOriginalData && String(this._comboOriginalData.data) !== String(currentValue)) {
      this._comboData[rowIndex][columnIndex].data = currentValue;

      // â”€â”€ Auto-populate when project_number column changes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      var origIdx = this._comboColumnOrder[columnIndex];
      if (COMBO_KEYS[origIdx] === 'project_number' && currentValue) {
        var project = this._projectsCache[currentValue];
        if (project) {
          // Map of COMBO_KEYS field â†’ value from merged project + defaults record
          var autoFields = {
            task_number:          project.task_number,
            ot_threshold_measure: project.ot_threshold_measure,
            ot_hours:             project.ot_hours,
            meal_per_diem_amount: project.meal_per_diem_amount
          };
          var self = this;
          Object.keys(autoFields).forEach(function (fieldName) {
            var comboOrigIdx = COMBO_KEYS.indexOf(fieldName);
            if (comboOrigIdx === -1) return;
            var dispPos = self._comboColumnOrder.indexOf(comboOrigIdx);
            if (dispPos === -1) return;
            var val = autoFields[fieldName];
            self._comboData[rowIndex][dispPos].data = (val !== undefined && val !== null) ? val : '';
          });
        }
      }

      var allIdx = this._comboDataToAllIdx[rowIndex];
      if (allIdx !== undefined) {
        this._comboAllData[allIdx] = this._comboData[rowIndex].map(function (c) { return { data: c.data }; });
      }
      var meta = this._comboRowMetaFiltered[rowIndex];
      if (meta && meta.combination_id !== null) {
        this._comboModifiedIds[meta.combination_id] = true;
      }
      if (this._comboGridProvider) {
        // Refresh the entire row so auto-populated columns are visible
        this._comboGridProvider.doUpdate({
          ranges: [{ rowOffset: rowIndex, columnOffset: 0, rowCount: 1, columnCount: this._comboColumnOrder.length }],
          version: 0
        });
      }
      return true;
    }
    return false;
  };

  PageModule.prototype.addComboRow = function () {
    this._comboSaveSnapshot();
    var newRow = this._comboColumnOrder.map(function (origIdx) {
      if (origIdx === COMBO_KEYS.length) return { data: '' };
      if (COMBO_TYPES[origIdx] === 'number') return { data: 0 };
      if (COMBO_TYPES[origIdx] === 'dropdown-shift') return { data: 'Day' };
      return { data: '' };
    });
    var rowIndex = this._comboData.length;
    this._comboData.push(newRow);
    this._comboAllData.push(newRow.map(function (c) { return { data: c.data }; }));
    this._comboRowHeaders[0].push(rowIndex + 1);
    var newMeta = { combination_id: null };
    this._comboRowMetaAll.push(newMeta);
    this._comboRowMetaFiltered.push(newMeta);
    this._comboDataToAllIdx.push(this._comboAllData.length - 1);
    if (this._comboGridProvider) {
      this._comboGridProvider.doAdd({ axis: 'row', ranges: [{ offset: rowIndex, count: 1 }], version: 0 });
    }
    return true;
  };

  PageModule.prototype.duplicateComboRow = function (rowIndex) {
    if (rowIndex < 0 || rowIndex >= this._comboData.length) return false;
    this._comboSaveSnapshot();
    var actionsPos = this._comboColumnOrder.indexOf(COMBO_KEYS.length);
    var newRow = this._comboData[rowIndex].map(function (cell, idx) {
      return (idx === actionsPos) ? { data: '' } : { data: cell.data };
    });
    var newMeta = { combination_id: null };
    var insertAt = rowIndex + 1;
    this._comboData.splice(insertAt, 0, newRow);
    this._comboAllData.push(newRow.map(function (c) { return { data: c.data }; }));
    var newAllIdx = this._comboAllData.length - 1;
    this._comboRowHeaders[0].push(this._comboData.length);
    this._comboRowMetaAll.push(newMeta);
    this._comboRowMetaFiltered.splice(insertAt, 0, newMeta);
    this._comboDataToAllIdx.splice(insertAt, 0, newAllIdx);
    if (this._comboGridProvider) {
      this._comboGridProvider._setTotalCounts();
      this._comboGridProvider.doRefresh();
    }
    return true;
  };

  PageModule.prototype.deleteComboRow = function (rowIndex) {
    if (rowIndex < 0 || rowIndex >= this._comboData.length) return false;
    this._comboSaveSnapshot();
    var meta = this._comboRowMetaFiltered[rowIndex];
    if (meta && meta.combination_id !== null) {
      this._comboDeletedIds.push(meta.combination_id);
      delete this._comboModifiedIds[meta.combination_id];
    }
    var allIdx = this._comboDataToAllIdx[rowIndex];
    if (allIdx !== undefined) {
      this._comboAllData.splice(allIdx, 1);
      this._comboRowMetaAll.splice(allIdx, 1);
      this._comboDataToAllIdx.splice(rowIndex, 1);
      for (var i = 0; i < this._comboDataToAllIdx.length; i++) {
        if (this._comboDataToAllIdx[i] > allIdx) this._comboDataToAllIdx[i]--;
      }
    }
    this._comboData.splice(rowIndex, 1);
    this._comboRowHeaders[0].pop();
    this._comboRowMetaFiltered.splice(rowIndex, 1);
    if (this._comboGridProvider) {
      this._comboGridProvider._setTotalCounts();
      this._comboGridProvider.doRefresh();
    }
    return true;
  };

  PageModule.prototype.undoComboLastAction = function () {
    if (!this._comboHistory || this._comboHistory.length === 0) {
      return { isDirty: false, undoDisabled: true };
    }
    var snap = this._comboHistory.pop();
    this._comboData            = snap.data;
    this._comboAllData         = snap.allData;
    this._comboRowHeaders      = snap.rowHeaders;
    this._comboColumnHeaders   = snap.columnHeaders   || this._comboColumnHeaders;
    this._comboColumnOrder     = snap.columnOrder     || this._comboColumnOrder;
    this._comboDeletedIds      = snap.deletedIds;
    this._comboModifiedIds     = snap.modifiedIds;
    this._comboRowMetaAll      = snap.rowMetaAll;
    this._comboRowMetaFiltered = snap.rowMetaFiltered;
    this._comboDataToAllIdx    = snap.dataToAllIdx;
    if (this._comboGridProvider) {
      this._comboGridProvider.dataParameters = {
        data: this._comboData, rowHeader: this._comboRowHeaders, columnHeader: this._comboColumnHeaders
      };
      this._comboGridProvider._setTotalCounts();
      this._comboGridProvider.doRefresh();
    }
    var hasMods = Object.keys(this._comboModifiedIds).length > 0;
    var hasNew  = this._comboRowMetaAll.some(function (m) { return m && m.combination_id === null; });
    return { isDirty: hasMods || this._comboDeletedIds.length > 0 || hasNew,
             undoDisabled: this._comboHistory.length === 0 };
  };

  PageModule.prototype.prepareComboChangeSets = function () {
    var self = this;
    self._comboPendingDeletes = self._comboDeletedIds.slice();
    self._comboPendingUpdates = [];
    self._comboPendingCreates = [];

    for (var i = 0; i < self._comboAllData.length; i++) {
      var row  = self._comboAllData[i];
      var meta = self._comboRowMetaAll[i];
      if (!meta) continue;
      var body = {};
      self._comboColumnOrder.forEach(function (origIdx, dispIdx) {
        if (origIdx === COMBO_KEYS.length) return;
        var cellVal = row[dispIdx].data;
        body[COMBO_KEYS[origIdx]] = (cellVal === '') ? null : cellVal;
      });
      var comboId = meta.combination_id;
      if (comboId === null && !body['combination_name']) continue;
      if (comboId === null) {
        // Do NOT send combination_id in the POST body â€” the server auto-generates it.
        delete body['combination_id'];
        self._comboPendingCreates.push({ body: body });
      } else if (self._comboModifiedIds[comboId]) {
        self._comboPendingUpdates.push({ id: comboId, body: body });
      }
    }
    return true;
  };

  // â”€â”€â”€ Combo Batch Operations (mirrors main grid selectionChange/updateSelection/etc.) â”€â”€

  PageModule.prototype.comboSelectionChange = function (selection) {
    if (!selection || selection.length === 0) {
      return { inputTextValue: '', updateDisabled: true, addRemoveDisabled: true };
    }
    this._comboLastSelection = selection;
    var inputTextValue = '';
    var combogrid = document.getElementById('combodatagrid');
    if (combogrid && combogrid.currentCell && combogrid.currentCell.type === 'cell') {
      var row = combogrid.currentCell.indexes.row;
      var col = combogrid.currentCell.indexes.column;
      if (this._comboData[row] && this._comboData[row][col]) {
        inputTextValue = this._comboData[row][col].data;
      }
    }
    return { inputTextValue: inputTextValue, updateDisabled: false, addRemoveDisabled: false };
  };

  PageModule.prototype.comboUpdateSelection = function (selection, inputTextValue) {
    var effectiveSelection = (selection && selection.length > 0) ? selection : this._comboLastSelection;
    if (!effectiveSelection || effectiveSelection.length === 0) return false;
    var self = this;
    this._comboSaveSnapshot();
    var isDirty = false;
    effectiveSelection.forEach(function (value) {
      var startRow    = value.startIndex.row    || 0;
      var startColumn = value.startIndex.column || 0;
      var endRow    = value.endIndex.row    === -1 ? self._comboData.length - 1      : value.endIndex.row;
      var endColumn = value.endIndex.column === -1 ? self._comboColumnOrder.length - 1 : value.endIndex.column;
      for (var i = startRow; i <= endRow; i++) {
        for (var j = startColumn; j <= endColumn; j++) {
          var origIdx = self._comboColumnOrder[j];
          if (origIdx === COMBO_KEYS.length) continue; // skip actions
          var oldVal = self._comboData[i][j].data;
          if (String(oldVal) !== String(inputTextValue)) {
            self._comboData[i][j].data = inputTextValue;
            var rowMeta = self._comboRowMetaFiltered[i];
            if (rowMeta && rowMeta.combination_id !== null) {
              self._comboModifiedIds[rowMeta.combination_id] = true;
            }
            var allIdx = self._comboDataToAllIdx[i];
            if (allIdx !== undefined) {
              self._comboAllData[allIdx] = self._comboData[i].map(function (c) { return { data: c.data }; });
            }
            isDirty = true;
          }
        }
      }
    });
    if (isDirty && self._comboGridProvider) {
      self._comboGridProvider._setTotalCounts();
      self._comboGridProvider.doRefresh();
    }
    return isDirty;
  };

  PageModule.prototype.comboRemoveSelection = function (selection) {
    if (!selection || selection.length === 0) return false;
    var self = this;
    this._comboSaveSnapshot();
    var indexesToRemove = new Set();
    selection.forEach(function (value) {
      var startRow = value.startIndex.row || 0;
      var endRow   = value.endIndex.row === -1 ? self._comboData.length - 1 : value.endIndex.row;
      for (var i = startRow; i <= endRow; i++) { indexesToRemove.add(i); }
    });
    var indexArray = Array.from(indexesToRemove).sort(function (a, b) { return b - a; });
    var isDirty = false;
    indexArray.forEach(function (index) {
      if (index < 0 || index >= self._comboData.length) return;
      var meta = self._comboRowMetaFiltered[index];
      if (meta && meta.combination_id !== null) {
        self._comboDeletedIds.push(meta.combination_id);
        delete self._comboModifiedIds[meta.combination_id];
      }
      var allIdx = self._comboDataToAllIdx[index];
      if (allIdx !== undefined) {
        self._comboAllData.splice(allIdx, 1);
        self._comboRowMetaAll.splice(allIdx, 1);
        self._comboDataToAllIdx.splice(index, 1);
        for (var k = 0; k < self._comboDataToAllIdx.length; k++) {
          if (self._comboDataToAllIdx[k] > allIdx) self._comboDataToAllIdx[k]--;
        }
      }
      self._comboData.splice(index, 1);
      self._comboRowHeaders[0].splice(index, 1);
      self._comboRowMetaFiltered.splice(index, 1);
      isDirty = true;
    });
    if (isDirty && self._comboGridProvider) {
      for (var r = 0; r < self._comboRowHeaders[0].length; r++) { self._comboRowHeaders[0][r] = r + 1; }
      self._comboGridProvider._setTotalCounts();
      self._comboGridProvider.doRefresh();
    }
    return isDirty;
  };

  PageModule.prototype.comboAddSelection = function (selection) {
    if (!selection || selection.length === 0) return false;
    var self = this;
    this._comboSaveSnapshot();
    var indexesToDuplicate = new Set();
    selection.forEach(function (value) {
      var startRow = value.startIndex.row || 0;
      var endRow   = value.endIndex.row === -1 ? self._comboData.length - 1 : value.endIndex.row;
      for (var i = startRow; i <= endRow; i++) { indexesToDuplicate.add(i); }
    });
    var indexArray = Array.from(indexesToDuplicate).sort(function (a, b) { return b - a; });
    var actionsPos = self._comboColumnOrder.indexOf(COMBO_KEYS.length);
    var isDirty = false;
    indexArray.forEach(function (dupIdx) {
      if (dupIdx < 0 || dupIdx >= self._comboData.length) return;
      var newRow = self._comboData[dupIdx].map(function (cell, idx) {
        return (idx === actionsPos) ? { data: '' } : { data: cell.data };
      });
      var newMeta = { combination_id: null };
      var insertAt = dupIdx + 1;
      self._comboData.splice(insertAt, 0, newRow);
      self._comboAllData.push(newRow.map(function (c) { return { data: c.data }; }));
      var newAllIdx = self._comboAllData.length - 1;
      self._comboRowHeaders[0].splice(insertAt, 0, self._comboRowHeaders[0][dupIdx]);
      self._comboRowMetaAll.push(newMeta);
      self._comboRowMetaFiltered.splice(insertAt, 0, newMeta);
      self._comboDataToAllIdx.splice(insertAt, 0, newAllIdx);
      isDirty = true;
    });
    if (isDirty && self._comboGridProvider) {
      for (var r = 0; r < self._comboRowHeaders[0].length; r++) { self._comboRowHeaders[0][r] = r + 1; }
      self._comboGridProvider._setTotalCounts();
      self._comboGridProvider.doRefresh();
    }
    return isDirty;
  };

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // Combo Data Transfer (Cut, Copy, Paste, Fill)
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  PageModule.prototype._comboGetDataFromRange = function (range) {
    var startRow    = range.startIndex.row;
    var startColumn = range.startIndex.column;
    var endRow    = range.endIndex.row    === -1 ? this._comboData.length - 1           : range.endIndex.row;
    var endColumn = range.endIndex.column === -1 ? this._comboColumnOrder.length - 1    : range.endIndex.column;
    var dataMatrix = [];
    for (var i = startRow; i <= endRow; i++) {
      var rowArray = [];
      for (var j = startColumn; j <= endColumn; j++) {
        rowArray.push(this._comboData[i] && this._comboData[i][j] ? this._comboData[i][j].data : '');
      }
      dataMatrix.push(rowArray);
    }
    return dataMatrix;
  };

  PageModule.prototype._comboWriteToClipboard = function (event) {
    var dataMatrix = this._comboGetDataFromRange(event.detail.sourceRange);
    var clipboardData = dataMatrix.map(function (row) { return row.join('\t'); }).join('\n');
    return navigator.clipboard.writeText(clipboardData);
  };

  PageModule.prototype.handleComboCopy = function (event) {
    this._comboWriteToClipboard(event);
  };

  PageModule.prototype.handleComboCut = function (event) {
    var self = this;
    var sourceRange = event.detail.sourceRange;
    this._comboWriteToClipboard(event).then(function () {
      var startRow    = sourceRange.startIndex.row;
      var startColumn = sourceRange.startIndex.column;
      var endRow    = sourceRange.endIndex.row    === -1 ? self._comboData.length - 1        : sourceRange.endIndex.row;
      var endColumn = sourceRange.endIndex.column === -1 ? self._comboColumnOrder.length - 1 : sourceRange.endIndex.column;
      self._comboSaveSnapshot();
      var isDirty = false;
      for (var i = startRow; i <= endRow; i++) {
        for (var j = startColumn; j <= endColumn; j++) {
          var origIdx = self._comboColumnOrder[j];
          if (origIdx === COMBO_KEYS.length) continue;
          if (String(self._comboData[i][j].data) !== '') {
            self._comboData[i][j].data = '';
            var meta = self._comboRowMetaFiltered[i];
            if (meta && meta.combination_id !== null) { self._comboModifiedIds[meta.combination_id] = true; }
            var allIdx = self._comboDataToAllIdx[i];
            if (allIdx !== undefined) { self._comboAllData[allIdx] = self._comboData[i].map(function (c) { return { data: c.data }; }); }
            isDirty = true;
          }
        }
      }
      if (isDirty && self._comboGridProvider) {
        self._comboGridProvider.doUpdate({
          ranges: [{ rowOffset: startRow, columnOffset: startColumn, rowCount: endRow - startRow + 1, columnCount: endColumn - startColumn + 1 }],
          version: 0
        });
      }
    });
    return true;
  };

  PageModule.prototype.handleComboPaste = function (event) {
    var self = this;
    return navigator.clipboard.readText().then(function (clipboardData) {
      var rows = clipboardData.replace(/(\r\n|\n|\r)$/, '').split(/\r\n|\n|\r/g);
      var matrix = rows.map(function (row) { return row.split(/\t/g); });
      var pasteRowCount    = matrix.length;
      var pasteColumnCount = matrix[0].length;
      var targetRange      = event.detail.targetRange;
      var rowPasteOffset   = targetRange.startIndex.row;
      var columnPasteOffset = targetRange.startIndex.column;
      var rowPasteEnd    = Math.min(rowPasteOffset + pasteRowCount - 1,    self._comboData.length - 1);
      var columnPasteEnd = Math.min(columnPasteOffset + pasteColumnCount - 1, self._comboColumnOrder.length - 1);
      self._comboSaveSnapshot();
      var isDirty = false;
      for (var i = rowPasteOffset; i <= rowPasteEnd; i++) {
        for (var j = columnPasteOffset; j <= columnPasteEnd; j++) {
          var origIdx    = self._comboColumnOrder[j];
          if (origIdx === COMBO_KEYS.length) continue;
          var matrixRow    = (i - rowPasteOffset)    % pasteRowCount;
          var matrixColumn = (j - columnPasteOffset) % pasteColumnCount;
          var newValue = matrix[matrixRow][matrixColumn];
          if (String(self._comboData[i][j].data) !== String(newValue)) {
            self._comboData[i][j].data = newValue;
            var meta = self._comboRowMetaFiltered[i];
            if (meta && meta.combination_id !== null) { self._comboModifiedIds[meta.combination_id] = true; }
            var allIdx = self._comboDataToAllIdx[i];
            if (allIdx !== undefined) { self._comboAllData[allIdx] = self._comboData[i].map(function (c) { return { data: c.data }; }); }
            isDirty = true;
          }
        }
      }
      if (isDirty && self._comboGridProvider) {
        self._comboGridProvider.doUpdate({
          ranges: [{ rowOffset: rowPasteOffset, columnOffset: columnPasteOffset, rowCount: rowPasteEnd - rowPasteOffset + 1, columnCount: columnPasteEnd - columnPasteOffset + 1 }],
          version: 0
        });
        var combogrid = document.getElementById('combodatagrid');
        if (combogrid) {
          combogrid.selection = [{ startIndex: { row: rowPasteOffset, column: columnPasteOffset }, endIndex: { row: rowPasteEnd, column: columnPasteEnd } }];
        }
      }
      return isDirty;
    });
  };

  PageModule.prototype.handleComboFill = function (event) {
    var self = this;
    var sourceRange = event.detail.sourceRange;
    var targetRange = event.detail.targetRange;
    var fillMatrix    = this._comboGetDataFromRange(sourceRange);
    var fillRowOffset = targetRange.startIndex.row;
    var fillRowEnd    = targetRange.endIndex.row    === -1 ? self._comboData.length - 1        : targetRange.endIndex.row;
    var fillColumnOffset = targetRange.startIndex.column;
    var fillColumnEnd    = targetRange.endIndex.column === -1 ? self._comboColumnOrder.length - 1 : targetRange.endIndex.column;
    fillRowEnd    = Math.min(fillRowEnd,    self._comboData.length - 1);
    fillColumnEnd = Math.min(fillColumnEnd, self._comboColumnOrder.length - 1);
    var fillRowCount    = fillMatrix.length;
    var fillColumnCount = fillMatrix[0].length;
    var isDirty = false;
    this._comboSaveSnapshot();
    for (var i = fillRowOffset; i <= fillRowEnd; i++) {
      for (var j = fillColumnOffset; j <= fillColumnEnd; j++) {
        var origIdx = self._comboColumnOrder[j];
        if (origIdx === COMBO_KEYS.length) continue;
        var matrixRow    = Math.abs(i - targetRange.startIndex.row)    % fillRowCount;
        var matrixColumn = Math.abs(j - targetRange.startIndex.column) % fillColumnCount;
        if (fillRowOffset    < sourceRange.startIndex.row)    { matrixRow    = fillRowCount    - matrixRow    - 1; }
        if (fillColumnOffset < sourceRange.startIndex.column) { matrixColumn = fillColumnCount - matrixColumn - 1; }
        var newValue = fillMatrix[matrixRow][matrixColumn];
        if (String(self._comboData[i][j].data) !== String(newValue)) {
          self._comboData[i][j].data = newValue;
          var meta = self._comboRowMetaFiltered[i];
          if (meta && meta.combination_id !== null) { self._comboModifiedIds[meta.combination_id] = true; }
          var allIdx = self._comboDataToAllIdx[i];
          if (allIdx !== undefined) { self._comboAllData[allIdx] = self._comboData[i].map(function (c) { return { data: c.data }; }); }
          isDirty = true;
        }
      }
    }
    if (isDirty && self._comboGridProvider) {
      self._comboGridProvider.doUpdate({
        ranges: [{ rowOffset: fillRowOffset, columnOffset: fillColumnOffset, rowCount: fillRowEnd - fillRowOffset + 1, columnCount: fillColumnEnd - fillColumnOffset + 1 }],
        version: 0
      });
    }
    return isDirty;
  };

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // Combo Filter
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  PageModule.prototype.handleComboFilterRequest = function (event) {
    var attributeName = event.detail.item.data;
    this._comboCurrentFilterColumnIndex = event.detail.item.index;
    var popup = document.getElementById('comboFilterPopup');
    if (popup) {
      popup.open(event.detail.launcher, {
        of: event.detail.anchor,
        at: { horizontal: 'right', vertical: 'top' }
      });
    }
    return attributeName;
  };

  PageModule.prototype.closeComboFilterPopup = function () {
    var combogrid = document.getElementById('combodatagrid');
    if (combogrid) combogrid.focus();
  };

  PageModule.prototype.applyComboFilter = function (filterText) {
    var self = this;
    this._comboCurrentFilterText = (filterText || '').toString().toLowerCase();
    var popup = document.getElementById('comboFilterPopup');
    if (popup) popup.close();
    this._comboData = [];
    this._comboRowHeaders = [[]];
    this._comboRowMetaFiltered = [];
    this._comboDataToAllIdx = [];
    self._comboAllData.forEach(function (row, allIdx) {
      var matches = true;
      if (self._comboCurrentFilterText !== '' && self._comboCurrentFilterColumnIndex !== -1) {
        var cell = row[self._comboCurrentFilterColumnIndex];
        if (cell && cell.data !== undefined) {
          var cellValue = (cell.data || '').toString().toLowerCase();
          if (cellValue.indexOf(self._comboCurrentFilterText) === -1) { matches = false; }
        }
      }
      if (matches) {
        var rowCopy = row.map(function (c) { return { data: c.data }; });
        self._comboData.push(rowCopy);
        self._comboRowMetaFiltered.push(self._comboRowMetaAll[allIdx]);
        self._comboDataToAllIdx.push(allIdx);
        self._comboRowHeaders[0].push(self._comboData.length);
      }
    });
    if (this._comboGridProvider) {
      this._comboGridProvider.dataParameters = {
        data: this._comboData, rowHeader: this._comboRowHeaders, columnHeader: this._comboColumnHeaders
      };
      this._comboGridProvider._setTotalCounts();
      this._comboGridProvider.doRefresh();
    }
  };

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // Combo Hide / Show Columns & Rows
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  PageModule.prototype.getComboColumnHideOptions = function () {
    var options = COMBO_HEADERS.map(function (label, index) {
      return { value: index, label: label };
    });
    return new ArrayDataProvider(options, { keyAttributes: 'value' });
  };

  PageModule.prototype.buildComboRowHideOptions = function () {
    var self = this;
    var nameOrigIdx = COMBO_KEYS.indexOf('combination_name'); // = 0
    var nameDispPos = self._comboColumnOrder.indexOf(nameOrigIdx);
    var options = self._comboData.map(function (row, index) {
      var name = (nameDispPos >= 0 && row[nameDispPos]) ? row[nameDispPos].data : '';
      return { value: index, label: 'Row ' + (index + 1) + (name ? ' (' + name + ')' : '') };
    });
    return new ArrayDataProvider(options, { keyAttributes: 'value' });
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // Combo Drag & Drop (column + row reorder)
  // ═══════════════════════════════════════════════════════════════════════════

  PageModule.prototype.handleComboDragStart = function (event, dragContext) {
    this._comboDraggedIndex = (dragContext && dragContext.range) ? dragContext.range : [];
  };

  PageModule.prototype.handleComboDropColumns = function (event, dropHeaderContext) {
    var self = this;
    if (!self._comboGridProvider || !self._comboDraggedIndex || self._comboDraggedIndex.length === 0) return false;
    if (self._comboCurrentFilterText !== '') return false;
    if (self._comboDraggedIndex[0].startIndex.column === undefined) return false;

    var dropColIndex = dropHeaderContext.index;
    var position     = dropHeaderContext.position;
    var draggedColData   = [];
    var removeEventRanges = [];
    var beforeDropIndexCount = 0;
    this._comboSaveSnapshot();

    for (var i = 0; i < self._comboDraggedIndex.length; i++) {
      var startIndex = self._comboDraggedIndex[i].startIndex.column;
      var endIndex   = self._comboDraggedIndex[i].endIndex.column;
      var colsInSel  = 0;
      for (var k = startIndex; k <= endIndex; k++) {
        colsInSel++;
        var colFromData = self._comboData.map(function (row) { return row[k]; });
        var colFromAll  = self._comboAllData.map(function (row) { return row[k]; });
        draggedColData.push({
          header:     self._comboColumnHeaders[0][k],
          orderEntry: self._comboColumnOrder[k],
          colData:    colFromData,
          allColData: colFromAll
        });
        if (k < dropColIndex) beforeDropIndexCount++;
      }
      removeEventRanges.push({ offset: startIndex, count: colsInSel });
    }

    self._comboGridProvider.dispatchEvent(
      new ojdatagridprovider.DataGridProviderRemoveEvent({ axis: 'column', ranges: removeEventRanges, version: 0 })
    );

    for (var j = 0; j < draggedColData.length; j++) {
      var matchIndex = self._comboColumnHeaders[0].indexOf(draggedColData[j].header);
      self._comboColumnHeaders[0].splice(matchIndex, 1);
      self._comboColumnOrder.splice(matchIndex, 1);
      for (var r = 0; r < self._comboData.length;    r++) { self._comboData[r].splice(matchIndex, 1); }
      for (var a = 0; a < self._comboAllData.length; a++) { self._comboAllData[a].splice(matchIndex, 1); }
    }

    var adjustedDropIndex = dropColIndex - beforeDropIndexCount;
    if (position === 'after') adjustedDropIndex++;
    adjustedDropIndex = Math.max(0, Math.min(adjustedDropIndex, self._comboColumnHeaders[0].length));

    for (var m = draggedColData.length - 1; m >= 0; m--) {
      self._comboColumnHeaders[0].splice(adjustedDropIndex, 0, draggedColData[m].header);
      self._comboColumnOrder.splice(adjustedDropIndex, 0, draggedColData[m].orderEntry);
      for (var r2 = 0; r2 < self._comboData.length;    r2++) { self._comboData[r2].splice(adjustedDropIndex, 0, draggedColData[m].colData[r2]); }
      for (var a2 = 0; a2 < self._comboAllData.length; a2++) { self._comboAllData[a2].splice(adjustedDropIndex, 0, draggedColData[m].allColData[a2]); }
    }

    self._comboGridProvider.dispatchEvent(
      new ojdatagridprovider.DataGridProviderAddEvent({
        axis: 'column', ranges: [{ offset: adjustedDropIndex, count: draggedColData.length }], version: 0
      })
    );
    return false;
  };

  PageModule.prototype.handleComboDropRows = function (event, dropHeaderContext) {
    var self = this;
    if (!self._comboGridProvider || !self._comboDraggedIndex || self._comboDraggedIndex.length === 0) return false;
    if (self._comboCurrentFilterText !== '') return false;

    var dropRowIndex = dropHeaderContext.index;
    var draggedRowData    = [];
    var removeEventRanges = [];
    var beforeDropIndexCount = 0;
    this._comboSaveSnapshot();

    for (var i = 0; i < self._comboDraggedIndex.length; i++) {
      var startIndex = self._comboDraggedIndex[i].startIndex.row;
      var endIndex   = self._comboDraggedIndex[i].endIndex.row;
      var rowsInSel  = 0;
      for (var k = startIndex; k <= endIndex; k++) {
        rowsInSel++;
        draggedRowData.push({
          rowHeader: self._comboRowHeaders[0][k],
          rowData:   self._comboData[k],
          allData:   self._comboAllData[k],
          rowMeta:   self._comboRowMetaAll[k]
        });
        if (k < dropRowIndex) beforeDropIndexCount++;
      }
      removeEventRanges.push({ offset: startIndex, count: rowsInSel });
    }

    self._comboGridProvider.doRemove({ axis: 'row', ranges: removeEventRanges, version: 0 });

    for (var j = 0; j < draggedRowData.length; j++) {
      var matchIndex = self._comboRowHeaders[0].indexOf(draggedRowData[j].rowHeader);
      self._comboRowHeaders[0].splice(matchIndex, 1);
      self._comboData.splice(matchIndex, 1);
      self._comboAllData.splice(matchIndex, 1);
      self._comboRowMetaAll.splice(matchIndex, 1);
      self._comboRowMetaFiltered.splice(matchIndex, 1);
    }

    var adjustedDropIndex = dropRowIndex - beforeDropIndexCount;
    if (dropHeaderContext.position === 'after') adjustedDropIndex++;
    adjustedDropIndex = Math.max(0, Math.min(adjustedDropIndex, self._comboData.length));

    for (var m = draggedRowData.length - 1; m >= 0; m--) {
      self._comboRowHeaders[0].splice(adjustedDropIndex, 0, draggedRowData[m].rowHeader);
      self._comboData.splice(adjustedDropIndex, 0, draggedRowData[m].rowData);
      self._comboAllData.splice(adjustedDropIndex, 0, draggedRowData[m].allData);
      self._comboRowMetaAll.splice(adjustedDropIndex, 0, draggedRowData[m].rowMeta);
      self._comboRowMetaFiltered.splice(adjustedDropIndex, 0, draggedRowData[m].rowMeta);
    }

    self._comboDataToAllIdx = self._comboData.map(function (_, idx) { return idx; });
    self._comboGridProvider.doAdd({
      axis: 'row', ranges: [{ offset: adjustedDropIndex, count: draggedRowData.length }], version: 0
    });
    return false;
  };

  PageModule.prototype.getNextComboDelete = function () {
    return this._comboPendingDeletes.length > 0 ? { id: this._comboPendingDeletes.shift() } : null;
  };
  PageModule.prototype.getNextComboUpdate = function () {
    return this._comboPendingUpdates.length > 0 ? this._comboPendingUpdates.shift() : null;
  };
  PageModule.prototype.getNextComboCreate = function () {
    return this._comboPendingCreates.length > 0 ? this._comboPendingCreates.shift() : null;
  };
  PageModule.prototype.clearComboChangeSets = function () {
    this._comboDeletedIds     = [];
    this._comboModifiedIds    = {};
    this._comboPendingDeletes = [];
    this._comboPendingUpdates = [];
    this._comboPendingCreates = [];
  };

  // ═══════════════════════════════════════════════════════════════════════════════
  // Equipment Grid Methods
  // ═══════════════════════════════════════════════════════════════════════════════

  // ─── Equipment lookup helpers ─────────────────────────────────────────────────

  PageModule.prototype.buildEquipmentProvider = function (items) {
    var self = this;
    self._equipmentMap     = {};
    self._equipmentCodeMap = {};
    var options = (items || []).map(function (eq) {
      var displayName = eq.equipment_name || eq.name || String(eq.cr_equipment_id);
      var displayCode = eq.equipment_code || eq.code || '';
      self._equipmentMap[eq.cr_equipment_id]     = displayName;
      self._equipmentCodeMap[eq.cr_equipment_id] = displayCode;
      return { value: eq.cr_equipment_id, label: displayName };
    });
    self._equipmentProvider = new ArrayDataProvider(options, { keyAttributes: 'value' });
    return self._equipmentProvider;
  };

  PageModule.prototype.getEquipmentName = function (equipId) {
    if (!equipId && equipId !== 0) return '';
    return this._equipmentMap ? (this._equipmentMap[equipId] || '') : '';
  };

  PageModule.prototype.getEquipmentCode = function (equipId) {
    if (!equipId && equipId !== 0) return '';
    return this._equipmentCodeMap ? (this._equipmentCodeMap[equipId] || '') : '';
  };

  PageModule.prototype.getEquipmentProvider = function () {
    return this._equipmentProvider;
  };

  // ─── Grid initialization ──────────────────────────────────────────────────────

  PageModule.prototype._equipCreateProvider = function () {
    this._equipGridProvider = new DemoArrayDataGridProvider(
      { data: this._equipData, rowHeader: this._equipRowHeaders, columnHeader: this._equipColumnHeaders },
      {}, {}, {}, {}, {}
    );
  };

  PageModule.prototype._equipClearTracking = function () {
    this._equipDeletedIds     = [];
    this._equipModifiedIds    = {};
    this._equipPendingDeletes = [];
    this._equipPendingUpdates = [];
    this._equipPendingCreates = [];
    this._equipHistory        = [];
  };

  PageModule.prototype._equipSaveSnapshot = function () {
    this._equipHistory.push(JSON.parse(JSON.stringify({
      data:            this._equipData,
      allData:         this._equipAllData,
      rowHeaders:      this._equipRowHeaders,
      columnHeaders:   this._equipColumnHeaders,
      columnOrder:     this._equipColumnOrder,
      deletedIds:      this._equipDeletedIds,
      modifiedIds:     this._equipModifiedIds,
      rowMetaAll:      this._equipRowMetaAll,
      rowMetaFiltered: this._equipRowMetaFiltered,
      dataToAllIdx:    this._equipDataToAllIdx
    })));
  };

  PageModule.prototype.initEquipGridFromLines = function (lines, equipment) {
    var self = this;
    self._equipColumnOrder   = initEquipColumnOrder().slice();
    self._equipColumnHeaders = [self._equipColumnOrder.map(function (i) { return EQUIP_COLUMN_HEADERS[i]; })];
    self._equipCurrentFilterText = '';
    self._equipCurrentFilterColumnIndex = -1;
    self._equipData           = [];
    self._equipAllData        = [];
    self._equipRowHeaders     = [[]];
    self._equipRowMetaAll     = [];
    self._equipRowMetaFiltered = [];
    self._equipDataToAllIdx   = [];

    // Refresh equipment lookup if provided
    if (equipment) { self.buildEquipmentProvider(equipment); }

    (lines || []).forEach(function (item, index) {
      var row = EQUIP_COLUMN_KEYS.map(function (key) {
        var v = item[key];
        return { data: v !== undefined && v !== null ? v : '' };
      });
      row.push({ data: '' }); // Actions placeholder
      // Reorder to display order
      var displayRow = self._equipColumnOrder.map(function (origIdx) {
        if (origIdx === EQUIP_COLUMN_KEYS.length) return { data: '' };
        return row[origIdx] || { data: '' };
      });
      self._equipData.push(displayRow);
      self._equipAllData.push(displayRow.map(function (c) { return { data: c.data }; }));
      self._equipRowHeaders[0].push(index + 1);
      var meta = {
        time_entry_line_id: item.time_entry_line_id || null,
        equipment_id:       item.equipment_id        || null,
        time_card_id:       item.time_card_id        || null,
        work_date:          item.work_date            || null,
        crew_id:            item.crew_id              || null,
        request_line_id:    item.request_line_id      || null
      };
      self._equipRowMetaAll.push(meta);
      self._equipRowMetaFiltered.push(meta);
      self._equipDataToAllIdx.push(index);
    });

    self._equipCreateProvider();
    self._equipClearTracking();
    return self._equipGridProvider;
  };

  PageModule.prototype.initEquipGridFromEquipment = function (equipment, timeCardId, crewId, workDate) {
    var self = this;
    self._equipColumnOrder   = initEquipColumnOrder().slice();
    self._equipColumnHeaders = [self._equipColumnOrder.map(function (i) { return EQUIP_COLUMN_HEADERS[i]; })];
    self._equipCurrentFilterText = '';
    self._equipCurrentFilterColumnIndex = -1;
    self._equipData           = [];
    self._equipAllData        = [];
    self._equipRowHeaders     = [[]];
    self._equipRowMetaAll     = [];
    self._equipRowMetaFiltered = [];
    self._equipDataToAllIdx   = [];

    if (equipment) { self.buildEquipmentProvider(equipment); }

    (equipment || []).forEach(function (eq, index) {
      var row = EQUIP_COLUMN_KEYS.map(function (key) {
        if (key === 'equipment_code') return { data: eq.equipment_code || eq.code || '' };
        if (key === 'equipment_name') return { data: eq.cr_equipment_id || '' };
        if (key === 'hours')          return { data: 0 };
        if (key === 'work_date')      return { data: workDate || '' };
        return { data: '' };
      });
      row.push({ data: '' }); // Actions placeholder
      var displayRow = self._equipColumnOrder.map(function (origIdx) {
        if (origIdx === EQUIP_COLUMN_KEYS.length) return { data: '' };
        return row[origIdx] || { data: '' };
      });
      self._equipData.push(displayRow);
      self._equipAllData.push(displayRow.map(function (c) { return { data: c.data }; }));
      self._equipRowHeaders[0].push(index + 1);
      var meta = {
        time_entry_line_id: null,
        equipment_id:       eq.cr_equipment_id,
        time_card_id:       timeCardId,
        work_date:          workDate,
        crew_id:            crewId
      };
      self._equipRowMetaAll.push(meta);
      self._equipRowMetaFiltered.push(meta);
      self._equipDataToAllIdx.push(index);
    });

    self._equipCreateProvider();
    self._equipClearTracking();
    return self._equipGridProvider;
  };

  PageModule.prototype.initEquipGridEmpty = function () {
    var self = this;
    // Dynamic headers based on current week
    var weekStart = this._currentWorkDate || '2026-04-20';
    var start = new Date(weekStart + 'T00:00:00');
    var headers = EQUIP_COLUMN_HEADERS.slice();
    for (var i = 0; i < 7; i++) {
      var d = new Date(start);
      d.setDate(start.getDate() + i);
      var formatted = d.getDate() + '-' + MONTH_NAMES[d.getMonth()] + '-' + d.getFullYear();
      headers[10 + i] = formatted + ' Hours';
    }
    self._equipColumnHeaders = [self._equipColumnOrder.map(function (i) { 
      if (i === EQUIP_COLUMN_KEYS.length) return '';
      return headers[i]; 
    })];

    // Demo equipment data (50 rows)
    var demoEquip = [
      { request_number: '2277', class_name: 'CRAWLER CRANE', equipment_name: 'Multi-Axle Trailer', hours_type: 'Usage', status: 'DRAFT', project_name: 'OAK- Houston Metro Power', task_name: 'WP1.3', start_date: '20-Apr-2026', end_date: '22-Apr-2026', non_labor_resource: 'OAK_EQUIPMENT', hours_day1: 13, hours_day2: 13, hours_day3: 0, hours_day4: 0, hours_day5: 0, hours_day6: 0, hours_day7: 0 },
      { request_number: '2256', class_name: 'BULK ITEMS', equipment_name: 'HDPE Pipes', hours_type: 'Usage', status: 'DRAFT', project_name: 'OAK- Houston Metro Power', task_name: 'WP1.2', start_date: '20-Apr-2026', end_date: '22-Apr-2026', non_labor_resource: 'OAK_EQUIPMENT', hours_day1: 12, hours_day2: 12, hours_day3: 0, hours_day4: 0, hours_day5: 0, hours_day6: 0, hours_day7: 0 },
      { request_number: '2190', class_name: 'CRAWLER CRANE', equipment_name: 'Manitowac Crawler Crane MLC90A-1', hours_type: 'Usage', status: 'DRAFT', project_name: 'Centerpoint - Houston Metro Power Restoration', task_name: 'EQUIPMENT', start_date: '06-Apr-2026', end_date: '20-Apr-2026', non_labor_resource: '', hours_day1: 0, hours_day2: 0, hours_day3: 0, hours_day4: 0, hours_day5: 0, hours_day6: 0, hours_day7: 0 }
    ];

    for (var j = 0; j < 47; j++) {
      demoEquip.push({
        request_number: (4000 + j).toString(),
        class_name: 'GENERATOR',
        equipment_name: 'GenSet ' + (j + 1),
        hours_type: 'Usage',
        status: 'DRAFT',
        project_name: 'Project ' + (j % 3 + 1),
        task_name: 'Task ' + (j % 5 + 1),
        start_date: '20-Apr-2026',
        end_date: '26-Apr-2026',
        non_labor_resource: '',
        hours_day1: (j % 4 + 1),
        hours_day2: (j % 4 + 1),
        hours_day3: 0,
        hours_day4: 0,
        hours_day5: 0,
        hours_day6: 0,
        hours_day7: 0
      });
    }

    demoEquip.forEach(function (item, index) {
      var row = self._equipColumnOrder.map(function (origIdx) {
        if (origIdx === EQUIP_COLUMN_KEYS.length) return { data: '' }; // Actions placeholder
        var key = EQUIP_COLUMN_KEYS[origIdx];
        var v = item[key];
        return { data: v !== undefined && v !== null ? v : '' };
      });
      self._equipData.push(row);
      self._equipAllData.push(row.map(function (c) { return { data: c.data }; }));
      self._equipRowHeaders[0].push(index + 1);
      var meta = { equipment_id: item.equipment_name, time_entry_line_id: null };
      self._equipRowMetaAll.push(meta);
      self._equipRowMetaFiltered.push(meta);
      self._equipDataToAllIdx.push(index);
    });

    self._equipCreateProvider();
    self._equipClearTracking();
    return self._equipGridProvider;
  };

  // Re-init after save (refreshed lines + equipment list)
  PageModule.prototype.processReloadedEquipLines = function (lines, equipment) {
    return this.initEquipGridFromLines(lines, equipment);
  };

  // ─── Column type / editability / header style ─────────────────────────────────

  PageModule.prototype.getEquipColumnType = function (displayIdx) {
    var origIdx = this._equipColumnOrder[displayIdx];
    if (origIdx === EQUIP_COLUMN_KEYS.length) return 'actions';
    return EQUIP_COLUMN_TYPES[origIdx] || 'text';
  };

  PageModule.prototype.getEquipIsEditable = function (cellContext) {
    var origIdx = this._equipColumnOrder[cellContext.indexes.column];
    return undefined;
  };

  PageModule.prototype.getEquipHeaderFilterable = function (headerContext) {
    var origIdx = this._equipColumnOrder[headerContext.index];
    if (origIdx === EQUIP_COLUMN_KEYS.length) return 'disable';
    return 'auto';
  };

  PageModule.prototype.getEquipColumnHeaderStyle = function (headerContext) {
    var origIdx = this._equipColumnOrder[headerContext.index];
    if (origIdx === EQUIP_COLUMN_KEYS.length) return 'width:57px;';
    var key = EQUIP_COLUMN_KEYS[origIdx];
    if (key === 'request_number')     return 'width:120px;';
    if (key === 'class_name')         return 'width:140px;';
    if (key === 'equipment_name')     return 'width:240px;';
    if (key === 'hours_type')         return 'width:100px;';
    if (key === 'status')             return 'width:90px;';
    if (key === 'project_name')       return 'width:280px;';
    if (key === 'task_name')          return 'width:140px;';
    if (key === 'start_date')         return 'width:110px;';
    if (key === 'end_date')           return 'width:110px;';
    if (key === 'non_labor_resource') return 'width:180px;';
    if (key && key.indexOf('hours_day') === 0) return 'width:95px;';
    return 'width:140px;';
  };

  // ─── Edit handlers ────────────────────────────────────────────────────────────

  PageModule.prototype.handleEquipEdit = function (event) {
    this._equipOriginalData = Object.assign({}, event.detail.cellContext.data);
  };

  PageModule.prototype.handleEquipEditEnd = function (event) {
    var detail = event.detail;
    if (detail.cancelEdit) {
      detail.cellContext.data.data = this._equipOriginalData.data;
      return false;
    }
    var rowIndex    = detail.cellContext.indexes.row;
    var columnIndex = detail.cellContext.indexes.column;
    var currentValue = (this._equipData[rowIndex] && this._equipData[rowIndex][columnIndex] !== undefined)
      ? this._equipData[rowIndex][columnIndex].data
      : detail.cellContext.data.data;

    if (this._equipOriginalData && String(this._equipOriginalData.data) !== String(currentValue)) {
      this._equipData[rowIndex][columnIndex].data = currentValue;

      // Auto-populate combination fields when combination_id changes
      var origIdx = this._equipColumnOrder[columnIndex];
      if (EQUIP_COLUMN_KEYS[origIdx] === 'combination_id' && currentValue) {
        var combo = this._combinationsMap[currentValue];
        if (combo) {
          var self = this;
          Object.keys(COMBO_AUTO_COLS).forEach(function (fieldName) {
            var equipOrigIdx = EQUIP_COLUMN_KEYS.indexOf(fieldName);
            if (equipOrigIdx === -1) return;
            var dispPos = self._equipColumnOrder.indexOf(equipOrigIdx);
            if (dispPos === -1) return;
            var val = combo[fieldName];
            self._equipData[rowIndex][dispPos].data = (val !== undefined && val !== null) ? val : '';
          });
        }
      }

      var allIdx = this._equipDataToAllIdx[rowIndex];
      if (allIdx !== undefined) {
        this._equipAllData[allIdx] = this._equipData[rowIndex].map(function (c) { return { data: c.data }; });
      }
      var meta = this._equipRowMetaFiltered[rowIndex];
      if (meta && meta.time_entry_line_id !== null) {
        this._equipModifiedIds[meta.time_entry_line_id] = true;
      }
      if (this._equipGridProvider) {
        this._equipGridProvider.doUpdate({
          ranges: [{ rowOffset: rowIndex, columnOffset: 0, rowCount: 1, columnCount: this._equipColumnOrder.length }],
          version: 0
        });
      }
      return true;
    }
    return false;
  };

  // ─── Row management ───────────────────────────────────────────────────────────

  PageModule.prototype.addEquipRow = function () {
    this._equipSaveSnapshot();
    var newRow = this._equipColumnOrder.map(function (origIdx) {
      if (origIdx === EQUIP_COLUMN_KEYS.length) return { data: '' };
      if (EQUIP_COLUMN_TYPES[origIdx] === 'number') return { data: 0 };
      return { data: '' };
    });
    var rowIndex = this._equipData.length;
    this._equipData.push(newRow);
    this._equipAllData.push(newRow.map(function (c) { return { data: c.data }; }));
    this._equipRowHeaders[0].push(rowIndex + 1);
    var newMeta = { time_entry_line_id: null, equipment_id: null, time_card_id: this._currentTimeCardId, work_date: this._currentWorkDate, crew_id: this._currentCrewId, request_line_id: null };
    this._equipRowMetaAll.push(newMeta);
    this._equipRowMetaFiltered.push(newMeta);
    this._equipDataToAllIdx.push(this._equipAllData.length - 1);
    if (this._equipGridProvider) {
      this._equipGridProvider.doAdd({ axis: 'row', ranges: [{ offset: rowIndex, count: 1 }], version: 0 });
    }
    return true;
  };

  PageModule.prototype.duplicateEquipRow = function (rowIndex) {
    if (rowIndex < 0 || rowIndex >= this._equipData.length) return false;
    this._equipSaveSnapshot();
    var actionsPos = this._equipColumnOrder.indexOf(EQUIP_COLUMN_KEYS.length);
    var newRow = this._equipData[rowIndex].map(function (cell, idx) {
      return (idx === actionsPos) ? { data: '' } : { data: cell.data };
    });
    var srcMeta = this._equipRowMetaFiltered[rowIndex];
    var newMeta = { time_entry_line_id: null, equipment_id: srcMeta ? srcMeta.equipment_id : null, time_card_id: this._currentTimeCardId, work_date: this._currentWorkDate, crew_id: this._currentCrewId };
    var insertAt = rowIndex + 1;
    this._equipData.splice(insertAt, 0, newRow);
    this._equipAllData.push(newRow.map(function (c) { return { data: c.data }; }));
    var newAllIdx = this._equipAllData.length - 1;
    this._equipRowHeaders[0].push(this._equipData.length);
    this._equipRowMetaAll.push(newMeta);
    this._equipRowMetaFiltered.splice(insertAt, 0, newMeta);
    this._equipDataToAllIdx.splice(insertAt, 0, newAllIdx);
    if (this._equipGridProvider) {
      this._equipGridProvider._setTotalCounts();
      this._equipGridProvider.doRefresh();
    }
    return true;
  };

  PageModule.prototype.deleteEquipRow = function (rowIndex) {
    if (rowIndex < 0 || rowIndex >= this._equipData.length) return false;
    this._equipSaveSnapshot();
    var meta = this._equipRowMetaFiltered[rowIndex];
    if (meta && meta.time_entry_line_id !== null) {
      this._equipDeletedIds.push(meta.time_entry_line_id);
      delete this._equipModifiedIds[meta.time_entry_line_id];
    }
    var allIdx = this._equipDataToAllIdx[rowIndex];
    if (allIdx !== undefined) {
      this._equipAllData.splice(allIdx, 1);
      this._equipRowMetaAll.splice(allIdx, 1);
      this._equipDataToAllIdx.splice(rowIndex, 1);
      for (var i = 0; i < this._equipDataToAllIdx.length; i++) {
        if (this._equipDataToAllIdx[i] > allIdx) this._equipDataToAllIdx[i]--;
      }
    }
    this._equipData.splice(rowIndex, 1);
    this._equipRowHeaders[0].pop();
    this._equipRowMetaFiltered.splice(rowIndex, 1);
    if (this._equipGridProvider) {
      this._equipGridProvider._setTotalCounts();
      this._equipGridProvider.doRefresh();
    }
    return true;
  };

  PageModule.prototype.undoEquipLastAction = function () {
    if (!this._equipHistory || this._equipHistory.length === 0) {
      return { isDirty: false, undoDisabled: true };
    }
    var snap = this._equipHistory.pop();
    this._equipData            = snap.data;
    this._equipAllData         = snap.allData;
    this._equipRowHeaders      = snap.rowHeaders;
    this._equipColumnHeaders   = snap.columnHeaders   || this._equipColumnHeaders;
    this._equipColumnOrder     = snap.columnOrder     || this._equipColumnOrder;
    this._equipDeletedIds      = snap.deletedIds;
    this._equipModifiedIds     = snap.modifiedIds;
    this._equipRowMetaAll      = snap.rowMetaAll;
    this._equipRowMetaFiltered = snap.rowMetaFiltered;
    this._equipDataToAllIdx    = snap.dataToAllIdx;
    if (this._equipGridProvider) {
      this._equipGridProvider.dataParameters = {
        data: this._equipData, rowHeader: this._equipRowHeaders, columnHeader: this._equipColumnHeaders
      };
      this._equipGridProvider._setTotalCounts();
      this._equipGridProvider.doRefresh();
    }
    var hasMods = Object.keys(this._equipModifiedIds).length > 0;
    var hasNew  = this._equipRowMetaAll.some(function (m) { return m && m.time_entry_line_id === null; });
    return { isDirty: hasMods || this._equipDeletedIds.length > 0 || hasNew,
             undoDisabled: this._equipHistory.length === 0 };
  };

  // ─── Save / Change Sets ───────────────────────────────────────────────────────

  PageModule.prototype.prepareEquipChangeSets = function () {
    var self = this;

    console.log('[prepareEquipChangeSets] _equipAllData length:', self._equipAllData.length);
    console.log('[prepareEquipChangeSets] _equipRowMetaAll length:', self._equipRowMetaAll.length);
    console.log('[prepareEquipChangeSets] _equipModifiedIds:', JSON.stringify(self._equipModifiedIds));

    self._equipPendingDeletes = self._equipDeletedIds.slice();
    self._equipPendingUpdates = [];
    self._equipPendingCreates = [];

    for (var i = 0; i < self._equipAllData.length; i++) {
      var row  = self._equipAllData[i];
      var meta = self._equipRowMetaAll[i];
      if (!meta) continue;

      var body = {};
      for (var k = 0; k < self._equipColumnOrder.length; k++) {
        var origColIdx = self._equipColumnOrder[k];
        if (origColIdx === EQUIP_COLUMN_KEYS.length) continue;
        var fieldName = EQUIP_COLUMN_KEYS[origColIdx];
        if (EQUIP_COLS_SKIP_SAVE[fieldName]) continue;
        var cellVal = row[k].data;
        body[fieldName] = (cellVal === '') ? null : cellVal;
      }
      body.equipment_id  = meta.equipment_id;
      body.work_date     = meta.work_date;
      body.crew_id       = meta.crew_id;
      body.time_card_id  = meta.time_card_id;
      body.request_line_id = meta.request_line_id;

      var lineId = meta.time_entry_line_id;
      if (lineId === null) {
        self._equipPendingCreates.push({ body: body });
      } else if (self._equipModifiedIds[lineId]) {
        self._equipPendingUpdates.push({ id: lineId, body: body });
      }
    }
    return true;
  };

  PageModule.prototype.getNextEquipDelete = function () {
    return this._equipPendingDeletes.length > 0 ? { id: this._equipPendingDeletes.shift() } : null;
  };
  PageModule.prototype.getNextEquipUpdate = function () {
    return this._equipPendingUpdates.length > 0 ? this._equipPendingUpdates.shift() : null;
  };
  PageModule.prototype.getNextEquipCreate = function () {
    return this._equipPendingCreates.length > 0 ? this._equipPendingCreates.shift() : null;
  };
  PageModule.prototype.clearEquipChangeSets = function () {
    this._equipDeletedIds     = [];
    this._equipModifiedIds    = {};
    this._equipPendingDeletes = [];
    this._equipPendingUpdates = [];
    this._equipPendingCreates = [];
  };

  // ─── Selection / Batch Update ─────────────────────────────────────────────────

  PageModule.prototype.equipSelectionChange = function (selection) {
    if (!selection || selection.length === 0) {
      return { inputTextValue: '', updateDisabled: true, addRemoveDisabled: true };
    }
    this._equipLastSelection = selection;
    var inputTextValue = '';
    var equipgrid = document.getElementById('equipdatagrid');
    if (equipgrid && equipgrid.currentCell && equipgrid.currentCell.type === 'cell') {
      var row = equipgrid.currentCell.indexes.row;
      var col = equipgrid.currentCell.indexes.column;
      if (this._equipData[row] && this._equipData[row][col]) {
        inputTextValue = this._equipData[row][col].data;
      }
    }
    return { inputTextValue: inputTextValue, updateDisabled: false, addRemoveDisabled: false };
  };

  PageModule.prototype.equipUpdateSelection = function (selection, inputTextValue) {
    var effectiveSelection = (selection && selection.length > 0) ? selection : this._equipLastSelection;
    if (!effectiveSelection || effectiveSelection.length === 0) return false;
    var self = this;
    this._equipSaveSnapshot();
    var isDirty = false;
    effectiveSelection.forEach(function (value) {
      var startRow    = value.startIndex.row    || 0;
      var startColumn = value.startIndex.column || 0;
      var endRow    = value.endIndex.row    === -1 ? self._equipData.length - 1        : value.endIndex.row;
      var endColumn = value.endIndex.column === -1 ? self._equipColumnOrder.length - 1 : value.endIndex.column;
      for (var i = startRow; i <= endRow; i++) {
        for (var j = startColumn; j <= endColumn; j++) {
          var origIdx = self._equipColumnOrder[j];
          if (origIdx === EQUIP_COLUMN_KEYS.length) continue;
          var oldVal = self._equipData[i][j].data;
          if (String(oldVal) !== String(inputTextValue)) {
            self._equipData[i][j].data = inputTextValue;
            var rowMeta = self._equipRowMetaFiltered[i];
            if (rowMeta && rowMeta.time_entry_line_id !== null) {
              self._equipModifiedIds[rowMeta.time_entry_line_id] = true;
            }
            var allIdx = self._equipDataToAllIdx[i];
            if (allIdx !== undefined) {
              self._equipAllData[allIdx] = self._equipData[i].map(function (c) { return { data: c.data }; });
            }
            isDirty = true;
          }
        }
      }
    });
    if (isDirty && self._equipGridProvider) {
      self._equipGridProvider._setTotalCounts();
      self._equipGridProvider.doRefresh();
    }
    this._calculateOverallTotals();
    return isDirty;
  };

  PageModule.prototype.equipRemoveSelection = function (selection) {
    if (!selection || selection.length === 0) return false;
    var self = this;
    this._equipSaveSnapshot();
    var indexesToRemove = new Set();
    selection.forEach(function (value) {
      var startRow = value.startIndex.row || 0;
      var endRow   = value.endIndex.row === -1 ? self._equipData.length - 1 : value.endIndex.row;
      for (var i = startRow; i <= endRow; i++) { indexesToRemove.add(i); }
    });
    var indexArray = Array.from(indexesToRemove).sort(function (a, b) { return b - a; });
    var isDirty = false;
    indexArray.forEach(function (index) {
      if (index < 0 || index >= self._equipData.length) return;
      var meta = self._equipRowMetaFiltered[index];
      if (meta && meta.time_entry_line_id !== null) {
        self._equipDeletedIds.push(meta.time_entry_line_id);
        delete self._equipModifiedIds[meta.time_entry_line_id];
      }
      var allIdx = self._equipDataToAllIdx[index];
      if (allIdx !== undefined) {
        self._equipAllData.splice(allIdx, 1);
        self._equipRowMetaAll.splice(allIdx, 1);
        self._equipDataToAllIdx.splice(index, 1);
        for (var k = 0; k < self._equipDataToAllIdx.length; k++) {
          if (self._equipDataToAllIdx[k] > allIdx) self._equipDataToAllIdx[k]--;
        }
      }
      self._equipData.splice(index, 1);
      self._equipRowHeaders[0].splice(index, 1);
      self._equipRowMetaFiltered.splice(index, 1);
      isDirty = true;
    });
    if (isDirty && self._equipGridProvider) {
      for (var r = 0; r < self._equipRowHeaders[0].length; r++) { self._equipRowHeaders[0][r] = r + 1; }
      self._equipGridProvider._setTotalCounts();
      self._equipGridProvider.doRefresh();
    }
    this._calculateOverallTotals();
    return isDirty;
  };

  PageModule.prototype.equipAddSelection = function (selection) {
    if (!selection || selection.length === 0) return false;
    var self = this;
    this._equipSaveSnapshot();
    var indexesToDuplicate = new Set();
    selection.forEach(function (value) {
      var startRow = value.startIndex.row || 0;
      var endRow   = value.endIndex.row === -1 ? self._equipData.length - 1 : value.endIndex.row;
      for (var i = startRow; i <= endRow; i++) { indexesToDuplicate.add(i); }
    });
    var indexArray = Array.from(indexesToDuplicate).sort(function (a, b) { return b - a; });
    var actionsPos = self._equipColumnOrder.indexOf(EQUIP_COLUMN_KEYS.length);
    var isDirty = false;
    indexArray.forEach(function (dupIdx) {
      if (dupIdx < 0 || dupIdx >= self._equipData.length) return;
      var newRow = self._equipData[dupIdx].map(function (cell, idx) {
        return (idx === actionsPos) ? { data: '' } : { data: cell.data };
      });
      var srcMeta = self._equipRowMetaFiltered[dupIdx];
      var newMeta = {
        time_entry_line_id: null,
        equipment_id: srcMeta ? srcMeta.equipment_id : null,
        time_card_id: self._currentTimeCardId,
        work_date: self._currentWorkDate,
        crew_id: self._currentCrewId,
        request_line_id: srcMeta ? srcMeta.request_line_id : null
      };
      var insertAt = dupIdx + 1;
      self._equipData.splice(insertAt, 0, newRow);
      self._equipAllData.push(newRow.map(function (c) { return { data: c.data }; }));
      var newAllIdx = self._equipAllData.length - 1;
      self._equipRowHeaders[0].splice(insertAt, 0, self._equipRowHeaders[0][dupIdx]);
      self._equipRowMetaAll.push(newMeta);
      self._equipRowMetaFiltered.splice(insertAt, 0, newMeta);
      self._equipDataToAllIdx.splice(insertAt, 0, newAllIdx);
      isDirty = true;
    });
    if (isDirty && self._equipGridProvider) {
      for (var r = 0; r < self._equipRowHeaders[0].length; r++) { self._equipRowHeaders[0][r] = r + 1; }
      self._equipGridProvider._setTotalCounts();
      self._equipGridProvider.doRefresh();
    }
    this._calculateOverallTotals();
    return isDirty;
  };

  // ─── Data Transfer (Cut/Copy/Paste/Fill) ──────────────────────────────────────

  PageModule.prototype._equipGetDataFromRange = function (range) {
    var startRow    = range.startIndex.row;
    var startColumn = range.startIndex.column;
    var endRow    = range.endIndex.row    === -1 ? this._equipData.length - 1           : range.endIndex.row;
    var endColumn = range.endIndex.column === -1 ? this._equipColumnOrder.length - 1    : range.endIndex.column;
    var dataMatrix = [];
    for (var i = startRow; i <= endRow; i++) {
      var rowArray = [];
      for (var j = startColumn; j <= endColumn; j++) {
        rowArray.push(this._equipData[i] && this._equipData[i][j] ? this._equipData[i][j].data : '');
      }
      dataMatrix.push(rowArray);
    }
    return dataMatrix;
  };

  PageModule.prototype._equipWriteToClipboard = function (event) {
    var dataMatrix = this._equipGetDataFromRange(event.detail.sourceRange);
    var clipboardData = dataMatrix.map(function (row) { return row.join('\t'); }).join('\n');
    return navigator.clipboard.writeText(clipboardData);
  };

  PageModule.prototype.handleEquipCopy = function (event) {
    this._equipWriteToClipboard(event);
  };

  PageModule.prototype.handleEquipCut = function (event) {
    var self = this;
    var sourceRange = event.detail.sourceRange;
    this._equipWriteToClipboard(event).then(function () {
      var startRow    = sourceRange.startIndex.row;
      var startColumn = sourceRange.startIndex.column;
      var endRow    = sourceRange.endIndex.row    === -1 ? self._equipData.length - 1        : sourceRange.endIndex.row;
      var endColumn = sourceRange.endIndex.column === -1 ? self._equipColumnOrder.length - 1 : sourceRange.endIndex.column;
      self._equipSaveSnapshot();
      var isDirty = false;
      for (var i = startRow; i <= endRow; i++) {
        for (var j = startColumn; j <= endColumn; j++) {
          var origIdx = self._equipColumnOrder[j];
          if (origIdx === EQUIP_COLUMN_KEYS.length) continue;
          if (String(self._equipData[i][j].data) !== '') {
            self._equipData[i][j].data = '';
            var meta = self._equipRowMetaFiltered[i];
            if (meta && meta.time_entry_line_id !== null) { self._equipModifiedIds[meta.time_entry_line_id] = true; }
            var allIdx = self._equipDataToAllIdx[i];
            if (allIdx !== undefined) { self._equipAllData[allIdx] = self._equipData[i].map(function (c) { return { data: c.data }; }); }
            isDirty = true;
          }
        }
      }
      if (isDirty && self._equipGridProvider) {
        self._equipGridProvider.doUpdate({
          ranges: [{ rowOffset: startRow, columnOffset: startColumn, rowCount: endRow - startRow + 1, columnCount: endColumn - startColumn + 1 }],
          version: 0
        });
      }
    });
    return true;
  };

  PageModule.prototype.handleEquipPaste = function (event) {
    var self = this;
    return navigator.clipboard.readText().then(function (clipboardData) {
      var rows = clipboardData.replace(/(\r\n|\n|\r)$/, '').split(/\r\n|\n|\r/g);
      var matrix = rows.map(function (row) { return row.split(/\t/g); });
      var pasteRowCount    = matrix.length;
      var pasteColumnCount = matrix[0].length;
      var targetRange      = event.detail.targetRange;
      var rowPasteOffset   = targetRange.startIndex.row;
      var columnPasteOffset = targetRange.startIndex.column;
      var rowPasteEnd    = Math.min(rowPasteOffset + pasteRowCount - 1,    self._equipData.length - 1);
      var columnPasteEnd = Math.min(columnPasteOffset + pasteColumnCount - 1, self._equipColumnOrder.length - 1);
      self._equipSaveSnapshot();
      var isDirty = false;
      for (var i = rowPasteOffset; i <= rowPasteEnd; i++) {
        for (var j = columnPasteOffset; j <= columnPasteEnd; j++) {
          var origIdx    = self._equipColumnOrder[j];
          if (origIdx === EQUIP_COLUMN_KEYS.length) continue;
          var matrixRow    = (i - rowPasteOffset)    % pasteRowCount;
          var matrixColumn = (j - columnPasteOffset) % pasteColumnCount;
          var newValue = matrix[matrixRow][matrixColumn];
          if (String(self._equipData[i][j].data) !== String(newValue)) {
            self._equipData[i][j].data = newValue;
            var meta = self._equipRowMetaFiltered[i];
            if (meta && meta.time_entry_line_id !== null) { self._equipModifiedIds[meta.time_entry_line_id] = true; }
            var allIdx = self._equipDataToAllIdx[i];
            if (allIdx !== undefined) { self._equipAllData[allIdx] = self._equipData[i].map(function (c) { return { data: c.data }; }); }
            isDirty = true;
          }
        }
      }
      if (isDirty && self._equipGridProvider) {
        self._equipGridProvider.doUpdate({
          ranges: [{ rowOffset: rowPasteOffset, columnOffset: columnPasteOffset, rowCount: rowPasteEnd - rowPasteOffset + 1, columnCount: columnPasteEnd - columnPasteOffset + 1 }],
          version: 0
        });
        var equipgrid = document.getElementById('equipdatagrid');
        if (equipgrid) {
          equipgrid.selection = [{ startIndex: { row: rowPasteOffset, column: columnPasteOffset }, endIndex: { row: rowPasteEnd, column: columnPasteEnd } }];
        }
      }
      return isDirty;
    });
  };

  PageModule.prototype.handleEquipFill = function (event) {
    var self = this;
    var sourceRange = event.detail.sourceRange;
    var targetRange = event.detail.targetRange;
    var fillMatrix       = this._equipGetDataFromRange(sourceRange);
    var fillRowOffset    = targetRange.startIndex.row;
    var fillRowEnd       = targetRange.endIndex.row    === -1 ? self._equipData.length - 1        : targetRange.endIndex.row;
    var fillColumnOffset = targetRange.startIndex.column;
    var fillColumnEnd    = targetRange.endIndex.column === -1 ? self._equipColumnOrder.length - 1 : targetRange.endIndex.column;
    fillRowEnd    = Math.min(fillRowEnd,    self._equipData.length - 1);
    fillColumnEnd = Math.min(fillColumnEnd, self._equipColumnOrder.length - 1);
    var fillRowCount    = fillMatrix.length;
    var fillColumnCount = fillMatrix[0].length;
    var isDirty = false;
    this._equipSaveSnapshot();
    for (var i = fillRowOffset; i <= fillRowEnd; i++) {
      for (var j = fillColumnOffset; j <= fillColumnEnd; j++) {
        var origIdx = self._equipColumnOrder[j];
        if (origIdx === EQUIP_COLUMN_KEYS.length) continue;
        var matrixRow    = Math.abs(i - targetRange.startIndex.row)    % fillRowCount;
        var matrixColumn = Math.abs(j - targetRange.startIndex.column) % fillColumnCount;
        if (fillRowOffset    < sourceRange.startIndex.row)    { matrixRow    = fillRowCount    - matrixRow    - 1; }
        if (fillColumnOffset < sourceRange.startIndex.column) { matrixColumn = fillColumnCount - matrixColumn - 1; }
        var newValue = fillMatrix[matrixRow][matrixColumn];
        if (String(self._equipData[i][j].data) !== String(newValue)) {
          self._equipData[i][j].data = newValue;
          var meta = self._equipRowMetaFiltered[i];
          if (meta && meta.time_entry_line_id !== null) { self._equipModifiedIds[meta.time_entry_line_id] = true; }
          var allIdx = self._equipDataToAllIdx[i];
          if (allIdx !== undefined) { self._equipAllData[allIdx] = self._equipData[i].map(function (c) { return { data: c.data }; }); }
          isDirty = true;
        }
      }
    }
    if (isDirty && self._equipGridProvider) {
      self._equipGridProvider.doUpdate({
        ranges: [{ rowOffset: fillRowOffset, columnOffset: fillColumnOffset, rowCount: fillRowEnd - fillRowOffset + 1, columnCount: fillColumnEnd - fillColumnOffset + 1 }],
        version: 0
      });
    }
    return isDirty;
  };

  // ─── Filter ────────────────────────────────────────────────────────────────────

  PageModule.prototype.handleEquipFilterRequest = function (event) {
    var attributeName = event.detail.item.data;
    this._equipCurrentFilterColumnIndex = event.detail.item.index;
    var popup = document.getElementById('equipFilterPopup');
    if (popup) {
      popup.open(event.detail.launcher, {
        of: event.detail.anchor,
        at: { horizontal: 'right', vertical: 'top' }
      });
    }
    return attributeName;
  };

  PageModule.prototype.closeEquipFilterPopup = function () {
    var equipgrid = document.getElementById('equipdatagrid');
    if (equipgrid) equipgrid.focus();
  };

  PageModule.prototype.applyEquipFilter = function (filterText) {
    var self = this;
    this._equipCurrentFilterText = (filterText || '').toString().toLowerCase();
    var popup = document.getElementById('equipFilterPopup');
    if (popup) popup.close();
    this._equipData = [];
    this._equipRowHeaders = [[]];
    this._equipRowMetaFiltered = [];
    this._equipDataToAllIdx = [];
    self._equipAllData.forEach(function (row, allIdx) {
      var matches = true;
      if (self._equipCurrentFilterText !== '' && self._equipCurrentFilterColumnIndex !== -1) {
        var cell = row[self._equipCurrentFilterColumnIndex];
        if (cell && cell.data !== undefined) {
          var filterOrigIdx = (self._equipCurrentFilterColumnIndex >= 0)
            ? self._equipColumnOrder[self._equipCurrentFilterColumnIndex]
            : -1;
          var cellValue;
          if (filterOrigIdx === EQUIP_ORIG_IDX) {
            cellValue = (self._equipmentMap[cell.data] || '').toLowerCase();
          } else if (filterOrigIdx === EQUIP_COMBO_ORIG_IDX) {
            var combo = self._combinationsMap[cell.data];
            cellValue = (combo ? (combo.combination_name || '') : '').toLowerCase();
          } else {
            cellValue = (cell.data || '').toString().toLowerCase();
          }
          if (cellValue.indexOf(self._equipCurrentFilterText) === -1) { matches = false; }
        }
      }
      if (matches) {
        var rowCopy = row.map(function (c) { return { data: c.data }; });
        self._equipData.push(rowCopy);
        self._equipRowMetaFiltered.push(self._equipRowMetaAll[allIdx]);
        self._equipDataToAllIdx.push(allIdx);
        self._equipRowHeaders[0].push(self._equipData.length);
      }
    });
    if (this._equipGridProvider) {
      this._equipGridProvider.dataParameters = {
        data: this._equipData, rowHeader: this._equipRowHeaders, columnHeader: this._equipColumnHeaders
      };
      this._equipGridProvider._setTotalCounts();
      this._equipGridProvider.doRefresh();
    }
  };

  // ─── Hide/Show ──────────────────────────────────────────────────────────────────

  PageModule.prototype.getEquipColumnHideOptions = function () {
    var options = EQUIP_COLUMN_HEADERS.map(function (label, index) {
      return { value: index, label: label };
    });
    return new ArrayDataProvider(options, { keyAttributes: 'value' });
  };

  PageModule.prototype.buildEquipRowHideOptions = function () {
    var self = this;
    var nameOrigIdx = EQUIP_COLUMN_KEYS.indexOf('equipment_name');
    var nameDispPos = self._equipColumnOrder.indexOf(nameOrigIdx);
    var options = self._equipData.map(function (row, index) {
      var name = (nameDispPos >= 0 && row[nameDispPos]) ? self.getEquipmentName(row[nameDispPos].data) : '';
      return { value: index, label: 'Row ' + (index + 1) + (name ? ' (' + name + ')' : '') };
    });
    return new ArrayDataProvider(options, { keyAttributes: 'value' });
  };

  // ─── Drag & Drop ──────────────────────────────────────────────────────────────

  PageModule.prototype.handleEquipDragStart = function (event, dragContext) {
    this._equipDraggedIndex = (dragContext && dragContext.range) ? dragContext.range : [];
  };

  PageModule.prototype.handleEquipDropColumns = function (event, dropHeaderContext) {
    var self = this;
    if (!self._equipGridProvider || !self._equipDraggedIndex || self._equipDraggedIndex.length === 0) return false;
    if (self._equipCurrentFilterText !== '') return false;
    if (self._equipDraggedIndex[0].startIndex.column === undefined) return false;

    var dropColIndex = dropHeaderContext.index;
    var position     = dropHeaderContext.position;
    var draggedColData    = [];
    var removeEventRanges = [];
    var beforeDropIndexCount = 0;
    this._equipSaveSnapshot();

    for (var i = 0; i < self._equipDraggedIndex.length; i++) {
      var startIndex = self._equipDraggedIndex[i].startIndex.column;
      var endIndex   = self._equipDraggedIndex[i].endIndex.column;
      var colsInSel  = 0;
      for (var k = startIndex; k <= endIndex; k++) {
        colsInSel++;
        var colFromData = self._equipData.map(function (row) { return row[k]; });
        var colFromAll  = self._equipAllData.map(function (row) { return row[k]; });
        draggedColData.push({
          header:     self._equipColumnHeaders[0][k],
          orderEntry: self._equipColumnOrder[k],
          colData:    colFromData,
          allColData: colFromAll
        });
        if (k < dropColIndex) beforeDropIndexCount++;
      }
      removeEventRanges.push({ offset: startIndex, count: colsInSel });
    }

    self._equipGridProvider.dispatchEvent(
      new ojdatagridprovider.DataGridProviderRemoveEvent({ axis: 'column', ranges: removeEventRanges, version: 0 })
    );

    for (var j = 0; j < draggedColData.length; j++) {
      var matchIndex = self._equipColumnHeaders[0].indexOf(draggedColData[j].header);
      self._equipColumnHeaders[0].splice(matchIndex, 1);
      self._equipColumnOrder.splice(matchIndex, 1);
      for (var r = 0; r < self._equipData.length;    r++) { self._equipData[r].splice(matchIndex, 1); }
      for (var a = 0; a < self._equipAllData.length; a++) { self._equipAllData[a].splice(matchIndex, 1); }
    }

    var adjustedDropIndex = dropColIndex - beforeDropIndexCount;
    if (position === 'after') adjustedDropIndex++;
    adjustedDropIndex = Math.max(0, Math.min(adjustedDropIndex, self._equipColumnHeaders[0].length));

    for (var m = draggedColData.length - 1; m >= 0; m--) {
      self._equipColumnHeaders[0].splice(adjustedDropIndex, 0, draggedColData[m].header);
      self._equipColumnOrder.splice(adjustedDropIndex, 0, draggedColData[m].orderEntry);
      for (var r2 = 0; r2 < self._equipData.length;    r2++) { self._equipData[r2].splice(adjustedDropIndex, 0, draggedColData[m].colData[r2]); }
      for (var a2 = 0; a2 < self._equipAllData.length; a2++) { self._equipAllData[a2].splice(adjustedDropIndex, 0, draggedColData[m].allColData[a2]); }
    }

    self._equipGridProvider.dispatchEvent(
      new ojdatagridprovider.DataGridProviderAddEvent({
        axis: 'column', ranges: [{ offset: adjustedDropIndex, count: draggedColData.length }], version: 0
      })
    );
    return false;
  };

  PageModule.prototype.handleEquipDropRows = function (event, dropHeaderContext) {
    var self = this;
    if (!self._equipGridProvider || !self._equipDraggedIndex || self._equipDraggedIndex.length === 0) return false;
    if (self._equipCurrentFilterText !== '') return false;

    var dropRowIndex = dropHeaderContext.index;
    var draggedRowData    = [];
    var removeEventRanges = [];
    var beforeDropIndexCount = 0;
    this._equipSaveSnapshot();

    for (var i = 0; i < self._equipDraggedIndex.length; i++) {
      var startIndex = self._equipDraggedIndex[i].startIndex.row;
      var endIndex   = self._equipDraggedIndex[i].endIndex.row;
      var rowsInSel  = 0;
      for (var k = startIndex; k <= endIndex; k++) {
        rowsInSel++;
        draggedRowData.push({
          rowHeader: self._equipRowHeaders[0][k],
          rowData:   self._equipData[k],
          allData:   self._equipAllData[k],
          rowMeta:   self._equipRowMetaAll[k]
        });
        if (k < dropRowIndex) beforeDropIndexCount++;
      }
      removeEventRanges.push({ offset: startIndex, count: rowsInSel });
    }

    self._equipGridProvider.doRemove({ axis: 'row', ranges: removeEventRanges, version: 0 });

    for (var j = 0; j < draggedRowData.length; j++) {
      var matchIndex = self._equipRowHeaders[0].indexOf(draggedRowData[j].rowHeader);
      self._equipRowHeaders[0].splice(matchIndex, 1);
      self._equipData.splice(matchIndex, 1);
      self._equipAllData.splice(matchIndex, 1);
      self._equipRowMetaAll.splice(matchIndex, 1);
      self._equipRowMetaFiltered.splice(matchIndex, 1);
    }

    var adjustedDropIndex = dropRowIndex - beforeDropIndexCount;
    if (dropHeaderContext.position === 'after') adjustedDropIndex++;
    adjustedDropIndex = Math.max(0, Math.min(adjustedDropIndex, self._equipData.length));

    for (var m = draggedRowData.length - 1; m >= 0; m--) {
      self._equipRowHeaders[0].splice(adjustedDropIndex, 0, draggedRowData[m].rowHeader);
      self._equipData.splice(adjustedDropIndex, 0, draggedRowData[m].rowData);
      self._equipAllData.splice(adjustedDropIndex, 0, draggedRowData[m].allData);
      self._equipRowMetaAll.splice(adjustedDropIndex, 0, draggedRowData[m].rowMeta);
      self._equipRowMetaFiltered.splice(adjustedDropIndex, 0, draggedRowData[m].rowMeta);
    }

    self._equipDataToAllIdx = self._equipData.map(function (_, idx) { return idx; });
    self._equipGridProvider.doAdd({
      axis: 'row', ranges: [{ offset: adjustedDropIndex, count: draggedRowData.length }], version: 0
    });
    return false;
  };


  /**
   * Sets up an IntersectionObserver on #scrollable-content to auto-highlight
   * the oj-tab-bar tab matching the section currently in view.
   * The observer directly updates the oj-tab-bar's selection property via DOM.
   */
  PageModule.prototype.initScrollObserver = function () {
    var self = this;
    self._programmaticTabChange = false;

    window.setTimeout(function () {
      var container = document.getElementById('scrollable-content');
      if (!container) return;

      var sections = [
        { id: 'section-timesheet', tab: 'timesheet' },
        { id: 'section-equipment', tab: 'equipment' },
        { id: 'section-allowances', tab: 'allowances' }
      ];

      var visibleSections = {};

      var observer = new IntersectionObserver(function (entries) {
        if (self._programmaticTabChange) return;

        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            visibleSections[entry.target.id] = true;
          } else {
            delete visibleSections[entry.target.id];
          }
        });

        // Find the first visible section in order
        for (var i = 0; i < sections.length; i++) {
          if (visibleSections[sections[i].id]) {
            // Update the tab bar selection directly via DOM
            var tabBar = document.querySelector('oj-tab-bar');
            if (tabBar && tabBar.selection !== sections[i].tab) {
              self._programmaticTabChange = true;
              tabBar.selection = sections[i].tab;
              // Reset flag after JET processes the change
              window.setTimeout(function () {
                self._programmaticTabChange = false;
              }, 300);
            }
            break;
          }
        }
      }, {
        root: container,
        rootMargin: '-10% 0px -40% 0px',
        threshold: 0
      });

      sections.forEach(function (s) {
        var el = document.getElementById(s.id);
        if (el) observer.observe(el);
      });
    }, 500);
  };

  /**
   * Scrolls #scrollable-content to bring the section for the given tab into view.
   * Only scrolls if the change was from user click (not from IntersectionObserver).
   */
  PageModule.prototype.scrollToSection = function (tabValue) {
    var self = this;
    if (!tabValue || self._programmaticTabChange) return;

    self._programmaticTabChange = true;
    var sectionId = 'section-' + tabValue;
    window.setTimeout(function () {
      var el = document.getElementById(sectionId);
      var container = document.getElementById('scrollable-content');
      if (el && container) {
        var elRect = el.getBoundingClientRect();
        var containerRect = container.getBoundingClientRect();
        var targetScrollTop = elRect.top - containerRect.top + container.scrollTop - 16;
        container.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
      }
      // Reset after scroll animation
      window.setTimeout(function () {
        self._programmaticTabChange = false;
      }, 600);
    }, 50);
  };

  /**
   * Returns mock detail data for a specific timesheet.
   * @param {string} timesheetId
   * @returns {Object}
   */
  PageModule.prototype.getTimesheetDetail = function (timesheetId) {
    var data = {
      "TSH-2026-000": {
        timesheet_id: "TSH-2026-000",
        request_id: "REQ-999",
        type: "REQUEST",
        project: "Initial Infrastructure",
        week_label: "Mar 9 – Mar 15, 2026",
        week_start: "2026-03-09",
        equipment_count: 1,
        total_hours: 40,
        bill_amount: 60000,
        status: "APPROVED",
        crew_id: "DEMO-CREW-001",
        labor_rows: [],
        equipment_rows: [
          { request_number: '999', class_name: 'CRANE', equipment_name: 'Tower Crane T1', hours_type: 'Usage', status: 'Approved', project_name: 'Initial Infrastructure', task_name: 'Foundations', start_date: '2026-03-09', end_date: '2026-03-15', non_labor_resource: 'Crane Team', hours_day1: 8, hours_day2: 8, hours_day3: 8, hours_day4: 8, hours_day5: 8, hours_day6: 0, hours_day7: 0 }
        ],
        combo_rows: []
      },
      "TSH-2026-003": {
        timesheet_id: "TSH-2026-003",
        request_id: null,
        type: "DRAFT",
        project: null,
        week_label: "Apr 7 – Apr 13, 2026",
        week_start: "2026-04-07",
        equipment_count: 0,
        total_hours: null,
        bill_amount: null,
        status: "DRAFT",
        crew_id: null,
        labor_rows: [],
        equipment_rows: [
          { request_number: '2100', class_name: 'BULLDOZER', equipment_name: 'Bulldozer D6', hours_type: 'Usage', status: 'Draft', project_name: 'Highway Expansion', task_name: 'Grading', start_date: '2026-04-07', end_date: '2026-04-13', non_labor_resource: 'Grading Ops', hours_day1: 4, hours_day2: 4, hours_day3: 4, hours_day4: 4, hours_day5: 4, hours_day6: 0, hours_day7: 0 }
        ],
        combo_rows: []
      },
      "TSH-2026-002": {
        timesheet_id: "TSH-2026-002",
        request_id: "REQ-1001",
        type: "REQUEST",
        project: "Highway Expansion",
        week_label: "Mar 30 – Apr 5, 2026",
        week_start: "2026-03-30",
        equipment_count: 1,
        total_hours: 8,
        bill_amount: 72000,
        status: "SUBMITTED",
        crew_id: "DEMO-CREW-001",
        labor_rows: [
          { 
            time_entry_line_id: "L-001",
            person_id: "JM-1004", 
            person_code: "JM-1004",
            person_name: "Jake Morrison – Operator", 
            combination_id: "COMBO-D", 
            time_type_code: "Straight", 
            project_number: "05-300", 
            task_number: "T-003", 
            shift_code: "Day", 
            hours: 8, 
            comments: "Regular shift", 
            project_id: "P-300", 
            task_id: "TK-03", 
            state_code: "MA", 
            county_name: "Middlesex", 
            city_name: "Cambridge", 
            work_date: "2026-03-30",
            crew_id: "DEMO-CREW-001"
          }
        ],
        equipment_rows: (function() {
          var rows = [];
          for (var i = 1; i <= 50; i++) {
            rows.push({
              request_number: '22' + (70 + i),
              class_name: 'GENERATOR',
              equipment_name: 'GenSet ' + (100 + i),
              hours_type: 'Usage',
              status: 'Draft',
              project_name: 'Highway Expansion',
              task_name: 'Utility Work',
              start_date: '2026-03-30',
              end_date: '2026-04-05',
              non_labor_resource: 'Fleet Mgr',
              hours_day1: 8,
              hours_day2: 8,
              hours_day3: 8,
              hours_day4: 8,
              hours_day5: 8,
              hours_day6: 0,
              hours_day7: 0
            });
          }
          return rows;
        })(),
        combo_rows: [
          { cost_code: '05-300', description: 'Misc Steel, Embed Plates', qty_installed: 10, uom: 'EA', qty_budgeted: 120, pct_complete: 8, notes: 'Phase 1', combination_id: 'IQ-001' }
        ]
      },
      "TSH-2026-001": {
        timesheet_id: "TSH-2026-001",
        request_id: "REQ-1001",
        type: "REQUEST",
        project: "Highway Expansion",
        week_label: "Mar 23 – Mar 29, 2026",
        week_start: "2026-03-23",
        equipment_count: 2,
        total_hours: 18,
        bill_amount: 120000,
        status: "APPROVED",
        crew_id: "DEMO-CREW-001",
        labor_rows: [
          { 
            time_entry_line_id: "L-002",
            person_id: "MS-1001", 
            person_code: "MS-1001",
            person_name: "Mike Sullivan – Ironworker", 
            combination_id: "COMBO-A", 
            time_type_code: "Straight", 
            project_number: "05-100", 
            task_number: "T-001", 
            shift_code: "Day", 
            hours: 10, 
            comments: "Initial setup", 
            project_id: "P-100", 
            task_id: "TK-01", 
            state_code: "MA", 
            county_name: "Suffolk", 
            city_name: "Boston", 
            work_date: "2026-03-23",
            crew_id: "DEMO-CREW-001"
          },
          { 
            time_entry_line_id: "L-003",
            person_id: "TB-1003", 
            person_code: "TB-1003",
            person_name: "Tom Bouchard – Laborer", 
            combination_id: "COMBO-C", 
            time_type_code: "Straight", 
            project_number: "05-100", 
            task_number: "T-001", 
            shift_code: "Day", 
            hours: 8, 
            comments: "Site cleanup", 
            project_id: "P-100", 
            task_id: "TK-01", 
            state_code: "MA", 
            county_name: "Suffolk", 
            city_name: "Boston", 
            work_date: "2026-03-23",
            crew_id: "DEMO-CREW-001"
          }
        ],
        equipment_rows: [
          { request_number: '2201', class_name: 'EXCAVATOR', equipment_name: 'CAT 320 Excavator', hours_type: 'Usage', status: 'Approved', project_name: 'Highway Expansion', task_name: 'Site Prep', start_date: '2026-03-23', end_date: '2026-03-29', non_labor_resource: 'Ground Work', hours_day1: 10, hours_day2: 8, hours_day3: 0, hours_day4: 0, hours_day5: 0, hours_day6: 0, hours_day7: 0 }
        ],
        combo_rows: [
          { cost_code: '05-100', description: 'Structural Steel', qty_installed: 5, uom: 'EA', qty_budgeted: 48, pct_complete: 10, notes: 'Setup', combination_id: 'IQ-002' }
        ]
      }
    };
    return data[timesheetId] || data["TSH-2026-003"];
  };

  /**
   * Refreshes the main grid when the week is changed via LOV.
   * @param {string} weekStart 
   * @returns {Object} DataGridProvider
   */
  PageModule.prototype.refreshGridByWeek = function (weekStart) {
    if (!weekStart) return this._dataGridProvider;
    
    // Mapping week starts to mock timesheet IDs for the demo
    var weekMap = {
      "2026-03-09": "TSH-2026-000",
      "2026-03-23": "TSH-2026-001",
      "2026-03-30": "TSH-2026-002",
      "2026-04-07": "TSH-2026-003"
    };
    
    var timesheetId = weekMap[weekStart];
    if (timesheetId) {
      var detail = this.getTimesheetDetail(timesheetId);
      return this.initProviderFromLines(detail.equipment_rows, weekStart);
    } else {
      this._pendingWeekStart = weekStart;
      this._currentWorkDate = weekStart;
      return this.initProviderFromData();
    }
  };

  // The subtitle used to show $application.functions.getFormattedDate(), which
  // takes no arguments and returns TODAY'S ISO week -- so it was neither the
  // request span nor even the week being edited. That made the grid's read-only
  // cells look like a bug: REQ-1786556804612 runs 03-Aug to 28-Aug (Fri), the
  // header claimed "Aug 24 - Aug 30", and Sat 29 / Sun 30 are correctly
  // uneditable because the rental has ended by then.
  //
  // Derived from the loaded lines rather than a request-header field, because
  // that is what the grid itself clamps against: item.start_date / end_date are
  // the LINE dates, and a line may be shorter than its request.
  PageModule.prototype.formatRequestSpan = function (lines) {
    var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var minStart = null;
    var maxEnd   = null;
    (lines || []).forEach(function (item) {
      var s = item && item.start_date ? String(item.start_date).slice(0, 10) : null;
      var e = item && item.end_date   ? String(item.end_date).slice(0, 10)   : null;
      if (s && (minStart === null || s < minStart)) minStart = s;
      if (e && (maxEnd   === null || e > maxEnd))   maxEnd   = e;
    });
    if (!minStart && !maxEnd) return '';
    // Parse as plain Y-M-D parts, never new Date(str) -- an ISO date string is
    // read as UTC midnight and then rendered in local time, which shifts the
    // label back a day for anyone west of UTC.
    var label = function (ymd) {
      if (!ymd) return '?';
      var p = ymd.split('-');
      return MONTHS[parseInt(p[1], 10) - 1] + ' ' + parseInt(p[2], 10) + ', ' + p[0];
    };
    return label(minStart) + ' – ' + label(maxEnd);
  };

  // Rows the user is actually allowed to tick. toggleRowSelected refuses
  // anything that is not DRAFT or REJECTED, so select-all MUST apply the same
  // rule -- otherwise the header would tick SUBMITTED/APPROVED rows that the
  // per-row checkbox rejects, and Submit would act on rows that cannot legally
  // be submitted. Status is column 4 in COLUMN_KEYS order, mapped through
  // _columnOrder because the user can reorder columns.
  PageModule.prototype._selectableRowIndices = function () {
    var self = this;
    var statusDisplayIdx = self._columnOrder ? self._columnOrder.indexOf(4) : -1;
    var out = [];
    (self._data || []).forEach(function (row, idx) {
      if (statusDisplayIdx === -1) { out.push(idx); return; }
      var cell = row && row[statusDisplayIdx];
      var st   = cell && cell.data;
      if (!st || st === 'DRAFT' || st === 'REJECTED') { out.push(idx); }
    });
    return out;
  };

  // ---- header select-all -------------------------------------------------
  // JET's data grid does NOT re-evaluate a cell template's :checked binding
  // when a plain Set mutates -- it only re-renders on a provider event. Without
  // this, the header ticks but every row checkbox keeps its stale visual state.
  PageModule.prototype._refreshGridCells = function () {
    var p = this._dataGridProvider;
    if (p && typeof p.doRefresh === 'function') {
      try { p.doRefresh(); } catch (e) { /* provider not attached yet */ }
    }
  };

  PageModule.prototype.isAllSelected = function () {
    var self = this;
    var sel  = self._selectableRowIndices();
    if (!sel.length) return false;
    return sel.every(function (i) { return self._selectedRows.has(i); });
  };

  // none    -> click -> all selectable rows selected
  // partial -> click -> all selectable rows selected (extend, never clear:
  //                     a user mid-selection means "give me the rest")
  // all     -> click -> cleared
  // Driven from the post-event state, never from event.target.checked -- the
  // browser flips the native input before this runs.
  PageModule.prototype.toggleAllSelected = function (pageVars, event) {
    var self  = this;
    var sel   = self._selectableRowIndices();
    var allOn = sel.length > 0 && sel.every(function (i) { return self._selectedRows.has(i); });
    self._selectedRows = new Set();
    if (!allOn) { sel.forEach(function (i) { self._selectedRows.add(i); }); }
    if (pageVars) { pageVars.selectedRowCount = self._selectedRows.size; }
    self._refreshGridCells();
  };

  return PageModule;
});

