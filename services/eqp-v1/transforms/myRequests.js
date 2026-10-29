/**
 * VBCS transforms for getEquipriteV1ViewsMyRequests — endpoint-scoped.
 *
 * SDP-side translator that turns JET filter/paginate concepts into the flat
 * query-string contract the backend speaks:
 *
 *    ?page=<n>&size=<n>              (server-side pagination)
 *    &requestStatus=<status>         (Status facet — exact match)
 *    &requestOrigin=<INTERNAL|EXTERNAL> (Source facet — exact match, manager-only chip)
 *    &q=<text>                       (keyword search)
 *    &sortBy=<col>&sortOrder=asc|desc (column sort)
 *
 * requestOrigin is DELIBERATELY a separate param from the page's own
 * `filter` uriParameter (requestsSDP.uriParameters.filter, resolved from
 * myRequestsOriginFilter() by role — 'ALL' for a manager, 'Internal'
 * otherwise). That one is a SECURITY scope and must never be overridable by
 * a user-picked chip value — appendParams() below would silently replace it
 * if the two ever shared a key. requestOrigin only NARROWS within whatever
 * `filter` already grants; it never widens it. VERIFY SERVER-SIDE before
 * relying on this: the real backend's accepted query params are not
 * declared in openapi3.json for either `filter` or `requestOrigin` (the
 * same gap that already existed for `filter` before this chip was added),
 * so this transform can only guarantee what the FRONTEND sends — not that
 * the backend applies it as an AND on top of the origin scope.
 *
 * requestStatus is confirmed supported by the backend; requestOrigin is new
 * and unconfirmed. Default order (no sortBy) is newest first by createdDate
 * DESC, so "latest on top" needs no param.
 *
 * Wired in openapi3.json under the GET operation's
 *   "x-vb": { "transforms": { "path": "./transforms/myRequests.js" } }
 * so ONLY this endpoint uses these transforms. Providing an explicit filter
 * transform also suppresses VBCS's default transform, which would otherwise emit
 * ?q=<RAMP expr> the backend can't parse.
 */
define(['urijs/URI'], function (URI) {
  'use strict';

  var Request = function () {};

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
   * Extracts keyword (q), the Status facet (requestStatus), and the Source
   * facet (requestOrigin — manager-only chip, see the file header note on
   * why this is a separate param from the role-based `filter` scope).
   *
   * Criterion shapes handled:
   *   Keyword:                 { text: 'excavator', matchBy: 'phrase' }
   *   Nested SelectSingle:     { op: '$eq', value: { status: 'SUBMITTED' } }
   *   Flat SelectSingle:       { op: '$eq', attribute: 'status', value: 'SUBMITTED' }
   *   Root/AND compound:       { $tag: '_root_', criteria: [...] } / { op:'$and', criteria:[...] }
   *   (requestOrigin uses the identical nested/flat shapes, keyed 'requestOrigin'
   *   instead of 'status'.)
   */
  Request.prototype.filter = function (configuration, options) {
    var fc = options;
    if (!fc) return configuration;

    var extracted = {};
    // Facet field name -> output query-param name. Add future single-value
    // chips here rather than hardcoding another near-duplicate branch below.
    // projectName and requestNumber are unconfirmed server-side, same caveat
    // as requestOrigin — see the file header note.
    var FACETS = { status: 'requestStatus', requestOrigin: 'requestOrigin', projectName: 'projectName', requestNumber: 'requestNumber' };

    function visit(c) {
      if (!c) return;

      // Keyword
      if (c.text && c.matchBy === 'phrase') {
        extracted.q = c.text;
        return;
      }

      // Nested SelectSingle: { op:'$eq', value:{ <facet>: 'X' } }
      if (c.op === '$eq' && !c.attribute && c.value && typeof c.value === 'object') {
        var keys = Object.keys(c.value);
        if (keys.length === 1 && FACETS[keys[0]]) {
          extracted[FACETS[keys[0]]] = c.value[keys[0]];
        }
        return;
      }

      // Flat SelectSingle: { op:'$eq', attribute:'<facet>', value:'X' }
      if (c.op === '$eq' && c.attribute && FACETS[c.attribute]) {
        extracted[FACETS[c.attribute]] = c.value;
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
   *   [{ attribute: 'startDate', direction: 'descending' }]
   *
   * The table field names match the view's own column names, so we forward the
   * attribute straight through as sortBy (case-insensitive asc/desc), restricted
   * to a whitelist so non-sortable/template columns never emit a param.
   *
   * The DEFAULT newest-first order comes from the backend's ORDER BY createdDate
   * DESC (applied when no sortBy is present), so "latest on top" needs no
   * sortCriteria here — we only emit sortBy when the user clicks a column.
   */
  var SORTABLE = {
    requestNumber: true,
    projectName:   true,
    taskName:      true,
    requestorName: true,
    status:        true,
    startDate:     true,
    endDate:       true
  };

  Request.prototype.sort = function (configuration, options) {
    if (!Array.isArray(options) || options.length === 0) return configuration;
    var first = options[0];
    if (!first || !SORTABLE[first.attribute]) return configuration;
    configuration.url = appendParams(configuration.url, {
      sortBy:    first.attribute,
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
   * Backend returns:
   *   { data:[...], recordCount, page, pageSize, totalPages, hasMore }
   * VBCS expects { totalSize, hasMore } from the paginate response transform
   * to drive loadMoreOnScroll (knows when to stop fetching).
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