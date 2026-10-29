/**
 * VBCS transforms for getInvOrgs — endpoint-scoped.
 *
 * Translates JET filter/sort/paginate concepts into the flat query-string
 * the backend speaks:
 *
 *    ?q=<text>           case-insensitive substring on org name OR code
 *    &status=<status>
 *    &sort=<col>,<dir>   (Spring Pageable sort)
 *    &page=<n>&size=<n>
 *
 * Wired in openapi3.json under the GET operation's
 *   "x-vb": { "transforms": { "path": "./transforms/invOrgs.js" } }
 *
 * Scoped to ONLY this endpoint — the default VBCS transforms would emit
 * ?q=<RAMP expr> which the backend wouldn't understand. Mirrors the
 * equipmentMaster.js translator.
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

  /**
   * Filter transform. The yard dropdown emits a keyword criterion as the
   * user types: { text: 'Atl', matchBy: 'phrase' }. Extract it to ?q=.
   */
  Request.prototype.filter = function (configuration, options) {
    var fc = options;
    if (!fc) return configuration;

    var extracted = {};

    function visit(c) {
      if (!c) return;

      // Keyword (search-as-you-type)
      if (c.text && (c.matchBy === 'phrase' || c.matchBy === 'fuzzy' || c.matchBy == null)) {
        extracted.q = c.text;
        return;
      }

      // Compound forms
      if (c.$tag === '_root_' && Array.isArray(c.criteria)) {
        c.criteria.forEach(visit);
        return;
      }
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
   * Paginate transform. JET passes { offset, size }; backend speaks page/size.
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

  var Response = function () {};

  /**
   * Backend returns { data, recordCount, page, pageSize, totalPages, hasMore }.
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
