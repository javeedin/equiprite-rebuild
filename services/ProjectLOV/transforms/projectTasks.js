/**
 * VBCS transforms for getFscmRestApiResources11_13_18_05ProjectTasks
 * (projects/{ProjectId}/child/Tasks) — endpoint-scoped.
 *
 * Translates the JET keyword criterion an oj-select-single emits while the user
 * types in the dropdown's filter field into the ADF predicate Fusion speaks on
 * ?q=. The attributes to search come from the SDP's
 * transformsContext['vb-textFilterAttributes'] and OR together:
 *
 *    typed 'design'  →  q=TaskName LIKE '*design*' OR TaskNumber LIKE '*design*'
 *    typed '1.1'     →  q=TaskName LIKE '*1.1*'    OR TaskNumber LIKE '*1.1*'
 *
 * which reaches the wire percent-encoded as
 *    ...&q=TaskName%20LIKE%20%27%2Adesign%2A%27%20OR%20...
 *
 * WHY this exists rather than hand-writing q into uriParameters (what
 * TaskTypeaheadChain used to do for the oj-input-search): the filter has to be
 * driven by the component's own filterCriterion so that filtering and PAGING
 * come from the same fetch. The dropdown's oj-list-view loads more on scroll,
 * so every page of results must carry the same predicate — a page variable
 * rewritten by a separate listener chain cannot guarantee that ordering.
 *
 * Project scoping is NOT expressed here: it lives in the ProjectId PATH
 * parameter of the child resource. Adding a `ProjectId=` term would 400, since
 * ProjectId is not a queryable attribute on the child resource.
 *
 * Wired in openapi3.json under the GET operation's
 *   "x-vb": { "transforms": { "path": "./transforms/projectTasks" } }
 *
 * Scoped to ONLY this operation, so the other ProjectLOV endpoints keep the
 * default transforms. Modelled on ./finBusinessUnits.js — see it for the
 * encoding rationale.
 */
define(['urijs/URI'], function (URI) {
  'use strict';

  /**
   * Percent-encode a q predicate, RFC 3986 style: space as %20, and ' * ( ) ! too,
   * which encodeURIComponent leaves bare. Yields the encoding Fusion is known to
   * accept.
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
   * Filter transform. `options` is the filterCriterion. Both shapes that reach
   * here surface the typed text the same way:
   *
   *   oj-select-single dropdown filter field:  { text: 'design', matchBy: 'phrase' }
   *   compound (defensive):                    { $tag: '_root_', criteria: [...] }
   */
  Request.prototype.filter = function (configuration, options, transformsContext) {
    if (!options) return configuration;

    // An explicit q is a hand-authored Fusion predicate that already expresses
    // the caller's full intent — translating on top of it would clobber or
    // double it. No consumer sets one today; the guard is for future callers.
    if (URI(configuration.url).search(true).q) return configuration;

    var attributes = (transformsContext && transformsContext['vb-textFilterAttributes']) || [];
    if (!attributes.length) return configuration;

    var text;

    function visit(c) {
      if (!c || text) return;

      // Keyword. matchBy is left unchecked (phrase/fuzzy/undefined all mean
      // "substring" to us) — same leniency as finBusinessUnits.js.
      if (c.text) {
        text = c.text;
        return;
      }
      if (Array.isArray(c.criteria)) c.criteria.forEach(visit);
    }

    visit(options);

    // Single quote terminates the predicate's string literal and Fusion offers
    // no escape for it, so drop it rather than emit a malformed q. Worst case a
    // task with an apostrophe matches on the surrounding text.
    if (text) text = String(text).replace(/'/g, '').trim();
    if (!text) return configuration;

    // TaskName and TaskNumber are both string attributes on this resource
    // (TaskNumber is the outline number, e.g. '1.1.1'), so both take LIKE.
    var terms = attributes.map(function (attr) {
      return attr + " LIKE '*" + text + "*'";
    });

    // Safe to append rather than merge: the guard above established there's no q.
    var separator = configuration.url.indexOf('?') === -1 ? '?' : '&';
    configuration.url += separator + 'q=' + encodeQ(terms.join(' OR '));
    return configuration;
  };

  return { request: Request };
});
