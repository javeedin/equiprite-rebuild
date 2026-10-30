define([], function() {
  'use strict';

  var PREFIX = 'eqr.draft.';

  function safeJSON(s) {
    if (s == null) return null;
    try { return JSON.parse(s); } catch (e) { return null; }
  }

  function isEmpty(val) {
    if (val == null) return true;
    if (Array.isArray(val)) return val.length === 0;
    if (typeof val === 'object') return Object.keys(val).length === 0;
    if (typeof val === 'string') return val.trim() === '';
    return false;
  }

  return {
    save: function(key, value) {
      try {
        if (value === undefined || value === null) {
          localStorage.removeItem(PREFIX + key);
        } else {
          localStorage.setItem(PREFIX + key, JSON.stringify(value));
        }
      } catch (e) { /* quota or disabled storage — silent */ }
    },

    load: function(key) {
      try {
        return safeJSON(localStorage.getItem(PREFIX + key));
      } catch (e) { return null; }
    },

    // Returns true if localStorage has a non-empty draft for this key.
    // On resume pages (catalog, cart) we always prefer the persisted draft
    // over whatever VBCS initialized the flow variable to — otherwise default
    // values on the variable (e.g. request.creditLimit) make the variable
    // look "non-empty" and would silently block hydration, dropping user-typed
    // fields like `location` after a refresh.
    hasStoredDraft: function(key) {
      var stored = this.load(key);
      return !isEmpty(stored);
    },

    clear: function() {
      try {
        var toRemove = [];
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf(PREFIX) === 0) toRemove.push(k);
        }
        toRemove.forEach(function(k) { localStorage.removeItem(k); });
      } catch (e) { /* silent */ }
    }
  };
});
