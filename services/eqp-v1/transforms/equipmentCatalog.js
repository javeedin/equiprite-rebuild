/**
 * VBCS transforms for getEquipriteV1ViewsEquipmentCatalog — endpoint-scoped.
 *
 * SDP-side translator that converts JET smart-search filter / paginate concepts
 * into the flat query-string the catalog backend speaks:
 *
 *    ?keyword=<text>
 *    &equipmentClassId=<id>
 *    &equipmentSubclassId=<id>
 *    &status=<AVAILABLE|PARTIAL AVAILABLE|NOT AVAILABLE>
 *    &assetGroupId=<id>      (items with an active asset in the group)
 *    &page=<n>&size=<n>
 *
 * startDate / endDate / requestedQty are supplied separately via the SDP's
 * uriParameters (they're required and date-scoped), so they are NOT handled here.
 *
 * Wired in openapi3.json under the GET operation's
 *   "x-vb": { "transforms": { "path": "./transforms/equipmentCatalog" } }
 * so ONLY this endpoint uses these transforms. Mirrors equipmentMaster.js;
 * differs only in the param names (keyword vs q, + status).
 */
define(['urijs/URI'], function (URI) {
  'use strict';

  var Request = function () {};

  function appendParams(url, addObj) {
    var current = URI(url).search(true);
    Object.keys(addObj).forEach(function (k) {
      if (addObj[k] !== undefined && addObj[k] !== null && addObj[k] !== '') {
        current[k] = addObj[k];
      }
    });
    return URI(url).search(current).toString();
  }

  // Optional uriParameters (agreementId, templateId) that evaluate to null in
  // the page binding can be serialized by the SDP as the literal string 'null'
  // (or empty), which the backend rejects with 400 "Invalid value 'null'".
  // Scrub any optional param that came through as missing/'null'/'undefined'.
  // Called from filter + paginate (the request transforms VBCS actually invokes
  // — paginate fires on every list-view load via loadMoreOnScroll, so the
  // bare-fetch case is covered).
  var OPTIONAL_PARAMS = ['agreementId', 'templateId'];
  function stripEmptyOptionalParams(url) {
    var current = URI(url).search(true);
    var changed = false;
    OPTIONAL_PARAMS.forEach(function (k) {
      var v = current[k];
      if (v === 'null' || v === 'undefined' || v === '') {
        delete current[k];
        changed = true;
      }
    });
    return changed ? URI(url).search(current).toString() : url;
  }

  /**
   * Filter transform. `options` is the smart-search filterCriterion.
   * Extracts keyword + equipmentClassId / equipmentSubclassId / status / assetGroupId.
   *
   *   Keyword:        { text: 'exc', matchBy: 'phrase' }
   *   Nested facet:   { op:'$eq', value: { equipmentClassId: 1000000031 } }
   *   Flat facet:     { op:'$eq', attribute: 'equipmentClassId', value: 1000000031 }
   *   Compound:       { $tag:'_root_', criteria:[...] } / { op:'$and', criteria:[...] }
   */
  Request.prototype.filter = function (configuration, options) {
    var fc = options;
    if (!fc) return configuration;

    var extracted = {};
    var FACETS = { equipmentClassId: 1, equipmentSubclassId: 1, status: 1, assetGroupId: 1 };

    function visit(c) {
      if (!c) return;

      if (c.text && c.matchBy === 'phrase') {
        extracted.keyword = c.text;
        return;
      }

      // Nested SelectSingle: { op:'$eq', value:{ <field>: <val> } }
      if (c.op === '$eq' && !c.attribute && c.value && typeof c.value === 'object') {
        var keys = Object.keys(c.value);
        if (keys.length === 1 && FACETS[keys[0]]) {
          extracted[keys[0]] = c.value[keys[0]];
        }
        return;
      }

      // Flat SelectSingle: { op:'$eq', attribute:'<field>', value:<val> }
      if (c.op === '$eq' && c.attribute && FACETS[c.attribute]) {
        extracted[c.attribute] = c.value;
        return;
      }

      if (c.$tag === '_root_' && Array.isArray(c.criteria)) { c.criteria.forEach(visit); return; }
      if (c.op === '$and' && Array.isArray(c.criteria)) { c.criteria.forEach(visit); }
    }

    visit(fc);

    if (Object.keys(extracted).length > 0) {
      configuration.url = appendParams(configuration.url, extracted);
    }
    configuration.url = stripEmptyOptionalParams(configuration.url);
    return configuration;
  };

  /**
   * Paginate transform. JET passes { offset, size }; backend speaks page/size.
   *
   * SIZE FLOOR: JET's PagingDataProviderView runs an internal count-walk using a
   * tiny default chunk (size=4) to discover the total when it can't read an exact
   * totalSize through the SDP→DPV→PagingDPV layers — that produced ~23 calls to
   * page through all 92 rows. We floor the size at the display page size (24) so
   * that walk fetches in 24-row chunks (~4 calls) and aligns with the visible
   * page. offset stays authoritative, so page math is computed from the floored
   * size to keep slices aligned.
   */
  var MIN_PAGE_SIZE = 24;

  Request.prototype.paginate = function (configuration, options) {
    // Scrub stray optional params first — runs even when there's no size, so
    // the initial unpaginated fetch is covered too.
    configuration.url = stripEmptyOptionalParams(configuration.url);
    if (!options || options.size == null) return configuration;
    var size = Math.max(options.size, MIN_PAGE_SIZE);
    var page = Math.floor((options.offset || 0) / size);
    configuration.url = appendParams(configuration.url, { page: page, size: size });
    return configuration;
  };

  // ── Response transforms ─────────────────────────────────────────────
  var Response = function () {};

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
