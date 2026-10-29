/**
 * VBCS transforms for getConfEquipmentSettings — endpoint-scoped.
 *
 * Maps the JET keyword criterion an oj-select-single emits while the user types
 * into the endpoint's free-text search param:
 *
 *    typed 'Aus'  →  ?q=Aus     (backend searches across all columns)
 *
 * Wired in openapi3.json under the GET operation's
 *   "x-vb": { "transforms": { "path": "./transforms/confEquipmentSettings" } }
 *
 * IMPORTANT — this operation is also called plainly (Actions.callRest) by
 * loadEsSettingsChain with fixed pageSize/limit uriParams and NO filter. The
 * filter transform is a no-op when there's no criterion (and when a q is already
 * on the URL), so that call is unaffected — only the picker SDP's typed search
 * adds ?q=.
 */
define(['urijs/URI'], function (URI) {
  'use strict';

  var Request = function () {};

  Request.prototype.filter = function (configuration, options) {
    if (!options) return configuration;

    // Leave an explicit q untouched (a caller that already set it owns it).
    if (URI(configuration.url).search(true).q) return configuration;

    // Extract the typed keyword. matchBy is left unchecked (phrase/fuzzy/undefined
    // all mean "free-text" to this endpoint), same leniency as invOrgs.js.
    var text;
    function visit(c) {
      if (!c || text) return;
      if (c.text) { text = c.text; return; }
      if (Array.isArray(c.criteria)) c.criteria.forEach(visit);
    }
    visit(options);

    if (text == null) return configuration;
    text = String(text).trim();
    if (!text) return configuration;

    var separator = configuration.url.indexOf('?') === -1 ? '?' : '&';
    configuration.url += separator + 'q=' + encodeURIComponent(text);
    return configuration;
  };

  return { request: Request };
});
