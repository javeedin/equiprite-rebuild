define([
  'ojs/ojdatagridprovider',
  'ojs/ojeventtarget',
  'ojs/ojarraydataprovider',
  'resources/js/lineStatusLabels',
  'resources/js/requestSource',
  'mapboxgl'
], function (ojdatagridprovider, ojeventtarget, ArrayDataProvider, lineStatusLabels, requestSource, mapboxgl) {
  'use strict';

  // ── Delivery-location map (Transfer to Another Site drawer) ──────────────
  // Copied verbatim from project-create-request-page.js's MapboxSuggestProvider
  // — same access token, same DataProvider shape (fetchFirst/fetchByKeys over a
  // Mapbox geocode query), so the Transfer drawer's map behaves identically to
  // the real create-request page's. See that file for the full rationale.
  var MAPBOX_ACCESS_TOKEN = 'pk.eyJ1IjoicmFodWxqYW1hbGFwdXJhbSIsImEiOiJjbXNkYngyeDcwNGN4MzVwdmRkMHRmN2ppIn0.P7EFTLmcAsXXammLSgF3Qw';
  var MAPBOX_DEFAULT_CENTER = [-95.3698, 29.7604];

  function MapboxSuggestProvider(parseFeature) {
    this._parse = parseFeature;
    this._cache = new Map();
    this._listeners = {};
  }
  MapboxSuggestProvider.prototype = {
    _textOf: function (params) {
      var fc = params && params.filterCriterion;
      if (!fc) return '';
      if (fc.text != null) return String(fc.text);
      if (fc.value != null) return String(fc.value);
      return '';
    },
    _query: function (text) {
      var self = this;
      var q = (text || '').toString().trim();
      if (q.length < 3) return Promise.resolve([]);
      var url = 'https://api.mapbox.com/geocoding/v5/mapbox.places/' +
        encodeURIComponent(q) + '.json?limit=6&autocomplete=true&access_token=' +
        ((mapboxgl && mapboxgl.accessToken) || MAPBOX_ACCESS_TOKEN);
      return fetch(url)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (body) {
          var feats = (body && Array.isArray(body.features)) ? body.features : [];
          return feats.map(function (f, i) {
            var p = self._parse(f, '');
            p.key = f.id || ('s' + i);
            p.label = f.place_name || p.addr1;
            self._cache.set(p.key, p);
            return { data: p, metadata: { key: p.key } };
          });
        })
        .catch(function () { return []; });
    },
    fetchFirst: function (params) {
      var self = this;
      var done = false;
      var iterator = {
        next: function () {
          if (done) {
            return Promise.resolve({ done: true, value: { data: [], metadata: [], fetchParameters: params } });
          }
          done = true;
          return self._query(self._textOf(params)).then(function (results) {
            return {
              done: true,
              value: {
                data: results.map(function (r) { return r.data; }),
                metadata: results.map(function (r) { return r.metadata; }),
                fetchParameters: params
              }
            };
          });
        }
      };
      var iterable = {};
      iterable[Symbol.asyncIterator] = function () { return iterator; };
      return iterable;
    },
    fetchByKeys: function (params) {
      var self = this;
      var map = new Map();
      (params && params.keys ? Array.from(params.keys) : []).forEach(function (k) {
        var d = self._cache.get(k);
        if (d) map.set(k, { metadata: { key: k }, data: d });
      });
      return Promise.resolve({ fetchParameters: params, results: map });
    },
    containsKeys: function (params) {
      var self = this;
      var found = new Set();
      (params && params.keys ? Array.from(params.keys) : []).forEach(function (k) {
        if (self._cache.has(k)) found.add(k);
      });
      return Promise.resolve({ containsParameters: params, results: found });
    },
    fetchByOffset: function (params) {
      return Promise.resolve({ fetchParameters: params, results: [], done: true });
    },
    getCapability: function (name) {
      if (name === 'filter') return { operators: ['$co'], textFilter: {} };
      if (name === 'fetchFirst') return { iterationSpeed: 'immediate' };
      if (name === 'fetchByKeys') return { implementation: 'lookup' };
      return null;
    },
    getTotalSize: function () { return Promise.resolve(-1); },
    isEmpty: function () { return 'unknown'; },
    addEventListener: function (t, l) { (this._listeners[t] = this._listeners[t] || []).push(l); },
    removeEventListener: function (t, l) {
      var a = this._listeners[t]; if (!a) return;
      this._listeners[t] = a.filter(function (x) { return x !== l; });
    },
    dispatchEvent: function () { return true; }
  };

  // Line statuses after which a line is DEAD — no action of any kind is
  // permitted against it on this page (see isLineTerminal). REJECTED is the
  // driver: a rejected line must stay rejected, so it can neither be opened,
  // allocated, procured, confirmed, returned nor selected. CANCELLED shares the
  // semantics. Deliberately NOT including CLOSED/CONSUMED — those are completed
  // lifecycles that some read paths still legitimately touch; add them here only
  // if that changes.
  const TERMINAL_LINE_STATUSES = ['REJECTED', 'CANCELLED'];

  // Line lifecycle states from which Confirm Request (create the outbound
  // Transfer Order) is allowed.
  //
  // WIDENED from ALLOCATED-only: confirming no longer waits for allocation to
  // finish, so IN_PROCESS (approved, allocation not done) and QUOTE_ACCEPTED
  // (customer accepted the quote) can be confirmed too. The old gate also
  // required alloc_status === 'ALLOCATED' alongside it; that condition is gone
  // entirely, since requiring it would defeat the point of the two new states.
  //
  // Still EXCLUDED, and deliberately: UNDER_PROCUREMENT (on the PR/PO track — it
  // gets its equipment from a supplier, not a yard transfer), SUBMITTED (not yet
  // approved), the terminal states, and everything already in flight
  // (PICK_INITIATED / SHIP_TO_SITE / DEPLOYED / the return states) which either
  // has a TO or is past needing one.
  //
  // Codes must match EQR_REQUEST_LINE.LINE_STATUS exactly (verified against the
  // live table) — resources/js/lineStatusLabels.js is the label source of truth.
  const CONFIRMABLE_LINE_STATUSES = ['ALLOCATED', 'QUOTE_ACCEPTED', 'IN_PROCESS'];

  // Line lifecycle states from which a Purchase Requisition may be raised —
  // i.e. the line has been approved/quoted but nothing has been committed to it
  // from stock yet, so buying it in is still a valid way to supply it.
  //
  // Note IN_PROCESS and QUOTE_ACCEPTED appear in BOTH this list and
  // CONFIRMABLE_LINE_STATUSES: at that point either supply route is open — a
  // yard transfer (Confirm) or a vendor purchase (PR). Whichever happens first
  // moves the line on (ALLOCATED or UNDER_PROCUREMENT) and thereby closes the
  // other, which is exactly why this gate exists.
  //
  // EXCLUDED on purpose: ALLOCATED and anything already on a Transfer Order
  // (stock is committed — a PR would double-supply it), UNDER_PROCUREMENT (its
  // PR already exists; re-raising would duplicate the requisition), SUBMITTED
  // (not approved yet), and every terminal/in-flight state.
  //
  // Codes match EQR_REQUEST_LINE.LINE_STATUS exactly (verified against the live
  // table); resources/js/lineStatusLabels.js holds the display labels.
  const PR_ELIGIBLE_LINE_STATUSES = ['IN_PROCESS', 'QUOTE_GENERATED', 'QUOTE_ACCEPTED'];

  // Statuses from which "Transfer to Another Site" is offered. Narrower than
  // returnEnabled's DEPLOYED-or-RETURN_INITIATED: a transfer both triggers
  // Process Return AND creates a brand-new request at the destination
  // project, so RETURN_INITIATED is excluded — the requestor already started
  // a return themselves, and stacking a transfer on top risks a second,
  // conflicting inbound Transfer Order for the same unit.
  const TRANSFER_ELIGIBLE_LINE_STATUSES = ['DEPLOYED'];

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

  DemoArrayDataGridProvider.prototype._mergeInnerHeaderValid = function (offset) {
    return offset !== 0;
  };

  ojeventtarget.EventTargetMixin.applyMixin(DemoArrayDataGridProvider);


  // ═══════════════════════════════════════════════════════════════════
  var COLUMN_KEYS = [
    'select', 'actions', 'equipment_name', 'class', 'qty', 'line_start_date', 'line_end_date', 'line_status', 'availability', 'allocated_serial', 'bill_rate', 'to_number', 'inbound_to_number', 'pr_number', 'po_number', 'util_pct', 'edit'
  ];
  var COLUMN_HEADERS = [
    '', '', 'Equipment Name', 'Class', 'Qty', 'Start Date', 'End Date', 'Line Status', 'Availability', 'Allocated Serial', 'Rate', 'Outbound Transfer Order No.', 'Inbound Transfer Order No.', 'Purchase Req No.', 'Purchase Order No.', 'Util %', 'Actions'
  ];
  // Index 13 (pr_number) is 'prlink', not 'readonly': it renders the
  // requisition number as a link out to Fusion Self Service Procurement. The
  // generic readonly cell branch tests getColumnType() === 'readonly', so
  // naming this type is all it takes to stop that branch claiming the cell.
  // Indexes 11 (to_number) and 12 (inbound_to_number) are 'tolink' for the
  // same reason index 13 is 'prlink': they render the order number as a link
  // out to the Fusion Redwood transfer-order page instead of plain text.
  var COLUMN_TYPES = [
    'select', 'actions', 'readonly', 'readonly', 'readonly', 'readonly', 'readonly', 'status', 'readonly', 'readonly', 'readonly', 'tolink', 'tolink', 'prlink', 'readonly', 'readonly', 'edit'
  ];

  // Per-column pixel widths, aligned to COLUMN_KEYS by index. Sized so each
  // header label fits on a SINGLE line (no two-line wrap) with a little room
  // for the longest expected cell value. Fixed-purpose columns (select /
  // actions) are kept tight; data columns are sized to their header. Users
  // can still drag-resize at runtime (header.column.resizable.width=enable).
  var COLUMN_WIDTHS = [
    44,   // 0  select (checkbox)
    44,   // 1  actions (hamburger)
    240,  // 2  equipment_name
    130,  // 3  class
    70,   // 4  qty
    120,  // 5  line_start_date
    120,  // 6  line_end_date
    130,  // 7  line_status
    120,  // 8  availability
    150,  // 9  allocated_serial
    120,  // 10 bill_rate
    240,  // 11 to_number         → "Outbound Transfer Order No."
    232,  // 12 inbound_to_number → "Inbound Transfer Order No." (blank until backend adds the field)
    150,  // 13 pr_number         → "Purchase Req No."
    170,  // 14 po_number         → "Purchase Order No."
    90,   // 15 util_pct
    80    // 16 edit (pencil action)
  ];

  // Fallback width for any column not covered above. Derived from the header
  // label length so a new/renamed column auto-sizes to fit its text on one
  // line instead of falling back to a magic number.
  function widthForHeader(label) {
    var text = (label == null) ? '' : String(label);
    // ~8px per char at the header font + 24px padding; clamp to a sane range.
    return Math.min(280, Math.max(80, text.length * 8 + 24));
  }

  class PageModule {
    constructor(context) {
      // Needed to fire the 'locationResolved' custom event from
      // applySuggestion/_reverseGeocode below — a page module cannot write
      // $page.variables directly, so the geocode result travels out as an
      // event and TransferLocationResolvedChain writes it back in. Same
      // pattern project-create-request-page.js uses for its own map.
      this._eventHelper = (context && typeof context.getEventHelper === 'function')
        ? context.getEventHelper()
        : null;
      var self = this;
      this._addrDP = new MapboxSuggestProvider(function (f, fb) { return self._parseFeature(f, fb); });

      this._dataGridProvider = null;
      this._linesSignature   = '';
      this._selectedRows = new Set();
      // Optimistic client-side lock: line IDs for which a Transfer Order was
      // just requested this session. The server-side `to_number` arrives from
      // OIC asynchronously, so between clicking Confirm and the next Refresh a
      // line still looks confirmable — that gap let the same line get multiple
      // TOs. We record the line the instant createSupplyRequest succeeds and
      // treat it as "already on a TO" everywhere the to_number gate is used, so
      // the Confirm button disables immediately. Cleared naturally once the
      // real to_number lands (see reconcileToInitiated).
      this._toInitiatedLineIds = new Set();

      // LAYER 1a — RE-ENTRANCY GUARD (see markToInitiated above for the async
      // window this complements).
      //
      // THE BUG THIS FIXES, reproduced by a user and visible in the data: one
      // Confirm interaction fired confirmRequest FIVE times, 438-477ms apart,
      // producing five real Fusion Transfer Orders for one line 2.6 seconds
      // apart (request line 1000001816, all sourced from yard '001').
      //
      // _toInitiatedLineIds could not stop it: that Set is only written AFTER
      // createSupplyRequest returns, and all five fires entered the function
      // before any of them got that far. A guard that closes only after the
      // network round-trip does not close a window measured in milliseconds.
      //
      // This flag is set on ENTRY instead, so a second entry is refused while
      // the first is still running — whatever the cause (double-click, a
      // repeating key, a double-bound handler).
      //
      // Per-tab and per-page-instance, like every other client guard. It is NOT
      // the duplicate-TO fix on its own — the idempotency key (ActionChain
      // confirmIdempotencyKey) and the server-side reservation in
      // EQR_TRANSFER_ORDER_PKG are what hold across tabs and users. This just
      // stops one interaction becoming five requests.
      this._confirmInFlight = false;

      this._statusLOV = new ArrayDataProvider([{value: 'PENDING', label: 'PENDING'}, {value: 'ALLOCATED', label: 'ALLOCATED'}], {keyAttributes: 'value'});
    }

    // Mark one or more request lines as having a TO initiated this session.
    markToInitiated(lineIds) {
      (Array.isArray(lineIds) ? lineIds : [lineIds]).forEach(id => {
        if (id != null) this._toInitiatedLineIds.add(Number(id));
      });
    }

    hasToInitiated(lineId) {
      return this._toInitiatedLineIds.has(Number(lineId));
    }

    // Claim the confirm slot. Returns false when a confirm is already running,
    // in which case the caller must return WITHOUT notifying — a repeat fire is
    // not a user error and a toast for it would be noise.
    // ALWAYS pair a true result with endConfirm() in a finally block.
    beginConfirm() {
      if (this._confirmInFlight) return false;
      this._confirmInFlight = true;
      return true;
    }

    endConfirm() {
      this._confirmInFlight = false;
    }

    // Drop optimistic locks that the server has now caught up on (line already
    // carries a real to_number), so the Set doesn't grow unbounded and stale
    // entries can't shadow a line that legitimately returns to ALLOCATED.
    reconcileToInitiated($page) {
      if (!$page || !$page.variables || !Array.isArray($page.variables.linesArray)) return;
      $page.variables.linesArray.forEach(l => {
        if (l && l.to_number && String(l.to_number).trim() !== '') {
          this._toInitiatedLineIds.delete(Number(l.line_id));
        }
      });
    }

    formatCurrency(value) {
      if (value == null) return '$0';
      return '$' + Number(value).toLocaleString();
    }

    computeTotalCost(lines) {
      if (!Array.isArray(lines)) return 0;
      return lines.reduce((sum, line) => sum + (line.est_cost || 0), 0);
    }

    initGridData(linesData, selectionVersion) {
      // Signature memoization. Without this the binding
      //   data="[[ $page.functions.initGridData(...) ]]"
      // rebuilds a brand-new DemoArrayDataGridProvider on every observable
      // tick (status flips, scroll, etc.), and JET tears down + re-lays-out
      // the grid each time. By returning the cached provider when nothing
      // structurally changed, the grid keeps its layout + scroll position.
      //
      // Selection IS included in the signature on purpose — oj-data-grid
      // caches cell templates per-row, so the row checkbox `:checked` binding
      // does NOT re-evaluate when this._selectedRows mutates. Forcing a new
      // provider on every selection bump is what makes the row checkboxes
      // actually flip to match the Set. Rebuild cost for ≤ 100 lines is
      // negligible; we keep memoization for the no-op ticks.
      const lines = linesData || [];
      const selSig = Number(selectionVersion || 0) + ':' +
                     Array.from(this._selectedRows).sort((a, b) => a - b).join(',');
      const signature = selSig + '||' + lines.length + ':' + lines.map(l =>
        (l && l.line_id != null ? l.line_id : '') + '|' +
        (l && l.qty             != null ? l.qty             : '') + '|' +
        (l && l.line_status     != null ? l.line_status     : '') + '|' +
        (l && l.alloc_status    != null ? l.alloc_status    : '') + '|' +
        (l && l.availability    != null ? l.availability    : '') + '|' +
        (l && l.allocated_serial != null ? l.allocated_serial : '') + '|' +
        (l && l.to_number       != null ? l.to_number       : '') + '|' +
        (l && l.inbound_to_number != null ? l.inbound_to_number : '') + '|' +
        // PR / PO must be in the signature or Refresh can't show them. Both
        // arrive from enrichWithPr AFTER the grid first rendered, and a PO
        // landing is often the ONLY delta on that refresh — without these two
        // the cached provider is returned and the columns stay blank. It looked
        // like it worked only because a first PO also flips the line
        // UNDER_PROCUREMENT → DEPLOYED (line_status, above); a second PO on a
        // line, or a PR number arriving on a line already at UNDER_PROCUREMENT,
        // painted nothing until some unrelated field happened to change.
        (l && l.pr_number       != null ? l.pr_number       : '') + '|' +
        (l && l.po_number       != null ? l.po_number       : '')
      ).join('~');
      if (signature === this._linesSignature && this._dataGridProvider) {
        return this._dataGridProvider;
      }
      this._linesSignature = signature;
      // Lines structurally changed (count, status, etc.) — drop any
      // selected rowIndex that is now out of range. Without this a stale
      // index from the prior render keeps _selectedRows.size != linesArray
      // .length and the header checkbox tri-state goes wrong.
      if (this._selectedRows && this._selectedRows.size) {
        const maxIdx = lines.length - 1;
        Array.from(this._selectedRows).forEach(i => {
          if (i > maxIdx) this._selectedRows.delete(i);
        });
      }

      // Cache the source lines so per-row helpers that only take a rowIndex
      // (e.g. isRowEditable) can read line fields without a $page round-trip.
      this._sourceLines = lines;

      this._data = [];
      this._rowHeaders = [[]];
      this._columnHeaders = [COLUMN_HEADERS];

      lines.forEach((item, index) => {
        let row = COLUMN_KEYS.map(key => {
          if (key === 'select') return { data: false };
          if (key === 'actions') return { data: '' };
          return { data: item[key] !== undefined && item[key] !== null ? item[key] : '' };
        });
        this._rowHeaders[0].push(index + 1);
        this._data.push(row);
      });

      this._dataGridProvider = new DemoArrayDataGridProvider(
        { data: this._data, rowHeader: this._rowHeaders, columnHeader: this._columnHeaders },
        {}, {}, {}, {}, {}
      );
      return this._dataGridProvider;
    }

    getColumnType(columnIndex) {
      return COLUMN_TYPES[columnIndex] || 'readonly';
    }

    // Fusion deep links for the "Purchase Req No." cell at rowIndex:
    // [{ number, headerId, url }], one per requisition on the line (a line can
    // carry several). Built by requestDetailLines.enrichWithPr, which is the
    // only owner of the URL shape.
    //
    // Reads $page.variables.linesArray for the same reason isLineTerminal and
    // isLinePickable do: _data, the grid's 2-D cell array, holds only the
    // display string per cell, so the header id the link needs is not in the
    // cell context. Returns [] defensively — before enrichWithPr has run, or on
    // a line with no requisition, the cell falls back to plain text.
    getPrLinks(rowIndex, $page) {
      if (!$page || !$page.variables || !Array.isArray($page.variables.linesArray)) return [];
      const line = $page.variables.linesArray[rowIndex];
      if (!line || !Array.isArray(line.pr_links)) return [];
      return line.pr_links;
    }

    // Transfer Order links for one cell. columnIndex picks the column, so the
    // outbound (11) and inbound (12) cells share one accessor and one cell
    // template. requestDetailLines built the arrays; this just reads them.
    getToLinks(rowIndex, columnIndex, $page) {
      if (!$page || !$page.variables || !Array.isArray($page.variables.linesArray)) return [];
      const line = $page.variables.linesArray[rowIndex];
      if (!line) return [];
      const key = (Number(columnIndex) === 12) ? 'inbound_to_links' : 'to_links';
      return Array.isArray(line[key]) ? line[key] : [];
    }


    // Per-line Edit (pencil) gate — enabled unless the line has reached a
    // terminal / in-flight state where changing rate or dates would drift from
    // what's already shipped, returned, or billed.
    isRowEditable(rowIndex) {
      var lines = this._sourceLines || [];
      var line = lines[Number(rowIndex)];
      if (!line) return false;
      var ls = String(line.line_status || '').toUpperCase();
      var TERMINAL = ['DEPLOYED', 'RETURN_INITIATED', 'RETURN_IN_PROCESS',
        'SHIPPED_TO_YARD', 'CLOSED', 'REJECTED'];
      return TERMINAL.indexOf(ls) === -1;
    }

    getIsEditable(cellContext) {
      if (cellContext.keys.column === 'columnEnd') return false;
      let type = this.getColumnType(cellContext.indexes.column);
      return (type === 'text' || type === 'number' || type === 'dropdown' || type === 'select') ? true : false;
    }

    getColumnHeaderStyle(headerContext) {
      // white-space:nowrap guarantees headers stay on ONE line — they never
      // wrap to a double line regardless of the column width below.
      let baseStyle = 'font-weight: var(--oj-typography-body-font-weight-bold, 700); background-color: var(--oj-core-neutral-color-2, #f1f5f9); color: var(--oj-core-text-color-secondary, #475569); padding: 12px; white-space: nowrap;';
      let idx = headerContext.index;
      // Prefer the explicit per-column width; fall back to a width derived
      // from the header label so any uncovered column still fits on one line.
      let width = (COLUMN_WIDTHS[idx] != null)
        ? COLUMN_WIDTHS[idx]
        : widthForHeader(COLUMN_HEADERS[idx]);
      return baseStyle + 'width: ' + width + 'px;';
    }

    // Note on the `_v` arg here (and on isAllSelected/isLinePickable below):
    // VB only re-evaluates a `[[ ... ]]` binding when an observable it
    // touched during the last read changes. These three methods only look
    // at `this._selectedRows`, which is a plain Set (not observable), so
    // VB has no way to know to re-call them when the user clicks a row
    // checkbox. We thread `$variables.selectionVersion` through as `_v`
    // purely to register a dependency on that variable — the toggle
    // handlers increment it after every change, which forces VB to
    // re-call the binding, which re-reads `_selectedRows`. The arg is
    // unused inside the body on purpose.
    isRowSelected(rowIndex, _v) {
      return this._selectedRows.has(rowIndex);
    }

    // ── Terminal (dead) lines ─────────────────────────────────────────────
    // A REJECTED line is finished: it was turned down, nothing further happens
    // to it, and NO action of any kind may be taken against it — not opening
    // line-detail, not allocating, not raising a PR/PO, not confirming,
    // returning or closing. Selecting it is blocked too, because every toolbar
    // action on this page operates on the current selection, so an unselectable
    // line is unreachable by all of them at once rather than needing each
    // action to remember to filter it out.
    //
    // CANCELLED is included on the same reasoning — it is the other "this line
    // is over" status. Kept as a LIST so a future terminal status is one entry
    // rather than another scattered comparison.
    //
    // Reads line_status off $page.variables.linesArray (the enriched line rows);
    // _data, the grid's 2-D cell array, doesn't carry it.
    // ══ TRANSFER ORDER FAILURE BADGE ══════════════════════════════════
    // createSupplyRequest returns 202 ACCEPTED, not success — Fusion decides
    // about two minutes later. The line's status was already promoted on that
    // 202, so a line whose Transfer Order FAILED sits at ALLOCATED or
    // RETURN_IN_PROCESS looking completely healthy. 28 lines were stranded that
    // way before anyone noticed, and the only way to find them was a DB query.
    //
    // These render a badge under the status text. The data is put on the line by
    // resources/js/requestDetailLines (enrichWithFailedTOs) during the normal
    // line load — no extra fetch is made for the badge itself.

    // '' when the line is fine. Kept as a plain string so the template can test
    // truthiness without a second call.
    failureBadge(rowIndex, $page) {
      if (!$page || !$page.variables || !Array.isArray($page.variables.linesArray)) return '';
      const line = $page.variables.linesArray[rowIndex];
      if (!line || !line.to_failure_code) return '';
      // TO_STALLED is NOT a failure the user can act on: the OIC poller still
      // owns that row and re-reads it every 2 minutes, so a retry would race it.
      // Different word, deliberately — "Failed" invites a retry, "Stalled" does not.
      return line.to_failure_code === 'TO_STALLED'
        ? 'Transfer Order Stalled'
        : 'Transfer Order Failed';
    }

    // The reason, for the tooltip. Comes from the server (reasonDetail) and
    // already carries the remedy, e.g. "Reset the return, then retry it."
    failureDetail(rowIndex, $page) {
      if (!$page || !$page.variables || !Array.isArray($page.variables.linesArray)) return '';
      const line = $page.variables.linesArray[rowIndex];
      if (!line || !line.to_failure_code) return '';
      if (line.to_failure_detail) return line.to_failure_detail;
      return line.to_failure_code === 'TO_STALLED'
        ? 'This Transfer Order has not been answered by Fusion. It is still being retried automatically — no action needed here.'
        : 'The Transfer Order failed in Fusion. Fix the cause, then retry this line.';
    }

    // Amber for stalled (in progress, nobody at fault), red for failed (needs a
    // person). Matches how the rest of the app colours in-flight vs error.
    failureBadgeClass(rowIndex, $page) {
      if (!$page || !$page.variables || !Array.isArray($page.variables.linesArray)) return '';
      const line = $page.variables.linesArray[rowIndex];
      if (!line || !line.to_failure_code) return '';
      return line.to_failure_code === 'TO_STALLED'
        ? 'oj-badge oj-badge-warning'
        : 'oj-badge oj-badge-danger';
    }

    isLineTerminal(rowIndex, $page) {
      if (!$page || !$page.variables || !Array.isArray($page.variables.linesArray)) return false;
      const line = $page.variables.linesArray[rowIndex];
      if (!line) return false;
      const ls = String(line.line_status || '').toUpperCase();
      return TERMINAL_LINE_STATUSES.indexOf(ls) !== -1;
    }

    // True iff the line at rowIndex can be allocated — i.e. it needs a pick
    // step (serial OR lot OR inventory tracked) OR it is an F&M line, which is
    // assigned directly instead of picked.
    //
    // F&M (Fixed-asset / Maintenance tracked, isTransactable='N') has no Fusion
    // inventory item, so is_inventory_tracked is 'N' on every one of them —
    // testing the old three-flag triple alone greyed the hamburger on every F&M
    // line and made them unallocatable. They ARE allocatable: per serial unit
    // when serial controlled, by quantity otherwise.
    //
    // Genuine free-stock (no serial, no lot, no inventory AND not F&M) stays
    // greyed — that is the real "no allocation pathway" case.
    //
    // fulfilment_class is precomputed by requestDetailLines.classOfLine(), the
    // single owner of the S&T/F&M rule, so this and rowClickChain's matching
    // programmatic guard can never drift apart.
    //
    // Reads from $page.variables.linesArray via the template binding (which
    // passes $page in via .bind below) — _data (the grid's 2-D cell array)
    // drops these flags. Returns false defensively when the line/flags are
    // missing.
    isLinePickable(rowIndex, $page) {
      if (!$page || !$page.variables || !Array.isArray($page.variables.linesArray)) return false;
      const line = $page.variables.linesArray[rowIndex];
      if (!line) return false;
      return !!(line.is_serial_controlled || line.is_lot_controlled
                || line.is_inventory_tracked || line.fulfilment_class === 'F_AND_M');
    }

    // True when allocation is not yet permitted for this request. Gates the row
    // hamburger (open line-detail / allocate). Two independent reasons to block:
    //
    //   1. A QUOTE IS STILL OWED. When ENABLE_QUOTES covers this request's
    //      origin, the manager must generate a quote before allocating — the
    //      quote is what the customer accepts, and allocating first would commit
    //      equipment to a request that may never be accepted. Cleared as soon as
    //      a quote exists (QUOTE_GENERATED / QUOTE_ACCEPTED / DEPLOYED).
    //   2. STILL AWAITING APPROVAL. A header at SUBMITTED hasn't been approved.
    //      This is the project path (customer submits land on IN_PROCESS
    //      directly); it still applies when quoting is off for the origin.
    //
    // Case-insensitive; false when the status is missing. rowClickChain +
    // line-detail vbEnter carry the matching programmatic guards so the disabled
    // button can't be bypassed via double-fire or URL.
    isRequestSubmitted($page) {
      if (!$page || !$page.variables || !$page.variables.formData) return false;
      const status = String($page.variables.formData.status || '').toUpperCase();
      if (status === 'SUBMITTED') return true;
      return this.isQuoteOwed($page);
    }

    // True when quoting is enabled for this request's origin but no quote has
    // been produced yet. Shared by isRequestSubmitted / isRowLineDetailBlocked
    // and mirrored in rowClickChain — keep the three in lockstep.
    // quotingAllowed is resolved per-origin in vbEnterChain via
    // $application.functions.isQuotingAllowed (fails CLOSED while settings
    // load, which leaves allocation open — the SUBMITTED check above is the
    // backstop in that window).
    isQuoteOwed($page) {
      if (!$page || !$page.variables || !$page.variables.formData) return false;
      if (!$page.variables.quotingAllowed) return false;
      const status = String($page.variables.formData.status || '').toUpperCase();
      return ['QUOTE_GENERATED', 'QUOTE_ACCEPTED', 'DEPLOYED'].indexOf(status) === -1;
    }

    // Per-row gate for opening line-detail. Blocked whenever the header-level
    // gate says allocation isn't permitted yet — either awaiting approval
    // (SUBMITTED) or a quote is still owed (see isRequestSubmitted/isQuoteOwed)
    // — EXCEPT for a CUSTOMER-sourced request's line that has reached
    // UNDER_PROCUREMENT, which is intentionally viewable (read-only:
    // line-detail hides Assign/Release). UNDER_PROCUREMENT is a LINE status; the
    // header sits at SUBMITTED or IN_PROCESS at that point, so the exception is
    // decided per row from the line's own status.
    // rowClickChain + line-detail vbEnter carry the matching programmatic guards.
    isRowLineDetailBlocked(rowIndex, $page) {
      if (!$page || !$page.variables || !$page.variables.formData) return false;
      if (!this.isRequestSubmitted($page)) return false;
      // Allocation is gated — blocked unless this is the external/UNDER_PROCUREMENT exception.
      const isCustomer = requestSource.isExternal($page.variables.formData.source);
      const lines = $page.variables.linesArray;
      const line = (Array.isArray(lines) && rowIndex != null) ? lines[rowIndex] : null;
      const ls = line ? String(line.line_status || '').toUpperCase() : '';
      if (isCustomer && ls === 'UNDER_PROCUREMENT') return false;
      return true;
    }

    // PO button gate: ≥1 line selected AND every selected line sits at a
    // pre-supply lifecycle point (PR_ELIGIBLE_LINE_STATUSES).
    //
    // ALL-of, not any-of: a requisition is raised for the whole selection, so
    // enabling on one qualifying line would either drag a non-qualifying sibling
    // into the Fusion PR or light the button up only for the click to fail.
    // (Confirm is deliberately any-of because its chain then BLOCK-ALLs; this
    // path has no such second gate.)
    //
    // The status test is what stops a PR being raised for equipment that is
    // already committed — an ALLOCATED line, or one already on a Transfer Order,
    // would otherwise be double-supplied: procured from a vendor AND transferred
    // from a yard. It also blocks re-requisitioning a line already at
    // UNDER_PROCUREMENT, which is the status a line lands on once its PR exists.
    //
    // ── REVERSIBLE ────────────────────────────────────────────────────────
    // An earlier version gated on availability instead ("no inventory ->
    // third-party rental"): every selected line had to be
    // `availability === 'NOT AVAILABLE'`. That block was replaced by an
    // unconditional `sel.length > 0`, and is now replaced by this status gate.
    // To restore the availability rule, add back:
    //   sel.every(idx => String((lines[idx]||{}).availability||'').toUpperCase() === 'NOT AVAILABLE')
    // as an additional condition below.
    updatePoButtonEnabled($page) {
      if (!$page || !$page.variables || !Array.isArray($page.variables.linesArray)) return;

      const lines = $page.variables.linesArray;
      const sel = Array.from(this._selectedRows);
      if (sel.length === 0) {
        $page.variables.poButtonEnabled = false;
        return;
      }

      const allPrEligible = sel.every(idx => {
        const line = lines[idx];
        if (!line) return false;
        const ls = String(line.line_status || '').toUpperCase();
        return PR_ELIGIBLE_LINE_STATUSES.indexOf(ls) !== -1;
      });

      $page.variables.poButtonEnabled = allPrEligible;
    }

    // The selected row indexes, as a plain number[]. Used by ActionChain to
    // scope Confirm/Reject to exactly the lines the user ticked.
    getSelectedRowIndexes() {
      return Array.from(this._selectedRows);
    }

    // Gate the header actions (Confirm Request / Reject) on the current
    // selection. Two independent flags because the rules differ:
    //   confirmEnabled — ≥1 selected line whose line_status is one of
    //     CONFIRMABLE_LINE_STATUSES (ALLOCATED / QUOTE_ACCEPTED / IN_PROCESS)
    //     and which is NOT yet on a Transfer Order. Confirming sends just those
    //     lines to OIC; once they get a to_number they drop out of this set, so
    //     the button self-disables for the confirmed lines. NOTE: allocation is
    //     no longer a precondition — alloc_status is not consulted.
    //   rejectEnabled  — ≥1 selected line that is still rejectable: its
    //     line_status is not already a terminal/in-flight state and it is not
    //     on a TO. A line already shipped/deployed/closed/rejected can't be
    //     rejected from here.
    //   returnEnabled  — ≥1 selected line whose line_status is DEPLOYED or
    //     RETURN_INITIATED (the requestor has started, or could start, a
    //     return; the manager processes it here by creating the inbound TO),
    //     regardless of the request header status.
    // Empty selection → all false (the buttons require a selection).
    updateActionButtons($page) {
      if (!$page || !$page.variables || !Array.isArray($page.variables.linesArray)) {
        if ($page && $page.variables) {
          $page.variables.confirmEnabled     = false;
          $page.variables.rejectEnabled      = false;
          $page.variables.returnEnabled      = false;
          $page.variables.transferEnabled    = false;
          $page.variables.quoteEnabled       = false;
          $page.variables.quoteVisible       = false;
          $page.variables.quoteButtonLabel   = 'Generate Quote';
          $page.variables.invoiceVisible     = false;
          $page.variables.invoiceEnabled     = false;
          $page.variables.shipConfirmEnabled = false;
          $page.variables.assignProjectVisible = false;
          $page.variables.assignProjectEnabled = false;
        }
        return;
      }
      const lines = $page.variables.linesArray;
      const sel = Array.from(this._selectedRows);

      // Statuses past which a line can no longer be rejected from this page.
      const NON_REJECTABLE = ['PICK_INITIATED', 'SHIP_TO_SITE', 'DEPLOYED', 'UNDER_PROCUREMENT',
        'RETURN_INITIATED', 'RETURN_IN_PROCESS', 'SHIPPED_TO_YARD', 'CLOSED', 'REJECTED'];

      // A line counts as "on a TO" if the server has populated to_number OR we
      // optimistically locked it this session (createSupplyRequest succeeded
      // but OIC hasn't written to_number back yet). Both must gate Confirm, or
      // the button re-enables in the async window and lets a duplicate TO fire.
      this.reconcileToInitiated($page);
      const hasToNumber = (l) => !!(
        (l && l.to_number && String(l.to_number).trim() !== '') ||
        (l && this._toInitiatedLineIds.has(Number(l.line_id)))
      );

      const fd = $page.variables.formData || {};
      // Origin vocabulary is 'EXTERNAL' | 'INTERNAL' (was 'CUSTOMER' | 'PROJECT').
      // Resolved through the shared module so the rule lives in one place —
      // this page module can't reach $application.functions.isExternalSource.
      const isCustomer = requestSource.isExternal(fd.source);

      let confirmable    = false;
      let rejectable     = false;
      let returnable     = false;
      let transferable   = false;
      let invoiceable    = false;
      let shipConfirmable = false;

      // ── QUOTE-FIRST GATE ────────────────────────────────────────────────
      // With quoting ON, a line must be QUOTE_ACCEPTED before it can be
      // confirmed — IN_PROCESS is NOT enough. Confirming straight from
      // IN_PROCESS creates the Transfer Order and commits the equipment
      // WITHOUT the customer ever accepting a price, which is the whole point
      // of the quote step. CONFIRMABLE_LINE_STATUSES contains IN_PROCESS
      // because that is correct when quoting is OFF (nothing to wait for) —
      // this narrows it when quoting is on.
      //
      // Scoped by isQuoteOwed(): true only while quoting is enabled for THIS
      // request's origin AND no quote exists yet (header not
      // QUOTE_GENERATED / QUOTE_ACCEPTED / DEPLOYED). So:
      //   quoting off            → unchanged, IN_PROCESS confirmable
      //   quoting on, no quote   → IN_PROCESS blocked, must quote first
      //   quote already produced → unchanged, normal rules resume
      //
      // Deliberately reuses the same helper the allocation and line-detail
      // gates use, rather than re-deriving the test — the three already have
      // to stay in lockstep and a fourth copy is what makes them drift.
      const quoteOwed = this.isQuoteOwed($page);
      const CONFIRM_BLOCKED_WHILE_QUOTE_OWED = ['IN_PROCESS'];

      sel.forEach(idx => {
        const line = lines[idx];
        if (!line) return;
        const ls = String(line.line_status || '').toUpperCase();
        // Confirm gates on the LINE LIFECYCLE only, plus "not already on a
        // Transfer Order".
        //
        // alloc_status is deliberately NOT part of this test any more. It used to
        // require alloc_status === 'ALLOCATED' *and* line_status === 'ALLOCATED',
        // which meant a line could only be confirmed once it was fully allocated.
        // Confirm is now permitted from the earlier lifecycle points as well
        // (see CONFIRMABLE_LINE_STATUSES) so a request can be sent onward without
        // waiting for allocation to complete.
        //
        // The TO check stays exactly as it was — it is the duplicate-TO guard,
        // not a lifecycle rule.
        //
        // EXCEPT FOR F&M. A fixed-asset / maintenance line has no Transfer
        // Order, no yard fallback and no picking step, so its allocation is the
        // ONLY record of which asset is going out — confirming one that isn't
        // allocated would commit the request to equipment nobody chose.
        // PARTIAL doesn't count: there is no later step to finish it.
        //
        // MUST MIRROR isConfirmableLine in request-detail-page-chains/
        // ActionChain.js. If the two drift, the button enables and the click
        // then fails with "Cannot Confirm" — or worse, the reverse.
        //
        // Reads the precomputed fulfilment_class (set by
        // requestDetailLines.classOfLine, the single owner of the S&T/F&M rule)
        // rather than re-deriving it from isTransactable here.
        const isFAndM = line.fulfilment_class === 'F_AND_M';
        const fmAllocOk = !isFAndM ||
          String(line.alloc_status || '').toUpperCase() === 'ALLOCATED';
        // A quote-owed line at IN_PROCESS is not confirmable — see the
        // QUOTE-FIRST GATE above.
        const quoteBlocked = quoteOwed &&
          CONFIRM_BLOCKED_WHILE_QUOTE_OWED.indexOf(ls) !== -1;
        if (CONFIRMABLE_LINE_STATUSES.indexOf(ls) !== -1 && !hasToNumber(line)
            && fmAllocOk && !quoteBlocked) confirmable = true;
        if (NON_REJECTABLE.indexOf(ls) === -1 && !hasToNumber(line)) rejectable = true;
        // RETURN_IN_PROCESS is returnable ONLY as a retry of a FAILED return.
        //
        // Normally that status means "the inbound Transfer Order is on its way"
        // and the line must not be re-returned. But when that TO failed in
        // Fusion, the line was promoted on the 202 and then stranded there —
        // 13 lines are in exactly this state. Without this the Return button
        // never enables and the only way out is a DBA.
        //
        // Gated on to_needs_reset, which is SERVER-TOLD (needsReturnResetLineIds
        // on the failed-TO sweep), never inferred from the status: a line whose
        // return already succeeded is also RETURN_IN_PROCESS and must stay
        // un-returnable. processReturn calls /returns/reset before re-attempting.
        if (ls === 'DEPLOYED' || ls === 'RETURN_INITIATED') returnable = true;
        else if (ls === 'RETURN_IN_PROCESS' && line.to_needs_reset === true) returnable = true;
        // Transfer to Another Site — status only, same shape as returnable;
        // the SINGLE-line requirement is enforced below the loop, since it's
        // a property of the whole selection, not any one row.
        if (TRANSFER_ELIGIBLE_LINE_STATUSES.indexOf(ls) !== -1) transferable = true;
        // Create Invoice — SELECTION gate only: ≥1 selected line DEPLOYED.
        // The customer-origin half of the old test moved out to invoiceVisible
        // below, which HIDES the button on an internal request rather than
        // leaving it visible-but-disabled. Keeping isCustomer here as well
        // would be harmless but redundant — the button doesn't exist to be
        // enabled when it's false.
        if (ls === 'DEPLOYED') invoiceable = true;
        // Ship Confirm — mirror of Confirm Request's gate, inbound leg: a
        // selected line whose Process Return already created its inbound TO
        // (line_status flipped to RETURN_IN_PROCESS at that point) is ready
        // to be released. See request-detail-page-chains/ActionChain.js
        // shipConfirm branch for the authoritative TO lookup at click time —
        // this is a cheap client-side proxy, same relationship confirmEnabled
        // has to confirmRequest()'s own TO check.
        if (ls === 'RETURN_IN_PROCESS') shipConfirmable = true;
      });

      // ── Assign Project (feature-flagged, CUSTOMER-only) ─────────────────
      // A customer request is raised with no project — the manager attributes
      // it to one here so the cost has somewhere to land. Three rules:
      //
      //  • OFF BY DEFAULT. The whole feature hangs off the
      //    EXTERNAL_PROJECT_ASSIGN_ENABLED flag (Configuration Settings →
      //    Application Flags), resolved in vbEnterChain and cached on the page.
      //    With it off — or still loading — the button is hidden AND the
      //    confirm gate below is skipped, so the page behaves exactly as it did
      //    before this feature existed.
      //  • VISIBLE for customer-sourced requests only. A project request
      //    already carries its project from creation and must never be
      //    re-pointed from this page, so the button is hidden outright rather
      //    than shown disabled (same treatment as the quote button).
      //  • EDITABLE only until the first line is allocated. Allocation is the
      //    point downstream cost attribution (TO, post-cost, billing) starts
      //    depending on the project, so re-pointing it after that would strand
      //    already-committed work against the old project.
      //
      // Note the lock tests ALL lines, not just the selected ones: one
      // allocated line anywhere on the request freezes the project for the
      // whole request, since the project lives on the HEADER.
      const assignAllowed = !!$page.variables.externalProjectAssignEnabled;
      const anyAllocated  = lines.some(l => String((l || {}).alloc_status || '').toUpperCase() === 'ALLOCATED');
      // The button is never shown-but-disabled: every condition that makes it
      // unusable HIDES it instead (the oj-bind-if in the HTML drops it from the
      // DOM). A disabled control invites the manager to hunt for a way to
      // enable it, and for two of these three there is none — the flag is an
      // admin setting on another page, and allocation is irreversible here.
      const assignUsable = assignAllowed && isCustomer && !anyAllocated;
      $page.variables.assignProjectVisible = assignUsable;
      $page.variables.assignProjectEnabled = assignUsable;

      // Confirm additionally requires the project + task to be assigned on a
      // customer request — but ONLY while the feature is on. Without the flag
      // check this would block every customer request in an environment that
      // never opted into the feature and has no button to satisfy it with.
      if (assignAllowed && isCustomer && !this.hasAssignedProject($page)) confirmable = false;

      // ══ FAILED-TO RETRY ═════════════════════════════════════════
      // A line whose Transfer Order failed in Fusion is retryable through the
      // SAME button the user already uses — no second control. Only the LABEL
      // changes, so the action is honest about what it is doing: "Confirm
      // Request" creates a Transfer Order, "Retry Transfer Order" re-attempts a
      // known-failed one. Oracle's Manage Supply Request Exceptions page makes
      // the same distinction (Resubmit is its own verb) and for the same reason:
      // enabling Confirm on a failed line hides that anything went wrong.
      //
      // Enablement needs NO special case. The package's dedupe now ignores
      // TO_FAILED (V318), so a failed line is genuinely confirmable again and
      // flows through the normal gate above. This block only decides wording.
      //
      // TO_STALLED is deliberately excluded: those rows are still in the OIC
      // poller's SR_CREATED work queue, re-read every 2 minutes, so a retry
      // would race it. rdl marks only TO_FAILED as to_retryable.
      // `sel` holds row INDICES (see the forEach above); map to line objects.
      const selRows      = sel.map(i => lines[i]).filter(Boolean);
      const retryRows    = selRows.filter(l => l.to_retryable === true);
      // Relabel only when EVERY selected line is a retry. A mixed selection
      // keeps "Confirm Request": calling it Retry would misdescribe the lines
      // that have never been attempted.
      $page.variables.confirmIsRetry = retryRows.length > 0 &&
                                       retryRows.length === selRows.length;
      $page.variables.confirmLabel   = $page.variables.confirmIsRetry
        ? 'Retry Transfer Order'
        : 'Confirm Request';

      $page.variables.confirmEnabled     = confirmable;
      $page.variables.rejectEnabled      = rejectable;
      $page.variables.returnEnabled      = returnable;
      // Single-line rule: OpenTransferDrawerChain stages exactly one line's
      // equipment/qty/rate onto the new request, so a multi-select of two
      // DEPLOYED lines has no single answer for what that new line should
      // carry — the status loop above sets the flag off status alone, this
      // narrows it to a one-row selection.
      $page.variables.transferEnabled    = transferable && sel.length === 1;
      // Create Invoice is CUSTOMER-only and hidden — not disabled — on an
      // internal request. Invoicing is the customer-billing leg; an internal
      // request settles through Post Cost against its project and never
      // produces an invoice, so no selection or status on one could make this
      // button usable. Same rationale (and same oj-bind-if treatment in the
      // HTML) as the quote and Assign Project buttons.
      $page.variables.invoiceVisible     = isCustomer;
      $page.variables.invoiceEnabled     = invoiceable;
      $page.variables.shipConfirmEnabled = shipConfirmable;

      // ── Quote button: visibility, label, enablement ──────────────────────
      // Driven by the ENABLE_QUOTES global setting (NONE / PROJECTS / CUSTOMER /
      // BOTH), resolved for this request's origin in vbEnterChain via the
      // app-flow isQuotingAllowed() resolver and cached on the page (this is a
      // page module — it can't reach $application). When quoting isn't permitted
      // for this origin the button is HIDDEN outright, not shown-but-disabled.
      // Fails CLOSED while settings load. Was hardcoded `isCustomer`.
      const quotingAllowed = !!$page.variables.quotingAllowed;
      $page.variables.quoteVisible = quotingAllowed;

      // Once a quote exists the button becomes a read path — same target page,
      // relabelled "View Quote" and always enabled, so the manager can pull the
      // quote back up at any point after it was produced. The header status is
      // the marker that one exists.
      const QUOTE_EXISTS_STATES = ['QUOTE_GENERATED', 'QUOTE_ACCEPTED', 'DEPLOYED'];
      const headerStatus = String(fd.status || '').toUpperCase();
      const quoteExists  = QUOTE_EXISTS_STATES.indexOf(headerStatus) !== -1;

      // Generate path — a quote covers the WHOLE request, so it unlocks only when:
      //   • EVERY line is still quotable, AND
      //   • EVERY line is selected (partial selection must not enable it).
      //
      // The quotable set differs by origin because the two flows quote at
      // different points in their lifecycle:
      //   CUSTOMER → IN_PROCESS (quote precedes approval), plus UNDER_PROCUREMENT
      //              so a customer PR raised on a line doesn't block re-quoting.
      //              Customer submit writes IN_PROCESS directly now (see
      //              SubmitRequestChain) — it no longer passes through SUBMITTED.
      //   PROJECT  → IN_PROCESS: the project approver approves FIRST
      //              (SUBMITTED → IN_PROCESS), and only then does the equipment
      //              manager quote it. Omitting IN_PROCESS here would leave
      //              Generate Quote permanently disabled for project requests.
      // Whether quoting happens at all is a separate axis: the ENABLE_QUOTES
      // setting gates it via quotingAllowed above. When customer quoting is off
      // the button is hidden and the request proceeds straight to fulfilment —
      // this list only decides WHICH statuses are quotable when it IS on.
      const QUOTABLE_CUSTOMER = ['IN_PROCESS', 'UNDER_PROCUREMENT'];
      const QUOTABLE_PROJECT  = ['IN_PROCESS'];
      const quotableStatuses  = isCustomer ? QUOTABLE_CUSTOMER : QUOTABLE_PROJECT;
      // THE SELECTION GATE IS GONE; THE EVERY-LINE GATE STAYS.
      //
      // This used to require every line to be quotable AND every line to be
      // SELECTED (allQuotable && allSelected). Only the selection half is
      // dropped: generateQuote does not read the selection at all — it
      // navigates to request-quote with the requestId and nothing else (see
      // ActionChain 'generateQuote'), and the quote page loads the whole
      // request's lines itself. Ticking every row produced exactly the same
      // quote, so the gate was a hoop with no effect on the outcome.
      //
      // `every`, deliberately: a quote covers the WHOLE request, so it is only
      // offered when every line is at a quotable status. One line that is not
      // (already DEPLOYED, REJECTED, quoted earlier) means the request as a
      // whole is not in a quotable state.
      const totalLines   = lines.length;
      const allQuotable  = totalLines > 0 &&
        lines.every(l => quotableStatuses.indexOf(String(l.line_status || '').toUpperCase()) !== -1);

      // AVAILABILITY GATE — an IN_PROCESS line must be AVAILABLE to be quoted.
      //
      // Quoting a line the yards cannot supply commits a price for equipment
      // that does not exist to give. PARTIAL and NOT AVAILABLE both mean the
      // request cannot be met from stock, so the line has to be sourced first —
      // raise a Purchase Requisition, which moves it to UNDER_PROCUREMENT — and
      // only then is there something real to quote.
      //
      // Scoped to IN_PROCESS deliberately. UNDER_PROCUREMENT is quotable for a
      // customer request precisely BECAUSE its supply is already being arranged
      // through the PR, so re-checking availability there would block the very
      // line that just did the right thing. Anything else in quotableStatuses is
      // likewise past this question.
      //
      // Blank availability is treated as unavailable: the field is computed
      // server-side per the line's own date window, so an empty value means the
      // answer is unknown, and quoting on an unknown is the case this prevents.
      //
      // A RAISED PURCHASE REQUISITION SATISFIES THE GATE. Without this the rule
      // was a dead end: raising the PR does not make the line AVAILABLE — the
      // equipment still is not in a yard — so the button it told the manager to
      // unlock would have stayed disabled forever. A pr_number on the line is
      // the evidence that supply is being arranged, which is exactly what the
      // gate was asking for, so it releases the block.
      //
      // pr_number is stamped onto the row from the PR mirror
      // (resources/js/requestDetailLines.js), comma-joined when a line has more
      // than one requisition. Its PRESENCE is the signal — the same "a PR row
      // exists" test the quote page uses to decide procurement markup, rather
      // than line status, which lags behind the requisition.
      // `every`, matching allQuotable above: the quote covers the whole
      // request, so every line must clear this gate.
      const availableForQuote = totalLines > 0 && lines.every(l => {
        const st = String(l.line_status || '').toUpperCase();
        if (st !== 'IN_PROCESS') return true;
        if (String(l.availability || '').toUpperCase() === 'AVAILABLE') return true;
        // Not available — allowed through only once a requisition exists.
        return String(l.pr_number || '').trim() !== '';
      });

      $page.variables.quoteButtonLabel = quoteExists ? 'View Quote' : 'Generate Quote';
      // View is unconditional (you're reading an existing quote). Generate
      // requires every line quotable and available — but NO selection, so the
      // button is live as soon as the request qualifies.
      // availableForQuote applies only to the GENERATE path — viewing an
      // existing quote must never be blocked by a line that has since become
      // unavailable.
      $page.variables.quoteEnabled = quotingAllowed &&
        (quoteExists || (allQuotable && availableForQuote));
    }

    toggleRowSelected(rowIndex, $page, event) {
      // A terminal (rejected/cancelled) line can never enter the selection.
      // Every toolbar action here acts on the selection, so refusing selection
      // is what makes "no action at all" hold for ALL of them at once — rather
      // than each action having to filter terminal lines out itself and one of
      // them eventually forgetting. The checkbox is also rendered disabled, so
      // this is the programmatic backstop for a keyboard/DOM-driven change.
      // Undo the browser's optimistic tick before bailing, otherwise the input
      // would sit checked while the Set says otherwise.
      if (this.isLineTerminal(rowIndex, $page)) {
        if (event && event.target) event.target.checked = false;
        return;
      }

      if (event.target.checked) {
        this._selectedRows.add(rowIndex);
      } else {
        this._selectedRows.delete(rowIndex);
      }
      this._bumpSelectionVersion($page);
      this.updatePoButtonEnabled($page);
      this.updateActionButtons($page);
    }

    // Row indices that are allowed into the selection: every row except the
    // terminal (rejected/cancelled) ones. Both select-all and the header's
    // checked-state read this so they agree — measuring "all selected" against
    // the RAW row count would leave the header permanently unchecked on any
    // request containing a rejected line, since that row can never be added.
    _selectableRowIndices($page) {
      const total = ($page && $page.variables && Array.isArray($page.variables.linesArray))
        ? $page.variables.linesArray.length
        : (this._data || []).length;
      const out = [];
      for (let i = 0; i < total; i++) {
        if (!this.isLineTerminal(i, $page)) out.push(i);
      }
      return out;
    }

    // Total row count comes from $page.variables.linesArray (source of truth)
    // rather than this._data, because the grid's 2-D cell array may be stale
    // mid-render. _v is the version-trigger dependency (see comment on
    // isRowSelected for why).
    isAllSelected(_v, $page) {
      const selectable = this._selectableRowIndices($page);
      return selectable.length > 0 && this._selectedRows.size === selectable.length;
    }

    toggleAllSelected($page, event) {
      const checked = !!event.target.checked;
      this._selectedRows.clear();
      if (checked) {
        // Terminal lines are skipped, so "select all" means "select everything
        // that can actually be acted on".
        this._selectableRowIndices($page).forEach(i => this._selectedRows.add(i));
      }
      this._bumpSelectionVersion($page);
      this.updatePoButtonEnabled($page);
      this.updateActionButtons($page);
    }

    // Increments the reactive page variable that header + row checkbox
    // bindings depend on. Without this, neither the header tick nor any
    // row tick re-evaluates after a toggle and the UI looks frozen.
    _bumpSelectionVersion($page) {
      if (!$page || !$page.variables) return;
      const cur = Number($page.variables.selectionVersion || 0);
      $page.variables.selectionVersion = cur + 1;
    }

    // True when the request carries BOTH a project and a task.
    //
    // Reads them off the LINES, not formData: project_ref_id / task_id are
    // request-level values that request-detail-lines repeats onto every line
    // row (see resources/js/requestDetailLines.js mapRow), and that endpoint is
    // the only one on this page that returns the ids at all —
    // workbench-requests, which feeds formData, exposes only projectName /
    // taskName. Taking the first line that has a value keeps this correct
    // whether or not the header fetch carried the ids.
    //
    // Used to gate Confirm on customer requests (project + task are required
    // before confirming) and to label the Assign Project button Assign/Change.
    hasAssignedProject($page) {
      const lines = ($page && $page.variables && Array.isArray($page.variables.linesArray))
        ? $page.variables.linesArray
        : [];
      const has = (v) => v !== null && v !== undefined && String(v).trim() !== '';
      return lines.some(l => l && has(l.project_ref_id))
          && lines.some(l => l && has(l.task_id));
    }

    // Trailing-edge debounce used by the Assign Project drawer's project
    // typeahead. Copied from customer-portal project-create-request-page.js so
    // the two Project LOVs behave identically. Resolves to `value` only for the
    // most recent call under `key`; every superseded call resolves to null, so
    // the caller can skip issuing a fetch for a keystroke the user has already
    // typed past.
    debounce(key, value, delay) {
      if (!this._debounceState) this._debounceState = {};
      const state = this._debounceState;
      if (!state[key]) state[key] = { count: 0 };
      state[key].count++;
      const myCount = state[key].count;
      return new Promise((resolve) => {
        if (state[key].timer) clearTimeout(state[key].timer);
        state[key].timer = setTimeout(() => {
          resolve(state[key].count === myCount ? value : null);
        }, delay || 200);
      });
    }

    getStatusLOV() { return this._statusLOV; }

    // Build an ArrayDataProvider for the per-line expenditure-type dropdown from
    // the list loaded on dialog open (ActionChain requestPo -> $variables.expTypeList).
    // Called from the dialog HTML; rebuilds when the list reference changes.
    getExpTypeLOV(list) {
      var items = Array.isArray(list) ? list : [];
      return new ArrayDataProvider(items, { keyAttributes: 'value' });
    }

    getExpOrgLOV(list) {
      var items = Array.isArray(list) ? list : [];
      return new ArrayDataProvider(items, { keyAttributes: 'value' });
    }

    // Static 2-option LOV for the PR Deliver-to Location Type (mirrors Fusion:
    // Internal = registered location; One Time = free-text ad-hoc address).
    getDeliverToTypeLOV() {
      return new ArrayDataProvider([
        { value: 'INTERNAL', label: 'Internal' },
        { value: 'ONE_TIME', label: 'Request Site' }
      ], { keyAttributes: 'value' });
    }

    // Submit gate for the delivery target: INTERNAL needs a registered location
    // picked; ONE_TIME needs at least Address Line 1 for the one-time-location POST.
    deliveryTargetValid(prHeader, prDeliveryAddress) {
      var h = prHeader || {};
      if (h.deliverToLocationType === 'ONE_TIME') {
        var a = prDeliveryAddress || {};
        return !!(a.address1 && String(a.address1).trim());
      }
      return h.deliverToLocationId != null;
    }

    // Submit gate for the PR drawer: every line must have an expenditure type AND
    // org chosen, but ONLY for a request-specific PROJECT PR (the toggle-off case
    // sends no project distribution, and a customer PR has no project fields at
    // all — both hide those inputs, so they must not be required). Neither is
    // pre-filled for a project PR, so this forces the manager to pick both before
    // creating the requisition. A customer PR (isCustomerRequest) skips the check
    // — otherwise the button would stay disabled forever, since the fields are hidden.
    prLinesValid(prLines, isRequestSpecific, isCustomerRequest) {
      if (isCustomerRequest === true) return true;
      if (!isRequestSpecific) return true;
      var lines = Array.isArray(prLines) ? prLines : [];
      if (!lines.length) return false;
      return lines.every(function (l) {
        return l && l.expenditureTypeId != null && l.expenditureOrgId != null;
      });
    }

    // Line-level status renders as plain text — colour pills are reserved for
    // the request header status. See resources/js/lineStatusLabels.js.
    getStatusBadgeClass(status) {
      return lineStatusLabels.statusTextClass(status);
    }

    // ── Transfer drawer's delivery-location map — verbatim behaviour port of
    // project-create-request-page.js's same-named methods, just re-homed onto
    // this page's class and pointed at #rdp-transfer-map instead of #pcr-map
    // so the two pages' map instances never collide if both happen to be
    // mounted in the same session. ──────────────────────────────────────────
    addressSuggestionsProvider() {
      return this._addrDP;
    }

    initLocationMap() {
      var self = this;
      setTimeout(function () {
        var el = document.getElementById('rdp-transfer-map');
        if (!el || !mapboxgl) {
          if (!mapboxgl) console.warn('[request-detail transfer] mapboxgl not loaded — map skipped.');
          return;
        }
        if (!mapboxgl.accessToken) mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

        self.destroyLocationMap();

        var start = self._picked ? [self._picked.lng, self._picked.lat] : MAPBOX_DEFAULT_CENTER;
        var map = self._locMap = new mapboxgl.Map({
          container: el,
          style: 'mapbox://styles/mapbox/streets-v12',
          center: (self._picked && self._picked.lng != null) ? start : MAPBOX_DEFAULT_CENTER,
          zoom: (self._picked && self._picked.lng != null) ? 14 : 9
        });
        map.addControl(new mapboxgl.NavigationControl(), 'top-right');

        var marker = self._locMarker = new mapboxgl.Marker({ draggable: true, color: '#1565C0' });
        if (self._picked && self._picked.lng != null) marker.setLngLat(start).addTo(map);

        map.on('click', function (e) { self._reverseGeocode(e.lngLat.lng, e.lngLat.lat); });
        marker.on('dragend', function () {
          var ll = marker.getLngLat();
          self._reverseGeocode(ll.lng, ll.lat);
        });

        setTimeout(function () { try { map.resize(); } catch (e) {} }, 300);
      }, 250);
    }

    applySuggestion(data) {
      if (!data) return;
      this._picked = data;
      if (this._locMap && data.lng != null && data.lat != null) {
        this._locMap.flyTo({ center: [data.lng, data.lat], zoom: 15 });
        if (this._locMarker) this._locMarker.setLngLat([data.lng, data.lat]).addTo(this._locMap);
      }
      this._emit(data);
    }

    _reverseGeocode(lng, lat) {
      if (this._locMarker && this._locMap) this._locMarker.setLngLat([lng, lat]).addTo(this._locMap);
      var self = this;
      fetch('https://api.mapbox.com/geocoding/v5/mapbox.places/' + lng + ',' + lat +
            '.json?limit=1&access_token=' + ((mapboxgl && mapboxgl.accessToken) || MAPBOX_ACCESS_TOKEN))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (body) {
          var f = body && Array.isArray(body.features) && body.features[0];
          var parsed = self._parseFeature(f, lat.toFixed(5) + ', ' + lng.toFixed(5));
          parsed.lat = lat; parsed.lng = lng;
          self._picked = parsed;
          self._emit(parsed);
        })
        .catch(function () { /* tolerate */ });
    }

    _parseFeature(f, fallbackLabel) {
      var out = {
        addr1: '', addr2: '', city: '', county: '', state: '',
        postalCode: '', country: '', formatted: '', lat: null, lng: null
      };
      if (!f) { out.addr1 = fallbackLabel || ''; out.formatted = fallbackLabel || ''; return out; }

      out.formatted = f.place_name || fallbackLabel || '';
      if (Array.isArray(f.center) && f.center.length >= 2) {
        out.lng = Number(f.center[0]);
        out.lat = Number(f.center[1]);
      }

      var types = f.place_type || [];
      if (types.indexOf('address') !== -1) {
        out.addr1 = ((f.address ? f.address + ' ' : '') + (f.text || '')).trim();
      } else {
        out.addr1 = (out.formatted.split(',')[0] || '').trim();
      }

      (f.context || []).forEach(function (c) {
        var id = (c && c.id) || '';
        if (id.indexOf('postcode') === 0)      out.postalCode = c.text || '';
        else if (id.indexOf('place') === 0)    out.city = c.text || '';
        else if (id.indexOf('district') === 0) out.county = c.text || '';
        else if (id.indexOf('region') === 0)   out.state = c.text || '';
        else if (id.indexOf('country') === 0)  out.country = c.text || '';
      });
      return out;
    }

    _emit(p) {
      if (!this._eventHelper) return;
      try {
        this._eventHelper.fireCustomEvent('transferLocationResolved', { data: p });
      } catch (e) {
        console.warn('[request-detail transfer] fireCustomEvent(transferLocationResolved) failed:', e);
      }
    }

    destroyLocationMap() {
      if (this._locMap) { try { this._locMap.remove(); } catch (e) {} this._locMap = null; }
      this._locMarker = null;
    }

    getPickedLocation() {
      return this._picked || null;
    }

    // ── Internal-location (INV_ORG) address formatting — verbatim port of
    // project-create-request-page.js's same-named methods. The address comes
    // straight off the bu-org-mappings row (no live geocode call needed —
    // see invOrgLocationSDP's own description for why). ────────────────────
    formatInvOrgAddress(d) {
      if (!d) return '';
      var parts = [];
      var push = function (v) {
        if (v == null) return;
        var s = String(v).trim();
        if (s) parts.push(s);
      };

      push(d.addressLine1);
      push(d.addressLine2);
      push(d.townOrCity);

      var region = d.region2 == null ? '' : String(d.region2).trim();
      var postal = d.postalCode == null ? '' : String(d.postalCode).trim();
      var regionPostal = [region, postal].filter(function (s) { return !!s; }).join(' ');
      push(regionPostal);

      push(d.country);
      return parts.join(', ');
    }

    invOrgOptionText(d) {
      if (!d) return '';
      var addr = this.formatInvOrgAddress(d);
      return addr || (d.invOrgName == null ? '' : String(d.invOrgName).trim());
    }
  }

  return PageModule;
});
