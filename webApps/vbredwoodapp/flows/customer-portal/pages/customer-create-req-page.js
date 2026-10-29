define(['mapboxgl'], (mapboxgl) => {
  'use strict';

  // Delivery-location map drawer for the customer create-request page. Same
  // approach as project-create-request-page.js (typeahead via a custom
  // DataProvider + imperative Mapbox map + parse-to-Oracle-fields), differing
  // only in the map container id (#ccr-map) and that "Use this location" writes
  // $page.variables.formData.location (this page has no project / $flow.request).

  // Mapbox public token — same one used across the app. Safe in client code.
  var ACCESS_TOKEN = 'pk.eyJ1IjoicmFodWxqYW1hbGFwdXJhbSIsImEiOiJjbXNkYngyeDcwNGN4MzVwdmRkMHRmN2ppIn0.P7EFTLmcAsXXammLSgF3Qw';
  // Default map centre when nothing is picked yet — Houston metro.
  var DEFAULT_CENTER = [-95.3698, 29.7604];

  // ── Address suggestion DataProvider ───────────────────────────────────────
  // Handed to the drawer's oj-input-search `suggestions`. oj-input-search AWAITS
  // fetchFirst and debounces typing itself, so doing the Mapbox forward-geocode
  // INSIDE fetchFirst is what makes async remote results paint reliably.
  // Declaring a `filter` capability tells oj-input-search we filter server-side,
  // so it does NOT locally re-filter our geocoded rows back out.
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
      // Page modules cannot write $page.variables; parsed address data is pushed
      // into the drawer's bound fields via the locationResolved custom event.
      this._eventHelper = (context && typeof context.getEventHelper === 'function')
        ? context.getEventHelper()
        : null;
      var self = this;
      this._addrDP = new MapboxSuggestProvider(function (f, fb) { return self._parseFeature(f, fb); });
    }

    // Bound by the drawer's oj-input-search `suggestions`; returns the SAME
    // instance every eval so the component isn't handed a new provider each render.
    addressSuggestionsProvider() {
      return this._addrDP;
    }

    // ── Delivery-location map drawer ─────────────────────────────────────
    // Imperative Mapbox map built into the drawer's #ccr-map div. Called by
    // LocationDrawerToggleChain when the drawer opens.
    initLocationMap() {
      var self = this;
      setTimeout(function () {
        var el = document.getElementById('ccr-map');
        if (!el || !mapboxgl) {
          if (!mapboxgl) console.warn('[customer-create-req] mapboxgl not loaded — map skipped.');
          return;
        }
        if (!mapboxgl.accessToken) mapboxgl.accessToken = ACCESS_TOKEN;

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

        map.on('click', function (e) { self._reverseGeocode(e.lngLat.lng, e.lngLat.lat); });
        marker.on('dragend', function () {
          var ll = marker.getLngLat();
          self._reverseGeocode(ll.lng, ll.lat);
        });

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
          parsed.lat = lat; parsed.lng = lng;
          self._picked = parsed;
          self._emit(parsed);
        })
        .catch(function () { /* tolerate */ });
    }

    // Mapbox feature → Oracle-style address components. Context id prefixes:
    //   postcode → ZIP, place → city, district → county, region → state,
    //   country → country. Line 1 = house number + street (address-type
    //   features) else the first segment of place_name. Line 2 left blank.
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

    _emit(p) {
      if (!this._eventHelper) return;
      try {
        this._eventHelper.fireCustomEvent('locationResolved', { data: p });
      } catch (e) {
        console.warn('[customer-create-req] fireCustomEvent(locationResolved) failed:', e);
      }
    }

    destroyLocationMap() {
      if (this._locMap) { try { this._locMap.remove(); } catch (e) {} this._locMap = null; }
      this._locMarker = null;
    }

    getPickedLocation() {
      return this._picked || null;
    }
  }

  return PageModule;
});
