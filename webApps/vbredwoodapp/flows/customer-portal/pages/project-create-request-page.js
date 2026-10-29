define(['mapboxgl'], (mapboxgl) => {
  'use strict';

  // Mapbox public token — same one used across the app (geocoder.js, the
  // line-detail + schedule maps). Safe in client code ("pk." public token).
  var ACCESS_TOKEN = 'pk.eyJ1IjoicmFodWxqYW1hbGFwdXJhbSIsImEiOiJjbXNkYngyeDcwNGN4MzVwdmRkMHRmN2ppIn0.P7EFTLmcAsXXammLSgF3Qw';
  // Default map centre when nothing is picked yet — Houston metro (most fleet
  // activity), matching the line-detail map's default.
  var DEFAULT_CENTER = [-95.3698, 29.7604];

  // ── Address suggestion DataProvider ───────────────────────────────────────
  // A minimal DataProvider handed to the drawer's oj-input-search `suggestions`.
  // oj-input-search AWAITS fetchFirst and debounces typing itself, so doing the
  // Mapbox forward-geocode INSIDE fetchFirst is what makes async remote results
  // paint reliably — an ArrayDataProvider filled by a separate fetch resolves
  // too late (oj-input-search already fetched the empty array and won't repaint).
  // Declaring a `filter` capability also tells oj-input-search we filter
  // server-side, so it does NOT locally re-filter our geocoded rows back out.
  function MapboxSuggestProvider(parseFeature) {
    this._parse = parseFeature;      // (feature, fallback) → {addr1,...,label}
    this._cache = new Map();         // key → item.data, so fetchByKeys resolves
    this._listeners = {};            // EventTarget shim (no mutations fired)
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
        ((mapboxgl && mapboxgl.accessToken) || ACCESS_TOKEN);
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
      // Standard AsyncIterable: an object whose [Symbol.asyncIterator]() returns
      // an iterator. oj-input-search consumes the single (done:true) chunk; the
      // Mapbox fetch happens inside next(), so the component awaits the results.
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
      // Advertise text filtering so oj-input-search passes us the typed text and
      // trusts our results instead of re-filtering them locally.
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

  // ── Report-backed suggestion DataProvider (Project + Customer) ─────────────
  // Backs the Project and Customer oj-select-single fields (one instance each).
  // NOTE: the ignore-the-size trick below does NOT beat oj-input-search — it also stops
  // reading rows after 12 (remainingFetchCount in ojinputsearch.js) — which is why both
  // fields moved to oj-select-single. oj-input-search hard-codes
  // `maxFetchCount = 12` and passes it to fetchFirst as the page size; a stock
  // ArrayDataProvider/ServiceDataProvider honours that and returns 12 rows. This
  // provider deliberately IGNORES the requested size and returns whatever
  // the typeahead chain delivered (capped there), so the popup can show more.
  //
  // The rows come from the BIP report EQP_PROJECTS_LOV_RP, which a page module
  // cannot call (no action-chain context). So the PROVIDER drives the search:
  // oj-input-search awaits fetchFirst(filterCriterion.text); fetchFirst fires the
  // page event (projectSearchRequested / customerSearchRequested) for exactly that text and returns a Promise
  // that deliver() settles once the chain has the report's rows. Asking per text
  // (rather than the chain pushing a "latest search" in) removes the race where
  // the component fetched before the chain had started and got the previous,
  // empty answer.
  var MIN_SEARCH_CHARS = 2;
  var SEARCH_TIMEOUT_MS = 20000;

  function ReportSuggestProvider(requestSearch, keyAttr) {
    this._request = requestSearch;        // (text) → fires the field's *SearchRequested event
    this._keyAttr = keyAttr;              // row attribute that is the key (ProjectId / CustomerId)
    this._pending = new Map();            // key → { promise, resolve } while a search is in flight
    this._cache = new Map();              // key → row, so fetchByKeys resolves
    this._browse = null;                  // cached blank-search (starter) list
    this._listeners = {};
  }
  ReportSuggestProvider.prototype = {
    _textOf: function (params) {
      var fc = params && params.filterCriterion;
      if (!fc) return '';
      if (fc.text != null) return String(fc.text).trim();
      if (fc.value != null) return String(fc.value).trim();
      return '';
    },
    _search: function (text) {
      var self = this;
      // Blank text is the "just clicked into the field" browse list (the report
      // returns the first rows by name); 1 character is too vague to search.
      if (text.length > 0 && text.length < MIN_SEARCH_CHARS) return Promise.resolve([]);
      var key = text.toLowerCase();
      if (key === '' && this._browse) return Promise.resolve(this._browse);
      var inFlight = this._pending.get(key);
      if (inFlight) return inFlight.promise;
      var entry = {};
      entry.promise = new Promise(function (resolve) { entry.resolve = resolve; });
      this._pending.set(key, entry);
      setTimeout(function () { self.deliver(text, []); }, SEARCH_TIMEOUT_MS);
      try { this._request(text); } catch (e) { this.deliver(text, []); }
      return entry.promise;
    },
    // Called by ProjectTypeaheadChain (via the page module) with the report's rows.
    deliver: function (text, rows) {
      var key = String(text || '').trim().toLowerCase();
      var entry = this._pending.get(key);
      if (!entry) return;
      this._pending.delete(key);
      rows = Array.isArray(rows) ? rows : [];
      // Cache the browse list for the life of the page (only when non-empty, so
      // a failed or timed-out load is retried on the next click).
      if (key === '' && rows.length) this._browse = rows;
      entry.resolve(rows);
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
          return self._search(self._textOf(params)).then(function (rows) {
            rows.forEach(function (r) { self._cache.set(String(r[self._keyAttr]), r); });
            return {
              done: true,
              value: {
                data: rows,
                metadata: rows.map(function (r) { return { key: String(r[self._keyAttr]) }; }),
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
        var d = self._cache.get(String(k));
        if (d) map.set(k, { metadata: { key: k }, data: d });
      });
      return Promise.resolve({ fetchParameters: params, results: map });
    },
    containsKeys: function (params) {
      var self = this;
      var found = new Set();
      (params && params.keys ? Array.from(params.keys) : []).forEach(function (k) {
        if (self._cache.has(String(k))) found.add(k);
      });
      return Promise.resolve({ containsParameters: params, results: found });
    },
    fetchByOffset: function (params) {
      return Promise.resolve({ fetchParameters: params, results: [], done: true });
    },
    getCapability: function (name) {
      // Advertise text filtering so oj-input-search passes us the typed text and
      // trusts our (already matched, case-insensitive) rows instead of
      // re-filtering them locally.
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

  class PageModule {
    constructor(context) {
      // Page modules cannot write $page.variables (the write is inert). To push
      // parsed address data into the drawer's bound fields we fire a custom page
      // event (locationResolved); a registered chain does the writes. Same
      // channel line-detail uses for its staging updates.
      this._eventHelper = (context && typeof context.getEventHelper === 'function')
        ? context.getEventHelper()
        : null;
      // Single stable DataProvider instance for the address typeahead.
      var self = this;
      this._addrDP = new MapboxSuggestProvider(function (f, fb) { return self._parseFeature(f, fb); });
      // Single stable DataProvider instance for the Project typeahead.
      this._projDP = new ReportSuggestProvider(function (text) { self._emitSearch('projectSearchRequested', text, self._projDP); }, 'ProjectId');
      // Single stable DataProvider instance for the Customer typeahead.
      this._custDP = new ReportSuggestProvider(function (text) { self._emitSearch('customerSearchRequested', text, self._custDP); }, 'CustomerId');
    }

    // Bound by the Project oj-input-search `suggestions`; same instance every eval.
    projectSuggestionsProvider() {
      return this._projDP;
    }

    // Bound by the Customer oj-input-search `suggestions`; same instance every eval.
    customerSuggestionsProvider() {
      return this._custDP;
    }

    // Fires <eventName> so the field's typeahead chain runs the report; the
    // provider is passed so a failure to fire still settles the waiting fetch.
    _emitSearch(eventName, text, provider) {
      if (!this._eventHelper) { provider.deliver(text, []); return; }
      try {
        this._eventHelper.fireCustomEvent(eventName, { text: text });
      } catch (e) {
        console.warn('[create-request] fireCustomEvent(' + eventName + ') failed:', e);
        provider.deliver(text, []);
      }
    }

    // Called by ProjectTypeaheadChain with the report's rows for `text`.
    deliverProjects(text, rows) {
      this._projDP.deliver(text, rows);
    }

    // Called by CustomerTypeaheadChain with the report's rows for `text`.
    deliverCustomers(text, rows) {
      this._custDP.deliver(text, rows);
    }

    // Bound by the drawer's oj-input-search `suggestions`. Returns the SAME
    // instance every eval so the component isn't handed a new provider each render.
    addressSuggestionsProvider() {
      return this._addrDP;
    }

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

    // ── Delivery-location map drawer ─────────────────────────────────────
    // Imperative Mapbox map built into the drawer's #pcr-map div. Called by
    // LocationDrawerToggleChain when the drawer opens.

    initLocationMap() {
      var self = this;
      // The drawer content mounts as it opens — wait a tick for #pcr-map to be
      // in the DOM before handing it to Mapbox.
      setTimeout(function () {
        var el = document.getElementById('pcr-map');
        if (!el || !mapboxgl) {
          if (!mapboxgl) console.warn('[create-request] mapboxgl not loaded — map skipped.');
          return;
        }
        if (!mapboxgl.accessToken) mapboxgl.accessToken = ACCESS_TOKEN;

        // Rebuild fresh each open so a stale map from a previous open can't leak.
        self.destroyLocationMap();

        var start = self._picked ? [self._picked.lng, self._picked.lat] : DEFAULT_CENTER;
        var map = self._locMap = new mapboxgl.Map({
          container: el,
          style: 'mapbox://styles/mapbox/streets-v12',
          center: (self._picked && self._picked.lng != null) ? start : DEFAULT_CENTER,
          zoom: (self._picked && self._picked.lng != null) ? 14 : 9
        });
        map.addControl(new mapboxgl.NavigationControl(), 'top-right');

        var marker = self._locMarker = new mapboxgl.Marker({ draggable: true, color: '#1565C0' });
        if (self._picked && self._picked.lng != null) marker.setLngLat(start).addTo(map);

        // Click / drag to drop-move the pin → reverse geocode.
        map.on('click', function (e) { self._reverseGeocode(e.lngLat.lng, e.lngLat.lat); });
        marker.on('dragend', function () {
          var ll = marker.getLngLat();
          self._reverseGeocode(ll.lng, ll.lat);
        });

        // Mapbox needs a resize once its container has real dimensions (the
        // drawer animates open), else tiles render half-painted.
        setTimeout(function () { try { map.resize(); } catch (e) {} }, 300);
      }, 250);
    }

    // A suggestion was chosen → make it the picked point: centre the map, move
    // the pin, and push its parsed components into the fields (locationResolved).
    applySuggestion(data) {
      if (!data) return;
      this._picked = data;
      if (this._locMap && data.lng != null && data.lat != null) {
        this._locMap.flyTo({ center: [data.lng, data.lat], zoom: 15 });
        if (this._locMarker) this._locMarker.setLngLat([data.lng, data.lat]).addTo(this._locMap);
      }
      this._emit(data);
    }

    // Reverse geocode from map coords → parse fields (pin already moved).
    _reverseGeocode(lng, lat) {
      if (this._locMarker && this._locMap) this._locMarker.setLngLat([lng, lat]).addTo(this._locMap);
      var self = this;
      fetch('https://api.mapbox.com/geocoding/v5/mapbox.places/' + lng + ',' + lat +
            '.json?limit=1&access_token=' + ((mapboxgl && mapboxgl.accessToken) || ACCESS_TOKEN))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (body) {
          var f = body && Array.isArray(body.features) && body.features[0];
          var parsed = self._parseFeature(f, lat.toFixed(5) + ', ' + lng.toFixed(5));
          // The reverse feature's centre is the geocoder's snapped point; keep
          // the actual clicked coords instead.
          parsed.lat = lat; parsed.lng = lng;
          self._picked = parsed;
          self._emit(parsed);
        })
        .catch(function () { /* tolerate */ });
    }

    // Mapbox feature → Oracle-style address components. Context id prefixes:
    //   postcode → ZIP, place → city, district → county, region → state,
    //   country → country. Line 1 = house number + street (address-type
    //   features) else the first segment of place_name. Line 2 is left blank
    //   (Mapbox has no suite/unit) for the user to fill.
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

    // Push parsed components into the page variables via the custom event.
    _emit(p) {
      if (!this._eventHelper) return;
      try {
        this._eventHelper.fireCustomEvent('locationResolved', { data: p });
      } catch (e) {
        console.warn('[create-request] fireCustomEvent(locationResolved) failed:', e);
      }
    }

    destroyLocationMap() {
      if (this._locMap) { try { this._locMap.remove(); } catch (e) {} this._locMap = null; }
      this._locMarker = null;
    }

    // Read by the (future) write-back chain when the user hits "Use this location".
    getPickedLocation() {
      return this._picked || null;
    }

    // ── Internal Location picker (locationType === 'INV_ORG') ─────────────
    // Rows are EQR_BU_ORG_MAPPING entries (orgRole=DESTINATION_YARD). They
    // already carry the hr_locations address, written by
    // resources/js/invOrgAddress.js from BIP EQP_INV_ORG_ADDRESSES.xdo when the
    // admin saved the mapping — so nothing here fetches anything.

    /**
     * Compose a mapping row's address parts into one line.
     *
     * THE SINGLE OWNER of that composition: it renders the dropdown's second
     * line AND produces the string written to request.location, so what the
     * user reads and what gets stored cannot drift.
     *
     * Order follows how an address is spoken — street, then locality, then
     * region/postcode, then country. Blank parts are dropped rather than
     * leaving stray commas, and a row with no address at all yields '' so the
     * caller can decide whether to render the line.
     *
     * addressLine3/4, building and floorNumber are deliberately omitted: they
     * are null on every current row and would only lengthen a dropdown line
     * whose job is to disambiguate two orgs at a glance.
     *
     * @param {Object} d a bu-org-mappings row (camelCase)
     * @returns {string} e.g. "233 S Wacker Dr, Fl 66, Chicago, IL 60606, US"
     */
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

      // Region and postcode read as one unit ("IL 60606"), so they are joined
      // before being pushed — otherwise a missing region leaves ", , 60606".
      var region = d.region2 == null ? '' : String(d.region2).trim();
      var postal = d.postalCode == null ? '' : String(d.postalCode).trim();
      var regionPostal = [region, postal].filter(function (s) { return !!s; }).join(' ');
      push(regionPostal);

      push(d.country);
      return parts.join(', ');
    }

    /**
     * Collapsed-field text for the picker: the address, nothing else.
     *
     * Identical to what the dropdown row shows, so the closed field reads as
     * exactly the row that was picked. It is also the same string written to
     * request.location, which means the user sees the value that is stored.
     *
     * Falls back to the org name when the row has no address, matching the
     * itemTemplate's fallback so the field is never blank.
     *
     * @param {Object} d a bu-org-mappings row (camelCase)
     * @returns {string} e.g. "233 S Wacker Dr, Fl 66, Chicago, IL 60606, US"
     */
    invOrgOptionText(d) {
      if (!d) return '';
      var addr = this.formatInvOrgAddress(d);
      return addr || (d.invOrgName == null ? '' : String(d.invOrgName).trim());
    }
  }

  return PageModule;
});
