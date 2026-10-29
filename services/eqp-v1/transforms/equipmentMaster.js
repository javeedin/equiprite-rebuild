/**
 * VBCS transforms for getEquipriteV1EquipmentMaster — endpoint-scoped.
 *
 * This is the SDP-side translator that converts JET filter/sort/paginate
 * concepts into the flat query-string contract the backend speaks:
 *
 *    ?q=<text>
 *    &equipmentClassId=<id>
 *    &equipmentSubclassId=<id>
 *    &assetGroupId=<id>      (items with an active asset in the group)
 *    &sortBy=<column>&sortOrder=asc|desc
 *    &page=<n>&size=<n>
 *
 * Wired in openapi3.json under the GET operation's
 *   "x-vb": { "transforms": { "path": "./transforms/equipmentMaster.js" } }
 *
 * So ONLY this endpoint uses these transforms — other eqp-v1 endpoints
 * stay untouched. Important because the default VBCS transforms would
 * emit ?q=<RAMP expr> which our backend wouldn't understand.
 */
define(['urijs/URI'], function (URI) {
  'use strict';

  var Request = function () {};

  // Single-select facets passed through as-is: smart-search field -> query param.
  var FACETS = ['equipmentClassId', 'equipmentSubclassId', 'assetGroupId'];

  // ── helper: append URI search params without trampling existing ones ──
  function appendParams(url, addObj) {
    var current = URI(url).search(true);
    Object.keys(addObj).forEach(function (k) {
      if (addObj[k] !== undefined && addObj[k] !== null && addObj[k] !== '') {
        current[k] = addObj[k];
      }
    });
    return URI(url).search(current).toString();
  }

  /**
   * Filter transform. Receives the smart-search filterCriterion as `options`.
   * Walks the tree and extracts q and the FACETS.
   *
   * Criterion shapes we handle:
   *
   *   Keyword:
   *     { text: 'CAT', matchBy: 'phrase' }
   *
   *   Single-select facet (nested form smart-search emits):
   *     { op: '$eq', value: { equipmentClassId: 1000000031 } }
   *
   *   Single-select facet (flat form some chains emit):
   *     { op: '$eq', attribute: 'equipmentClassId', value: 1000000031 }
   *
   *   Compound (keyword + facet combined):
   *     { $tag: '_root_', criteria: [<keyword>, <facet>] }
   *     { op: '$and', criteria: [...] }
   */
  Request.prototype.filter = function (configuration, options, transformsContext) {
    var fc = options;
    if (!fc) return configuration;

    var extracted = {};

    function visit(c) {
      if (!c) return;

      // Keyword
      if (c.text && c.matchBy === 'phrase') {
        extracted.q = c.text;
        return;
      }

      // Nested SelectSingle: { op:'$eq', value:{ <field>: <id> } }
      if (c.op === '$eq' && !c.attribute && c.value && typeof c.value === 'object') {
        var keys = Object.keys(c.value);
        if (keys.length === 1) {
          var k = keys[0];
          if (FACETS.indexOf(k) !== -1) {
            extracted[k] = c.value[k];
          }
        }
        return;
      }

      // Flat SelectSingle: { op:'$eq', attribute:'<field>', value:<id> }
      if (c.op === '$eq' && c.attribute) {
        if (FACETS.indexOf(c.attribute) !== -1) {
          extracted[c.attribute] = c.value;
        }
        return;
      }

      // Root compound: { $tag:'_root_', criteria:[...] }
      if (c.$tag === '_root_' && Array.isArray(c.criteria)) {
        c.criteria.forEach(visit);
        return;
      }

      // AND compound
      if (c.op === '$and' && Array.isArray(c.criteria)) {
        c.criteria.forEach(visit);
      }
    }

    visit(fc);

    if (Object.keys(extracted).length > 0) {
      configuration.url = appendParams(configuration.url, extracted);
    }
    return configuration;
  };

  /**
   * Sort transform. `options` is the JET sortCriteria array:
   *   [{ attribute: 'manufacturer', direction: 'ascending' }]
   *
   * The column 'attribute' here is whatever the table passed — which in
   * our case is the MAPPED row-shape field name (equipment_name, etc.).
   * We translate via FIELD_TO_SORTBY back to the entity column the
   * backend's sortBy whitelist expects.
   *
   * Non-whitelisted columns are silently dropped (no sort param sent).
   */
  // Keyed by what oj-table actually sorts on: the column's `field`, or its
  // `sortProperty` for template columns (Class / Subclass). Until 2026-10-05
  // this was keyed by snake_case names no column uses (equipment_id,
  // status...), so every lookup missed and no sortBy was sent: Number, Name,
  // Type and Status showed a sort arrow and never re-ordered. The values are
  // the backend's sortBy whitelist (verified live: all 7 return 200).
  var FIELD_TO_SORTBY = {
    equipmentNumber: 'equipmentNumber',
    equipmentName:   'equipmentName',
    className:       'className',
    subclassName:    'subclassName',
    equipmentType:   'equipmentType',
    catalogStatus:   'catalogStatus',
    manufacturer:    'manufacturer'
  };

  Request.prototype.sort = function (configuration, options) {
    if (!Array.isArray(options) || options.length === 0) return configuration;

    var first = options[0];
    var backendCol = FIELD_TO_SORTBY[first.attribute];
    if (!backendCol) return configuration;

    configuration.url = appendParams(configuration.url, {
      sortBy:    backendCol,
      sortOrder: first.direction === 'descending' ? 'desc' : 'asc'
    });
    return configuration;
  };

  /**
   * Paginate transform. JET passes { offset, size }. Backend speaks page/size.
   */
  Request.prototype.paginate = function (configuration, options) {
    if (!options || options.size == null) return configuration;
    var size = options.size;
    var page = Math.floor((options.offset || 0) / size);
    configuration.url = appendParams(configuration.url, {
      page: page,
      size: size
    });
    return configuration;
  };

  // ── Response transforms ─────────────────────────────────────────────
  var Response = function () {};

  /**
   * Tell the DataProvider what came back. Backend returns:
   *   { data:[...], recordCount, page, pageSize, totalPages, hasMore }
   *
   * VBCS expects { totalSize, hasMore } from the paginate response transform.
   */
  Response.prototype.paginate = function (result) {
    var tr = {};
    if (result && result.body) {
      var b = result.body;
      if (b.recordCount != null) tr.totalSize = b.recordCount;
      if (typeof b.hasMore === 'boolean') tr.hasMore = b.hasMore;
    }
    return tr;
  };

  return { request: Request, response: Response };
});
