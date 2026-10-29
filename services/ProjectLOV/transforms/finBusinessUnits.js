/**
 * VBCS transforms for getFscmRestApiResources11_13_18_05FinBusinessUnitsLOV —
 * endpoint-scoped.
 *
 * Translates the JET keyword criterion an oj-select-single emits while the user
 * types into the ADF predicate Fusion speaks on ?q=. The attributes to search come
 * from the SDP's transformsContext['vb-textFilterAttributes'] and OR together, each
 * contributing the term its type allows:
 *
 *    typed 'Aus'  →  q=BusinessUnitName LIKE '*Aus*'
 *    typed '3000' →  q=BusinessUnitName LIKE '*3000*'
 *    typed '300000046987012'
 *                 →  q=BusinessUnitName LIKE '*300000046987012*'
 *                      OR BusinessUnitId=300000046987012
 *
 * which reaches the wire percent-encoded as
 *    ...&q=BusinessUnitName%20LIKE%20%27%2AAus%2A%27
 *
 * Wired in openapi3.json under the GET operation's
 *   "x-vb": { "transforms": { "path": "./transforms/finBusinessUnits" } }
 *
 * Scoped to ONLY this operation, so the other ProjectLOV endpoints (projectsLOV,
 * inventoryOrganizations, …) keep the default transforms.
 *
 * NOTE — this operation is shared. configurations-page's EsBuLovSDP relies on the
 * translation below, but BuOrgBuSDP (the BU & Org Mapping tab's typeahead) hand-
 * authors its own predicate into uriParameters.q via buSearchQ/BuTypeaheadChain.
 * An explicit q therefore always wins: see the guard in filter().
 */
define(['urijs/URI'], function (URI) {
  'use strict';

  // Attributes Fusion types as numbers. They take an equality term rather than a
  // LIKE one, which Fusion only accepts against string attributes.
  var NUMERIC_ATTRIBUTES = { BusinessUnitId: true };

  /**
   * Percent-encode a q predicate, RFC 3986 style: space as %20, and ' * ( ) ! too,
   * which encodeURIComponent leaves bare. Yields the encoding Fusion is known to
   * accept, e.g. BusinessUnitName%20LIKE%20%27%2AAus%2A%27.
   *
   * URI().addSearch() is deliberately not used to write this: it form-encodes,
   * turning every space into '+', and a q predicate is mostly spaces.
   */
  function encodeQ(value) {
    return encodeURIComponent(value).replace(/[!'()*]/g, function (c) {
      return '%' + c.charCodeAt(0).toString(16).toUpperCase();
    });
  }

  var Request = function () {};

  /**
   * Filter transform. `options` is the filterCriterion. Both paths that matter
   * here surface the typed text the same way:
   *
   *   oj-select-single search-as-you-type:  { text: 'Aus', matchBy: 'phrase' }
   *   compound (defensive):                 { $tag: '_root_', criteria: [...] }
   *
   * The attribute to search comes from the SDP's
   * transformsContext['vb-textFilterAttributes']; multiple attributes OR together.
   */
  Request.prototype.filter = function (configuration, options, transformsContext) {
    if (!options) return configuration;

    // An explicit q is a hand-authored Fusion predicate that already expresses the
    // caller's full intent — translating on top of it would clobber or double it.
    if (URI(configuration.url).search(true).q) return configuration;

    var attributes = (transformsContext && transformsContext['vb-textFilterAttributes']) || [];
    if (!attributes.length) return configuration;

    var text;

    function visit(c) {
      if (!c || text) return;

      // Keyword. matchBy is left unchecked (phrase/fuzzy/undefined all mean
      // "substring" to us) — same leniency as eqp-v1's invOrgs.js.
      if (c.text) {
        text = c.text;
        return;
      }
      if (Array.isArray(c.criteria)) c.criteria.forEach(visit);
    }

    visit(options);

    // Single quote terminates the predicate's string literal and Fusion offers no
    // escape for it, so drop it rather than emit a malformed q. Worst case a BU
    // with an apostrophe matches on the surrounding text.
    if (text) text = String(text).replace(/'/g, '').trim();
    if (!text) return configuration;

    var terms = [];
    attributes.forEach(function (attr) {
      if (!NUMERIC_ATTRIBUTES[attr]) {
        terms.push(attr + " LIKE '*" + text + "*'");
      } else if (/^\d+$/.test(text)) {
        // LIKE is only valid against a string attribute, so an id is searchable
        // by exact match alone — and only once the typed text is a whole number.
        // Partial digits ('3000') simply contribute no id term.
        terms.push(attr + '=' + text);
      }
    });

    if (!terms.length) return configuration;

    // Safe to append rather than merge: the guard above established there's no q.
    var separator = configuration.url.indexOf('?') === -1 ? '?' : '&';
    configuration.url += separator + 'q=' + encodeQ(terms.join(' OR '));
    return configuration;
  };

  return { request: Request };
});
