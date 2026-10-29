/**
 * VBCS transforms for getBuOrgMappings — endpoint-scoped.
 *
 * Maps the JET keyword criterion an oj-select-single emits while the user types
 * into the endpoint's free-text search param:
 *
 *    typed 'Atl' → ?q=Atl   (backend searches invOrgId / invOrgCode / invOrgName)
 *
 * Wired in openapi3.json under the GET operation's
 *   "x-vb": { "transforms": { "path": "./transforms/buOrgMappings" } }
 *
 * IMPORTANT — getBuOrgMappings is also called plainly (Actions.callRest) by
 * loadBuOrgMappingsChain (config page) and others with no filter. The filter
 * transform is a no-op when there's no criterion (and when a q is already on the
 * URL), so those calls are unaffected — only the SDP's typed search adds ?q=.
 */
define(['urijs/URI'], function (URI) {
  'use strict';

  var Request = function () {};

  Request.prototype.filter = function (configuration, options) {
    if (!options) return configuration;

    // Leave an explicit q untouched.
    if (URI(configuration.url).search(true).q) return configuration;

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
